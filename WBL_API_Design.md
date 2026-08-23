# WBL Assessment Framework — API
### Route design, v1 — companion to `WBL_Schema_Design.md`

One route module, `server/routes/wbl.js`, mounted at `/api/wbl` in `server/index.js` alongside the existing routers. Seven groups.

---

## 0. Prerequisites

Two things must land before the first endpoint.

**Extract `requireTeacher`.** It currently lives inside `server/routes/teacher.js` (lines 43–66) as a module-local function, along with `verifyTeacherToken` and its cache. `wbl.js` needs the same gate. Move all three into `server/teacherAuth.js` and re-import from `teacher.js` — a pure move, no behaviour change, and it stops two copies of a token cache drifting apart.

**Add `normalizeStudentId`** to `server/db.js` and export it (schema decision 17). Every endpoint below that accepts a student ID applies it before touching the database. The one-time backfill of the six existing columns is a **separate migration** and is not a prerequisite for the API — but until it runs, WBL rows will not match padded IDs already in `class_students`.

### Identity

| Actor | Gate | Identified by |
|---|---|---|
| Instructor | `requireTeacher` | `req.teacherKey` |
| Student | `requireAuth` | `req.userKey` → resolved to `student_id` |

Students authenticate as `user_key` but all WBL data is keyed on `student_id`. Resolution follows the existing pattern in `server/routes/student.js:100`:

```sql
SELECT cs.student_id, cs.class_id FROM class_students cs WHERE cs.user_key = ?
```

A student with no `class_students` row has no WBL identity — every `/me` endpoint returns `404 { error: 'not_enrolled' }` rather than an empty success, so an unmapped roster shows up as a real problem instead of a blank page.

### Ownership

`requireProgramOwner(req, programId)` → `403` unless `wbl_programs.teacher_key = req.teacherKey`. Applied to every teacher endpoint that names a program, credential, skill, work event, or participant, resolving upward to the owning program.

**The single exception** is `GET /api/wbl/students/:studentId/credentials` (§7), the read-only cross-program lookup that decision 13 requires. No write ever crosses a program boundary.

---

## 1. Programs and enrollment

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs` | Teacher's programs; includes `imported_from` and drift count |
| `POST` | `/programs` | `{name, description?, qc_max_weeks_unchecked?, shareable?}` |
| `PATCH` | `/programs/:id` | Same fields |
| `DELETE` | `/programs/:id` | `409` if any student data exists; `?force=true` overrides |
| `GET` | `/programs/shareable` | Other teachers' `shareable=1` programs — the import picker |
| `POST` | `/programs/:id/classes` | `{class_id}` → `wbl_class_programs` |
| `DELETE` | `/programs/:id/classes/:classId` | Also clears that class's `*_sync` rows |
| `GET` | `/programs/:id/roster` | Enrollments + effective phase + credential counts + QC coverage |
| `POST` | `/programs/:id/enrollments` | `{student_ids: []}` — normalised, `pathway_year` defaults 1 |
| `PATCH` | `/programs/:id/enrollments/:studentId` | `{pathway_year?, exited_on?, exit_reason?}` |
| `POST` | `/programs/:id/enrollments/roll-year` | Increments `pathway_year` for all active enrollments |

`roll-year` is the multi-year affordance from schema decision 16: it advances the existing enrollment rows rather than creating new ones, so one student keeps one pathway history while moving through a different `class_id` each year. It does **not** touch phase, credentials, or assessments — those persist by key, not by action.

`DELETE /programs/:id` deliberately refuses when student data exists. A program is a curriculum, and deleting one because a name was typed wrong should not be the same gesture as erasing a cohort's record.

---

## 2. Catalog

### Credentials

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs/:id/credentials` | With skill requirements and award counts |
| `POST` | `/programs/:id/credentials` | `{name, description?, min_holistic_tier?}` |
| `PATCH` | `/credentials/:id` | |
| `DELETE` | `/credentials/:id` | `409` if awarded to anyone; archive instead |
| `PUT` | `/credentials/:id/skills` | `[{skill_id, required_demonstrations, order_idx}]` — full replace |

### Skills — the versioned surface

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs/:id/skills` | Current published version of each |
| `POST` | `/programs/:id/skills` | Creates lineage + **draft** v1 |
| `GET` | `/skills/:id/versions` | Full version history |
| `POST` | `/skills/:id/versions` | New draft, `?copy_current=true` to clone criteria |
| `PATCH` | `/skill-versions/:id` | **Draft only** — `409` if published |
| `PUT` | `/skill-versions/:id/criteria` | **Draft only** — full replace of the checklist |
| `POST` | `/skill-versions/:id/publish` | Sets `is_current`, demotes prior, stamps `published_at` |
| `POST` | `/skill-versions/:id/retire` | Guarded — see below |
| `PUT` | `/skills/:id/openings` | `[soft_skill_code]` — Phase 1 scaffolding |

**Publishing is the only way to change a skill.** `PATCH` on a published version returns `409 { error: 'version_published', hint: 'create a new version' }`. That rule is what makes `skill_version_id` on an assessment a durable record of what a student was actually assessed against — the whole point of schema decision 7.

I'd recommend enforcing it with a trigger rather than route code, for consistency with schema decision 9:

```sql
CREATE TRIGGER IF NOT EXISTS trg_wbl_skill_version_published_immutable
BEFORE UPDATE OF name, description ON wbl_skill_versions
FOR EACH ROW WHEN OLD.status = 'published'
BEGIN
    SELECT RAISE(ABORT, 'Published skill versions are immutable — publish a new version');
END;
```

Note `UPDATE OF name, description` — narrowing to content columns leaves `is_current` and `status` freely updatable, which `publish` and `retire` both need.

**Retire is guarded** (schema decision 14). Retiring a skill still required by a non-archived credential strands every student partway through it:

```
409 {
  error: 'skill_in_use',
  credentials: ['Basic Joinery'],
  students_stranded: 7,
  hint: 'retry with ?force=true'
}
```

### QC criteria and program config

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/programs/:id/qc-criteria` | |
| `PATCH`/`DELETE` | `/qc-criteria/:id` | Delete `409`s if used by any check; archive instead |
| `PUT` | `/programs/:id/phase2-prereqs` | `[credential_id]` — triggers phase recompute for all enrolled |
| `PUT` | `/programs/:id/tier-points` | `[{tier, points_pct}]` |

Changing `phase2-prereqs` recomputes phase for every enrolled student. Loosening the gate can advance students to Phase 2 immediately; tightening it **never demotes anyone** — `wbl_student_phase.transitioned_at`, once set, is not cleared. A student who has been doing Phase 2 work should not silently lose the transfer lens because an instructor edited a prerequisite list.

---

## 3. Import and drift

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs/:id/import/preview?source=:sourceId` | Dry run — no writes |
| `POST` | `/programs/:id/import` | `{source_program_id, mode}` |
| `GET` | `/programs/:id/drift` | Tracked imports whose source has moved on |
| `POST` | `/skills/:id/pull` | New local version copying upstream's current |

`preview` returns the merge plan before anything happens, classified exactly as schema decision 18 specifies:

```json
{
  "create":   [{"type": "credential", "name": "Basic Joinery"}],
  "adopt":    [{"type": "skill", "slug": "joinery", "local_id": 42}],
  "noop":     [{"type": "skill", "slug": "sanding", "reason": "already tracked"}],
  "conflict": [{"type": "skill", "slug": "finishing",
                "reason": "already tracked from a different source"}]
}
```

`adopt` sets `source_*` on an existing local row and **leaves its content alone**. The row then appears in `/drift` on the next call, and the instructor pulls — or doesn't. Content reconciliation is never a special path in the importer; it reuses the version-publish flow, which is also why prior student evidence keeps counting.

Import copies catalog only. The exclusion list is in schema §1.1 and includes every `*_sync` table — copying a PS assignment ID would push grades into another teacher's gradebook.

---

## 4. Work events

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs/:id/work-events?status=active` | |
| `POST` | `/programs/:id/work-events` | `{title, external_ref?, description?, opened_on}` |
| `GET` | `/work-events/:id` | Participants + per-lens completion state |
| `PATCH` | `/work-events/:id` | Including `status` — see below |
| `POST` | `/work-events/:id/participants` | `{student_ids: [], class_id}` |
| `DELETE` | `/work-events/:id/participants/:pid` | `409` if any assessment exists |

**Adding a participant stamps `phase_at_start`** from their effective phase at that moment. That is what keeps the record honest when a student advances mid-job — the row remembers which mechanics were live, so a Phase 1 participant is never retroactively expected to have filed transfer claims.

**Completing a work event requires a Holistic Call for every participant:**

```
409 { error: 'missing_holistic_calls',
      participants: [{participant_id: 88, student_id: '12345', name: 'A. Diaz'}],
      hint: 'retry with ?force=true' }
```

This is the one place the framework's cadence is enforced rather than merely recorded — §4.2b puts the Holistic Call *at* completion, and a job that closes without one leaves every skill demonstrated on it unable to count toward mastery (§9 joins through the holistic tier). Failing loudly at close beats discovering months later that a credential never advanced.

---

## 5. Assessment — the three lenses

| Method | Path | Notes |
|---|---|---|
| `GET` | `/participants/:id` | **The main instructor screen** — all three lenses at once |
| `PUT` | `/participants/:id/skills/:skillId` | `{result, note?, criteria: [{criterion_id, met}]}` |
| `POST` | `/participants/:id/qc-check` | `{results: [{criterion_id, outcome, note?}], note?}` |
| `PUT` | `/participants/:id/holistic` | `{tier, rationale?}` |
| `PATCH` | `/transfer-claims/:id/verify` | `{verdict, score?, verify_note?}` |

`GET /participants/:id` is the endpoint that makes schema §2 real — one request returns the hard-skill checklist, the QC history for this job, the holistic call, the student's dispositional entries for the days they worked it, and their transfer claims. One screen, one participant, three lenses, mirroring a supervisor watching someone do the job once.

**Skill assessment pins the current version** server-side. The client sends `skill_id`; the route resolves `is_current` and writes `skill_version_id`. Clients never choose a version — that's how the pin stays trustworthy.

**QC check computes `iso_week` server-side** from `checked_on`, never from the client. The weekly cap is a `UNIQUE` constraint, so a duplicate returns:

```
409 { error: 'already_checked_this_week', iso_week: '2026-W34',
      existing_check_id: 412, checked_on: '2026-08-19' }
```

### The write cascade

Every skill assessment and every holistic call runs one shared function afterward:

```js
recomputeAttainment(programId, studentId)
//  1. run the §9 credentialing rule for each credential touching the changed skill
//  2. INSERT any newly satisfied wbl_credential_awards (source='auto')
//     + snapshot the satisfying assessments into wbl_award_evidence
//  3. recompute wbl_student_phase.computed_phase against wbl_phase2_prereqs
//  4. if phase moved 1 → 2, stamp transitioned_at (never cleared)
```

A holistic call triggers it because the call is what makes prior demonstrations on that job *count* — grading a job as "Meets spec" can complete a credential without any new skill assessment at all. That is the framework's "technique in service of acceptable output" rule (§4.1) expressed as a code path, and it's the least obvious dependency in the whole design.

Awards are never revoked automatically. Downgrading a holistic call after an award has been granted flags it for instructor review rather than silently retracting a credential a student has been told they hold.

---

## 6. Student-facing — `/api/wbl/me`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/me` | Programs, phase, pathway year, credentials |
| `GET` | `/me/do-now?program_id=&date=` | Today's entry, pending feedback, Phase 1 openings |
| `POST` | `/me/do-now` | `{program_id, date, skills: [code]}` — 1–2, trigger-enforced |
| `POST` | `/me/exit-slip` | `{do_now_id, soft_skill_code, work_event_id?, narrative}` |
| `GET` | `/me/exit-slips` | Read-only history, voids shown as voided |
| `GET` | `/me/work-events` | Active jobs I'm a participant on |
| `GET` | `/me/credentials` | **All programs** — the citation picker |
| `POST` | `/me/transfer-claims` | Phase 2 only |

**There is no `PATCH` or `DELETE` for exit slips.** The route simply does not exist, backed by the database trigger. A junk entry is handled by an instructor recording a void (§7), never by the student editing.

**Feedback is delivered forward.** `GET /me/do-now` returns undelivered `wbl_dispositional_feedback` for that student; `POST /me/do-now` stamps `delivered_do_now_id` and `delivered_at` on those rows. Feedback therefore surfaces at the *start* of the next session, attached to the new Do Now — never as an annotation on the prior exit slip. §4.3.1 is explicit that the loop runs forward, and this is the mechanism.

**Phase 1 openings.** When the student is Phase 1, `GET /me/do-now` includes the dispositional skills mapped via `wbl_skill_openings` for the skills in play, narrowing the choice as §3 describes. In Phase 2 the field is absent and selection is fully self-directed.

**Transfer claims are dormant in Phase 1**, enforced not documented:

```
403 { error: 'phase_1_dormant',
      hint: 'Transfer skills activate on entry to Phase 2' }
```

`GET /me/credentials` deliberately spans **every** program the student has awards in, because decision 13 allows citing a Carpentry credential while working an Apparel job. The picker should group by program so the cross-program case is visible rather than accidental.

---

## 7. Rotation, floor, verification, sync

| Method | Path | Notes |
|---|---|---|
| `GET` | `/programs/:id/rotation?week=YYYY-Www` | Derived queue, longest-unchecked first |
| `GET` | `/programs/:id/qc-floor` | Students below floor, active-weeks denominator |
| `GET` | `/students/:studentId/credentials` | **Cross-program**, read-only — the one boundary crossing |
| `GET` | `/sync/progress?class_id=` | Everything the extension needs to compute scores |
| `POST` | `/sync/ids` | Extension writes PS assignment IDs back |

**The rotation queue is a query, not a table.** Students with a participant row on an `active` work event and no check this ISO week, ordered by most recent `iso_week` ascending. Nothing to keep in sync and nothing to drift.

**The floor report uses active weeks as its denominator** — weeks in which the student actually had a participant row on an active job. Calendar weeks would count absence, breaks, and between-jobs gaps as coverage failures, producing an alert that is wrong most of the time and gets ignored. It reports; it never gates (schema decision 11).

`GET /students/:studentId/credentials` is the narrow crossing decision 13 requires: an Apparel instructor verifying an Application claim must confirm a Carpentry credential exists. It returns credential name, program name, and `awarded_at` — nothing about the other program's assessments, work events, or reflections.

**Verification pre-answers itself.** Before an instructor opens a claim, the route resolves both fact-checks:

- `citation_not_on_record` — does the cited credential exist on this student's record *anywhere*?
- `not_novel` — for an Extension claim, does the student already hold a credential for that capability in *any* program? If so the UI should say: *"You already hold this in Carpentry — did you mean Application of Previous Knowledge?"* Novelty is only meaningful against the student's whole history, which is what makes this check program-wide.

### The server never pushes to PowerSchool

Corrected after reading `DobbsCore/content.js`. **There is no server-side PS integration and there must not be one.** PowerSchool is reached only from the teacher's browser, by the DobbsCore Chrome extension, using the teacher's existing PS session cookies. The server's role in sync is exactly two things, mirroring `mc_*`:

1. **Serve scorable state** — `GET /sync/progress?class_id=` returns students, credential awards, holistic calls, transfer scores, and any stored PS assignment IDs. The extension computes point values client-side and creates or updates PS assignments itself.
2. **Store PS assignment IDs back** — `POST /sync/ids` persists what the extension created, so a re-sync updates the same assignments instead of creating duplicates. This is the exact contract of `POST /api/teacher/microcredentials/:id/sync-ids` (`teacher.js:628`).

**Credentials sync in two passes, both completion grades.** Each required skill becomes a **formative** `0`/`100` assignment (satisfied or not), and the credential itself a **summative** `0`/`100` (awarded or not). There is deliberately no partial-mastery score: a credential rests on a complete evidence trail, so 1-of-2 skills is a zero on the summative and a 100 on the one formative skill actually completed. The skill grain is keyed on **(credential, skill)** because thresholds belong to the credential.

```jsonc
// POST /api/wbl/sync/ids
{ "class_id": 12,
  "skills":      [{"credential_id": 3, "skill_id": 8, "ps_assignment_id": "9910", "ps_assignmentsection_id": "8821"}],
  "credentials": [{"credential_id": 3, "ps_assignment_id": "9911", "ps_assignmentsection_id": "8822"}],
  "work_events": [{"work_event_id": 7,  "ps_assignment_id": "9912", "ps_assignmentsection_id": "8823"}],
  "transfer":    [{"kind": "application", "ps_assignment_id": "9913", "ps_assignmentsection_id": "8824"}] }
```

**Prior-year awards are excluded from `/sync/progress`** rather than skipped at push time — the server decides what is scorable for the requested class, so the extension never sees a credential earned in a different term and cannot inflate the current one.

### Decision 17's cross-repo risk — checked against production, does not apply

**Resolved 2026-08-23 by querying the production database directly.** PowerSchool does not zero-pad `studentnumber`:

| Table | Source | Rows | Leading zeros | Non-numeric |
|---|---|---|---|---|
| `class_students` | DobbsCore roster import, straight from the PS API | 17 (1×5-digit, 16×6-digit) | 0 | 0 |
| `it_students` | CSV import | 237 (35×5-digit, 202×6-digit) | 0 | 0 |

The decisive detail is that **36 genuine five-digit IDs exist and are not padded to six.** Under a zero-padding scheme they would all be six characters beginning with `0`. Two independently populated tables agree.

Consequences:

- **No change is needed in `DobbsCore/content.js`.** The extension's exact-key match is safe.
- **`normalizeStudentId` is a no-op on every one of the 254 production IDs**, so the §14 backfill would rewrite nothing and the collision check returns empty.
- Decision 17 therefore costs nothing and remains worth keeping as insurance: if a future SIS export ever starts padding, normalisation absorbs it instead of forking every student's history.

The original analysis is kept below, because it is still the correct reasoning for *why* this had to be checked, and the risk returns the moment the export format changes.

#### The hazard, had PS padded

The extension matches students by **exact key equality** between PS and DobbsCore (`content.js:487, 515`):

```js
for (const s of await rosterResp.json()) dcidMap[s.studentnumber] = s.dcid;  // raw PS value
const dcid = dcidMap[s.student_id];                                          // our stored value
```

If we normalise `student_id` to `"12345"` while PS reports `studentnumber` as `"012345"`, **every score silently fails to match.** The extension counts them as `unmatched` and reports a total — it does not error, so a sync appears to succeed while pushing nothing.

The same normalisation must therefore be applied in `DobbsCore/content.js` at all three `dcidMap` constructions (lines 487, 708, 747) *and* at roster import (line 841). This is a one-line change in each place, but it lives in a **different repository** and must ship before or with the `student_id` backfill.

This only bites if PS returns `studentnumber` zero-padded as a JSON string. If PS returns it as a JSON number, JavaScript object keys already strip the padding and the two sides agree today by accident. **Confirm against live PS data before running the backfill** — the failure mode is silent.

---

## 8. Shared helpers

All in `server/db.js` or a small `server/wbl/logic.js`:

| Helper | Purpose |
|---|---|
| `normalizeStudentId(raw)` | Decision 17 — every write boundary |
| `resolveStudent(userKey)` | `class_students` lookup → `{student_id, memberships}` |
| `effectivePhase(programId, studentId)` | `COALESCE(override_phase, computed_phase)` |
| `recomputeAttainment(programId, studentId)` | Awards + phase, after every assessment write |
| `isoWeek(dateStr)` | `'YYYY-MM-DD'` → `'YYYY-Www'` |
| `requireProgramOwner(req, programId)` | `403` unless owned |

`isoWeek` is worth getting right rather than approximating — it is the key of the QC weekly cap, so an off-by-one at a year boundary would let a student be checked twice in one week or block a legitimate check:

```js
// ISO 8601: weeks start Monday; week 1 is the week containing the first Thursday.
function isoWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;                    // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);            // move to this week's Thursday
    const year = d.getUTCFullYear();                   // year of that Thursday
    const jan1 = Date.UTC(year, 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}
```

Taking the year from the Thursday is what makes 2026-12-28 land in `2026-W53` and 2027-01-01 land in `2026-W53` too, rather than splitting one week across two keys.

---

## 9. Build order

1. **Prerequisites** — extract `requireTeacher`, add `normalizeStudentId`, add the schema `db.exec` block and triggers to `server/db.js`
2. **Programs + enrollment** (§1) — nothing else works without a program
3. **Catalog** (§2) — authoring, with versioning correct from the start
4. **Work events** (§4) — jobs and participants
5. **Assessment** (§5) + `recomputeAttainment` — the core loop; end-to-end value lands here
6. **Student-facing** (§6) — Do Now / Exit Slip / claims
7. **Rotation + floor** (§7)
8. **Sync** (§7) — last, because it is the only group that writes to an external system
9. **Import + drift** (§3) — deferrable until a second instructor needs it
10. **Migration** (schema §11) — Phase B backfill, then Phase C retirement

Steps 2–6 are a working system. Sync, import, and the `mc_*` migration are all additive after that.

---

## 10. Open questions

- ~~**`student_id` padding in PowerSchool.**~~ *Closed 2026-08-23 — PS does not pad; see §7. No DobbsCore change needed, and the backfill is a no-op on current data.*
- **Do Now / Exit Slip has no submission window.** Nothing stops a student filing an exit slip for a date weeks past, or a Do Now at 3pm. `UNIQUE(program_id, student_id, date)` prevents duplicates, not backdating. Whether that needs a guard is a classroom-policy question, not a schema one.
- **No bulk assessment endpoint.** Assessing one skill for twenty students on a shared job is twenty `PUT`s. Fine at classroom scale, worth revisiting if instructors find it slow.
