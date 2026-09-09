# WBL Assessment Framework — Data Model
### Schema design, v2 — companion to `WBL_Assessment_Framework.md`

---

## 0. Decisions this design encodes

| # | Decision | Consequence |
|---|---|---|
| 1 | Build `wbl_*`, then migrate `mc_*` into it and retire it | New authoritative model; phased migration in §11 |
| 2 | Work Event = shared job entity + per-student participant rows | Team jobs, job-level QC, multi-week lifecycle all representable |
| 3 | Catalog is teacher-owned | Ownership lives on `wbl_programs.teacher_key` and nowhere else |
| 4 | PowerSchool sync from day one, at three grains | Credential award, Holistic Call, Transfer score each sync |
| 5 | Hard skills migrate at v1; "Habits of Mind" is dismantled, not migrated | Its 5 checkpoints become the built-in soft-skill catalog |
| 6 | Phase = auto-computed from prerequisites + instructor override | `wbl_phase2_prereqs` + `wbl_student_phase`, both program-keyed |
| 7 | Skill versions are pinned on assessments; evidence carries forward | Credential requirements reference the skill *lineage*, not a version |
| **8** | **`program` is the unit of progression; `class` is roster + gradebook** | Credentials and phase survive section changes and school years |
| **9** | **Invariants are enforced by triggers, not convention** | Do Now cap and exit-slip *edit* protection live in the database |
| **10** | **Exit slips are voided, never edited** | Append-only `wbl_exit_slip_voids`; original row never mutated |
| **11** | **QC floor alerts, does not gate** | Denominator is *active* weeks, not calendar weeks |
| **12** | **Programs stay separate; catalogs are importable** | `wbl_program_imports` + `source_*` provenance columns |
| **13** | **Transfer claims may cite across programs** | Verification searches the student's whole record |
| **14** | **A retired skill keeps old evidence, blocks new assessment** | Confirmed as designed |
| **15** | **Exit slips block UPDATE, permit DELETE** | Falsification is prevented; erasure stays possible |
| **16** | **Program enrollment is explicit, not derived** | `wbl_program_enrollments` carries pathway year and exit |
| **17** | **`student_id` has a canonical form; leading zeros ignored** | Normalise on ingest + one-time backfill of 6 existing columns |
| **18** | **Import conflicts merge by link, never rename** | Existing local row adopts `source_*`; content is left alone |

### House rules inherited from `server/db.js`

- `PRAGMA foreign_keys = OFF`. **`REFERENCES` is documentation only and is never enforced.** No `ON DELETE CASCADE` appears below, because it would not fire — every cascade must be written explicitly in the route layer.
- **Triggers are unaffected by that pragma** and do fire. That is what makes decision 9 available.
- Timestamps are `INTEGER` epoch-ms (`Date.now()`); calendar dates are `TEXT` `YYYY-MM-DD`.
- Students are addressed by `student_id` — the school-assigned ID — matching `mc_completions` and `daily_rubric`, not by `user_key`.
- Schema ships as one `db.exec` block; later changes go through `try { ALTER TABLE } catch {}`.

### The program / class split (decision 8)

The single most consequential change from v1. Two different things were conflated under `class_id`:

| Dimension | Owner | Carries |
|---|---|---|
| **Program** | `wbl_programs` | Curriculum and progression — skills, credentials, QC criteria, phase, awards |
| **Class** | existing `classes` | Roster and gradebook — who is enrolled, which PS section to push to |

Keying progression to the class meant a student re-taking Carpentry the following year reset to Phase 1 with an empty credential history — which also left Application of Previous Knowledge permanently near-empty, since that lens is defined as citing prior credentials. Keying it to the program fixes that, fixes section changes mid-year, and lets one class period contain students working in two different sectors.

---

## 1. Programs and catalog

```sql
-- The WBL environment: Apparel Decoration, Carpentry Job Shop, etc.
-- Owns the catalog and is the unit of student progression.
-- Ownership lives HERE and is not denormalized onto child tables, so there
-- is exactly one source of truth for who a credential belongs to.
CREATE TABLE IF NOT EXISTS wbl_programs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_key             TEXT    NOT NULL,
    name                    TEXT    NOT NULL,
    description             TEXT    NOT NULL DEFAULT '',
    -- QC fairness floor (§6): alert when a student goes this many ACTIVE
    -- weeks without a spot check. Per program, since job rhythms differ.
    qc_max_weeks_unchecked  INTEGER NOT NULL DEFAULT 3,
    -- Opt-in: may another instructor import a copy of this catalog? (§1.1)
    shareable               INTEGER NOT NULL DEFAULT 0,
    archived_at             INTEGER,
    created_at              INTEGER NOT NULL,
    UNIQUE(teacher_key, name)
);

-- Which sections participate in which program. Many-to-many, so one class
-- period can span two sectors and one program can run across sections.
CREATE TABLE IF NOT EXISTS wbl_class_programs (
    class_id   INTEGER NOT NULL REFERENCES classes(id),
    program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
    PRIMARY KEY (class_id, program_id)
);

-- Decision 12: programs remain separately owned, but a catalog can be
-- copied for parity. Recorded as a relationship rather than a flag, so
-- drift against the source stays detectable (§1.1).
CREATE TABLE IF NOT EXISTS wbl_program_imports (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    target_program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
    source_program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
    mode              TEXT    NOT NULL DEFAULT 'tracked'
                      CHECK(mode IN ('snapshot','tracked')),
    imported_by       TEXT    NOT NULL,
    imported_at       INTEGER NOT NULL,
    UNIQUE(target_program_id, source_program_id)
);

-- A micro-credential. min_holistic_tier is the "minimum Gross Output
-- threshold" from §4.1: technique only counts toward mastery on work that
-- shipped acceptably.
CREATE TABLE IF NOT EXISTS wbl_credentials (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id        INTEGER NOT NULL REFERENCES wbl_programs(id),
    name              TEXT    NOT NULL,
    description       TEXT    NOT NULL DEFAULT '',
    min_holistic_tier TEXT    NOT NULL DEFAULT 'meets',
    order_idx         INTEGER NOT NULL DEFAULT 0,
    -- Import provenance (§1.1); NULL for locally authored credentials.
    source_credential_id INTEGER REFERENCES wbl_credentials(id),
    archived_at       INTEGER,
    created_at        INTEGER NOT NULL,
    UNIQUE(program_id, name)
);

-- Skill LINEAGE: stable identity that survives re-versioning. Carries no
-- definition of its own — everything editable lives on the version.
CREATE TABLE IF NOT EXISTS wbl_skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id  INTEGER NOT NULL REFERENCES wbl_programs(id),
    slug        TEXT    NOT NULL,
    -- Import provenance (§1.1); NULL for locally authored skills.
    source_skill_id INTEGER REFERENCES wbl_skills(id),
    archived_at INTEGER,
    created_at  INTEGER NOT NULL,
    UNIQUE(program_id, slug)
);

-- Versioned rather than edited in place (§4.1). A published version is
-- immutable; changing scope means publishing version_no + 1.
CREATE TABLE IF NOT EXISTS wbl_skill_versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id     INTEGER NOT NULL REFERENCES wbl_skills(id),
    version_no   INTEGER NOT NULL,
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','published','retired')),
    is_current   INTEGER NOT NULL DEFAULT 0,
    change_note  TEXT    NOT NULL DEFAULT '',
    -- Import provenance (§1.1). source_version_no is what makes drift
    -- detection free: compare it against the upstream skill's current
    -- version_no and you know exactly how far behind this copy is.
    source_version_id INTEGER REFERENCES wbl_skill_versions(id),
    source_version_no INTEGER,
    published_at INTEGER,
    created_at   INTEGER NOT NULL,
    UNIQUE(skill_id, version_no)
);

-- Exactly one current version per lineage.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wbl_skill_current
    ON wbl_skill_versions(skill_id) WHERE is_current = 1;

-- The mastery checklist. Belongs to the VERSION, since editing a checklist
-- item is itself a scope change.
CREATE TABLE IF NOT EXISTS wbl_skill_criteria (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_version_id INTEGER NOT NULL REFERENCES wbl_skill_versions(id),
    name             TEXT    NOT NULL,
    order_idx        INTEGER NOT NULL
);

-- Decision 9 applied to the catalog: a PUBLISHED version's content cannot be
-- edited, only superseded. This is what makes skill_version_id on an
-- assessment a durable record of what a student was assessed against.
-- Narrowed to UPDATE OF name, description so that publish/retire — which
-- write status and is_current — still work.
CREATE TRIGGER IF NOT EXISTS trg_wbl_skill_version_published_immutable
BEFORE UPDATE OF name, description ON wbl_skill_versions
FOR EACH ROW WHEN OLD.status = 'published'
BEGIN
    SELECT RAISE(ABORT, 'Published skill versions are immutable — publish a new version');
END;

-- Credential requirements reference the LINEAGE, which is what makes
-- decision 7 work: v1 evidence still counts after v2 publishes.
-- required_demonstrations = the "multiple Work Events, varying conditions" rule.
CREATE TABLE IF NOT EXISTS wbl_credential_skills (
    credential_id           INTEGER NOT NULL REFERENCES wbl_credentials(id),
    skill_id                INTEGER NOT NULL REFERENCES wbl_skills(id),
    required_demonstrations INTEGER NOT NULL DEFAULT 2,
    order_idx               INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (credential_id, skill_id)
);

-- QC Spot Check criteria: measurable, objective, program-authored (§4.2a).
CREATE TABLE IF NOT EXISTS wbl_qc_criteria (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id  INTEGER NOT NULL REFERENCES wbl_programs(id),
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    order_idx   INTEGER NOT NULL DEFAULT 0,
    -- Import provenance (§1.1); NULL for locally authored criteria.
    source_criterion_id INTEGER REFERENCES wbl_qc_criteria(id),
    archived_at INTEGER,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wbl_programs_teacher   ON wbl_programs(teacher_key);
CREATE INDEX IF NOT EXISTS idx_wbl_prog_imports_src   ON wbl_program_imports(source_program_id);
CREATE INDEX IF NOT EXISTS idx_wbl_class_programs_prog ON wbl_class_programs(program_id);
CREATE INDEX IF NOT EXISTS idx_wbl_credentials_prog   ON wbl_credentials(program_id);
CREATE INDEX IF NOT EXISTS idx_wbl_skills_prog        ON wbl_skills(program_id);
CREATE INDEX IF NOT EXISTS idx_wbl_skill_versions_skill ON wbl_skill_versions(skill_id);
CREATE INDEX IF NOT EXISTS idx_wbl_skill_criteria_ver ON wbl_skill_criteria(skill_version_id);
CREATE INDEX IF NOT EXISTS idx_wbl_qc_criteria_prog   ON wbl_qc_criteria(program_id);
```

### 1.1 Importing a catalog for parity (decision 12)

Programs stay separately owned — two Carpentry instructors keep two programs, two rosters, two gradebooks. What crosses the boundary is the **catalog only**, copied on request so both instructors can run the same credential map.

**Copied on import**, with every new row stamped with its `source_*` id:

`wbl_credentials` → `wbl_skills` → `wbl_skill_versions` (current published version only) → `wbl_skill_criteria` → `wbl_credential_skills` → `wbl_qc_criteria` → `wbl_skill_openings` → `wbl_phase2_prereqs` → `wbl_holistic_tier_points` → `qc_max_weeks_unchecked`

**Never copied.** Student data has no business crossing programs: `wbl_credential_awards`, `wbl_skill_assessments`, `wbl_work_events` and participants, `wbl_qc_checks`, `wbl_holistic_calls`, `wbl_do_nows`, `wbl_exit_slips`, `wbl_transfer_claims`, `wbl_student_phase`, and every `*_sync` table (PS assignment IDs belong to the section that created them — copying one would push grades into someone else's gradebook).

**Drift detection comes free from the versioning you already have.** Because skills are versioned rather than edited in place, "has upstream changed?" is one comparison:

```sql
-- Imported skills whose source has published a newer version.
SELECT s.id, sv.name, sv.source_version_no AS imported_at_v, up.version_no AS upstream_v
FROM   wbl_skills s
JOIN   wbl_skill_versions sv ON sv.skill_id = s.id AND sv.is_current = 1
JOIN   wbl_skills src        ON src.id = s.source_skill_id
JOIN   wbl_skill_versions up ON up.skill_id = src.id AND up.is_current = 1
WHERE  s.program_id = ?
  AND  up.version_no > sv.source_version_no;
```

Re-pulling an updated skill is just the normal versioning workflow: publish a new local version copying the upstream definition, carrying the new `source_version_no`. Prior student evidence still counts, because credential requirements reference the lineage (decision 7). The two mechanisms compose without any special case.

`mode` distinguishes a **snapshot** (copy once, never look back — the importer intends to diverge) from **tracked** (surface drift and offer re-pulls). Only `tracked` programs appear in the query above.

**Import is opt-in via `wbl_programs.shareable`.** Default `0`, so no catalog is importable until its owner says so.

#### Conflict policy: merge by link, never rename (decision 18)

`UNIQUE(program_id, name)` on credentials and `UNIQUE(program_id, slug)` on skills mean an import can collide two ways: the target already authored something by the same name, or the same source is imported twice. Both resolve the same way, and **no schema support is required** — `source_*` is nullable and settable after the fact.

| Situation | Action |
|---|---|
| No local match | Insert a fresh copy, stamped with `source_*` |
| Local row matches by `name` / `slug`, `source_*` is NULL | **Adopt**: set `source_*` on the existing row. Content untouched. |
| Local row matches and already points at this source | No-op — this is a re-import, i.e. a drift check |
| Local row matches but points at a *different* source | Leave alone, report as a conflict for the instructor to resolve |

**Merging links, it does not overwrite.** An adopted row keeps whatever the local instructor authored; it simply becomes drift-tracked. The §1.1 drift query then immediately reports it as behind upstream, and the instructor pulls the update — or doesn't — through the ordinary version-publish flow. Content reconciliation is deliberately *not* a special path in the importer; it reuses machinery that already exists and that already preserves student evidence via decision 7.

This makes re-import idempotent: running it twice adopts nothing new and simply refreshes the drift report.

**Nothing an importer does propagates back.** `source_*` points upward only, drift is a read-only pull, and no write ever crosses a program boundary. An instructor may edit, extend, or ignore their copy freely without affecting the source program or any other importer of it — which is the guarantee that makes copy-on-demand sufficient in place of shared ownership.

One consequence to accept: if the *source* instructor deletes a skill, the drift query's inner join simply stops returning that row. The importer keeps their copy and silently stops being told about upstream changes to it. Harmless, but it is silent.

---

## 2. Fixed vocabularies

```sql
-- The five target soft skills. Fixed catalog — these are framework
-- mechanics, not per-program content, which is why they are seeded and
-- deliberately NOT modeled as credentials/skills.
CREATE TABLE IF NOT EXISTS wbl_soft_skills (
    code      TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    category  TEXT NOT NULL CHECK(category IN ('dispositional','transfer')),
    order_idx INTEGER NOT NULL DEFAULT 0
);

-- Four-tier holistic judgment. `rank` exists so min_holistic_tier
-- comparisons are a join, not a hardcoded CASE in every query.
CREATE TABLE IF NOT EXISTS wbl_holistic_tiers (
    tier  TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    rank  INTEGER NOT NULL
);
```

Seeded once with `INSERT OR IGNORE`:

| `wbl_soft_skills.code` | category |
|---|---|
| `persistence` | dispositional |
| `commitment_to_excellence` | dispositional |
| `academic_curiosity` | dispositional |
| `application_of_previous_knowledge` | transfer |
| `extension_of_knowledge` | transfer |

| `wbl_holistic_tiers.tier` | label | rank |
|---|---|---|
| `not_shippable` | Not shippable | 0 |
| `rework` | Rework needed | 1 |
| `meets` | Meets spec | 2 |
| `exceeds` | Exceeds spec | 3 |

---

## 3. Enrollment and phase state

```sql
-- Decision 16: a student's membership in a program is a fact in its own
-- right, not something inferred from whichever class they happen to be in.
-- Survives class deletion, answers "year 2 of 3", and records departure.
CREATE TABLE IF NOT EXISTS wbl_program_enrollments (
    program_id   INTEGER NOT NULL REFERENCES wbl_programs(id),
    student_id   TEXT    NOT NULL,
    pathway_year INTEGER NOT NULL DEFAULT 1,
    enrolled_on  TEXT    NOT NULL,
    exited_on    TEXT,
    exit_reason  TEXT    NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (program_id, student_id)
);

-- The Phase 1 → 2 transition trigger (§3), scoped per PROGRAM so the gate
-- is a property of the curriculum rather than of a section.
CREATE TABLE IF NOT EXISTS wbl_phase2_prereqs (
    program_id    INTEGER NOT NULL REFERENCES wbl_programs(id),
    credential_id INTEGER NOT NULL REFERENCES wbl_credentials(id),
    PRIMARY KEY (program_id, credential_id)
);

-- Effective phase = COALESCE(override_phase, computed_phase).
-- Program-keyed, so a student can be Phase 2 in Apparel and Phase 1 in
-- Carpentry — even inside the same class period — and does not reset on a
-- section change or a new school year.
CREATE TABLE IF NOT EXISTS wbl_student_phase (
    program_id      INTEGER NOT NULL REFERENCES wbl_programs(id),
    student_id      TEXT    NOT NULL,
    computed_phase  INTEGER NOT NULL DEFAULT 1 CHECK(computed_phase IN (1,2)),
    override_phase  INTEGER CHECK(override_phase IN (1,2)),
    override_by     TEXT    NOT NULL DEFAULT '',
    override_note   TEXT    NOT NULL DEFAULT '',
    transitioned_at INTEGER,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (program_id, student_id)
);

-- Phase 1 scaffolding (§3): which dispositional skills have natural
-- openings in which instructor-designed unit. Attached to the skill
-- lineage rather than inventing a separate "unit" entity.
CREATE TABLE IF NOT EXISTS wbl_skill_openings (
    skill_id        INTEGER NOT NULL REFERENCES wbl_skills(id),
    soft_skill_code TEXT    NOT NULL REFERENCES wbl_soft_skills(code),
    PRIMARY KEY (skill_id, soft_skill_code)
);

-- Active roster for a program, independent of any class.
CREATE INDEX IF NOT EXISTS idx_wbl_enroll_active
    ON wbl_program_enrollments(program_id) WHERE exited_on IS NULL;
```

`wbl_program_enrollments` and `wbl_class_programs` answer different questions and both are needed: enrollment says *who is in this pathway and for how long*, class linkage says *which section's gradebook their scores push to*. A student appears in exactly one enrollment row per program across their whole time in it, incrementing `pathway_year`, while moving through a different `class_id` each year.

---

## 4. The Work Event

```sql
-- The shared job/order/build, owned by a PROGRAM. No class_id: a job can
-- be worked by students from more than one section, and each participant
-- carries their own. The multi-week lifecycle lives here, and it is what
-- the weekly QC re-check rotation reads (§4.2a).
CREATE TABLE IF NOT EXISTS wbl_work_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id   INTEGER NOT NULL REFERENCES wbl_programs(id),
    title        TEXT    NOT NULL,
    external_ref TEXT,
    description  TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'active'
                 CHECK(status IN ('active','complete','cancelled')),
    opened_on    TEXT    NOT NULL,
    closed_on    TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- One student's involvement in one job. THIS is the row every assessment
-- hangs off — the three lenses all point at the same participant, which is
-- what makes "viewed through all three lenses at once" (§2) literal.
-- class_id is the gradebook dimension (which PS section to push to).
-- phase_at_start records which mechanics were live at the time, so the
-- historical record stays honest after a student advances.
CREATE TABLE IF NOT EXISTS wbl_work_event_participants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    work_event_id  INTEGER NOT NULL REFERENCES wbl_work_events(id),
    class_id       INTEGER NOT NULL REFERENCES classes(id),
    student_id     TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT '',
    phase_at_start INTEGER NOT NULL DEFAULT 1 CHECK(phase_at_start IN (1,2)),
    joined_on      TEXT    NOT NULL,
    left_on        TEXT,
    UNIQUE(work_event_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_wbl_we_program ON wbl_work_events(program_id, status);
CREATE INDEX IF NOT EXISTS idx_wbl_wep_event  ON wbl_work_event_participants(work_event_id);
CREATE INDEX IF NOT EXISTS idx_wbl_wep_student ON wbl_work_event_participants(student_id);
CREATE INDEX IF NOT EXISTS idx_wbl_wep_class  ON wbl_work_event_participants(class_id);
```

---

## 5. Lens 1 — Hard skills

```sql
-- Every Work Event, both phases. skill_version_id is PINNED at assessment
-- time; skill_id carries the credential linkage. student_id/class_id are
-- denormalized off the participant so roster queries skip the join.
CREATE TABLE IF NOT EXISTS wbl_skill_assessments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id   INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
    work_event_id    INTEGER NOT NULL REFERENCES wbl_work_events(id),
    program_id       INTEGER NOT NULL,
    class_id         INTEGER NOT NULL,
    student_id       TEXT    NOT NULL,
    skill_id         INTEGER NOT NULL REFERENCES wbl_skills(id),
    skill_version_id INTEGER NOT NULL REFERENCES wbl_skill_versions(id),
    result           TEXT    NOT NULL
                     CHECK(result IN ('not_demonstrated','developing','mastered')),
    note             TEXT    NOT NULL DEFAULT '',
    assessed_by      TEXT    NOT NULL,
    assessed_at      INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    UNIQUE(participant_id, skill_id)
);

CREATE TABLE IF NOT EXISTS wbl_skill_criterion_results (
    assessment_id INTEGER NOT NULL REFERENCES wbl_skill_assessments(id),
    criterion_id  INTEGER NOT NULL REFERENCES wbl_skill_criteria(id),
    met           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (assessment_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_wbl_sa_student ON wbl_skill_assessments(program_id, student_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_wbl_sa_event   ON wbl_skill_assessments(work_event_id);
```

---

## 6. Lens 2 — Gross Output

```sql
-- QC Spot Check. The UNIQUE constraint IS the "capped at once per student
-- per calendar week" rule — the DB enforces it, not the route layer.
-- Scoped per program so a student in two sectors can be checked in each.
-- iso_week is 'YYYY-Www' so weeks sort lexically.
CREATE TABLE IF NOT EXISTS wbl_qc_checks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
    work_event_id  INTEGER NOT NULL,
    program_id     INTEGER NOT NULL,
    class_id       INTEGER NOT NULL,
    student_id     TEXT    NOT NULL,
    iso_week       TEXT    NOT NULL,
    checked_on     TEXT    NOT NULL,
    checked_by     TEXT    NOT NULL,
    note           TEXT    NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    UNIQUE(program_id, student_id, iso_week)
);

CREATE TABLE IF NOT EXISTS wbl_qc_check_results (
    check_id     INTEGER NOT NULL REFERENCES wbl_qc_checks(id),
    criterion_id INTEGER NOT NULL REFERENCES wbl_qc_criteria(id),
    outcome      TEXT    NOT NULL CHECK(outcome IN ('pass','fail','na')),
    note         TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (check_id, criterion_id)
);

-- Holistic Output Call: the actual verdict, one per participant at job
-- completion. Deliberately NOT computed from QC history (§4.2b) — the QC
-- trail informs the instructor, it does not feed a formula.
CREATE TABLE IF NOT EXISTS wbl_holistic_calls (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
    work_event_id  INTEGER NOT NULL,
    program_id     INTEGER NOT NULL,
    class_id       INTEGER NOT NULL,
    student_id     TEXT    NOT NULL,
    tier           TEXT    NOT NULL REFERENCES wbl_holistic_tiers(tier),
    rationale      TEXT    NOT NULL DEFAULT '',
    called_by      TEXT    NOT NULL,
    called_at      INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    UNIQUE(participant_id)
);

CREATE INDEX IF NOT EXISTS idx_wbl_qc_student ON wbl_qc_checks(program_id, student_id, iso_week);
CREATE INDEX IF NOT EXISTS idx_wbl_qc_event   ON wbl_qc_checks(work_event_id);
CREATE INDEX IF NOT EXISTS idx_wbl_hc_student ON wbl_holistic_calls(program_id, student_id);
```

### The rotation queue is derived, not stored

For a program and ISO week, eligible students are those with a participant row on an `active` Work Event and no `wbl_qc_checks` row for that `(program_id, student_id, iso_week)`; order by their most recent `iso_week` ascending so the longest-unchecked surface first. No queue table, no drift, and multi-week jobs re-enter automatically because the job stays `active`.

### The fairness floor alerts, it does not gate (decision 11)

The cap is a constraint; the floor is a report. A student is **below floor** when their count of consecutive *active* weeks without a check exceeds `wbl_programs.qc_max_weeks_unchecked`.

**The denominator is active weeks, not calendar weeks.** A week in which the student had no participant row on an active job — absence, between jobs, school break — is not a coverage failure and must not count against the instructor. Measuring against calendar weeks produces an alert that is wrong most of the time and gets ignored, which is the failure mode this is meant to prevent.

Deliberately not a gate: no live QC data exists yet to set a defensible threshold against, and a guessed threshold that fires constantly gets switched off.

---

## 7. Lens 3a — Dispositional soft skills (formative, never scored)

```sql
CREATE TABLE IF NOT EXISTS wbl_do_nows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id   INTEGER NOT NULL REFERENCES wbl_programs(id),
    class_id     INTEGER NOT NULL REFERENCES classes(id),
    student_id   TEXT    NOT NULL,
    date         TEXT    NOT NULL,
    submitted_at INTEGER NOT NULL,
    UNIQUE(program_id, student_id, date)
);

-- from_skill_id is the instructor-pre-identified opening in Phase 1; NULL in
-- Phase 2, where selection is self-directed against unscoped work.
CREATE TABLE IF NOT EXISTS wbl_do_now_skills (
    do_now_id       INTEGER NOT NULL REFERENCES wbl_do_nows(id),
    soft_skill_code TEXT    NOT NULL REFERENCES wbl_soft_skills(code),
    from_skill_id   INTEGER REFERENCES wbl_skills(id),
    PRIMARY KEY (do_now_id, soft_skill_code)
);

-- IMMUTABLE (§4.3.1). Note the deliberate absence of an updated_at column.
-- Enforced by trigger below, not by convention.
CREATE TABLE IF NOT EXISTS wbl_exit_slips (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    do_now_id       INTEGER NOT NULL REFERENCES wbl_do_nows(id),
    program_id      INTEGER NOT NULL,
    class_id        INTEGER NOT NULL,
    student_id      TEXT    NOT NULL,
    date            TEXT    NOT NULL,
    work_event_id   INTEGER REFERENCES wbl_work_events(id),
    soft_skill_code TEXT    NOT NULL REFERENCES wbl_soft_skills(code),
    narrative       TEXT    NOT NULL,
    submitted_at    INTEGER NOT NULL,
    UNIQUE(do_now_id, soft_skill_code)
);

-- The confidence gradient (§4.3.1), kept as data rather than collapsed into
-- a single credited flag. NO row = student_claimed; an instructor appends a
-- row to raise it. Append-only, so a later witnessing doesn't erase the
-- earlier verification.
CREATE TABLE IF NOT EXISTS wbl_exit_slip_verifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exit_slip_id INTEGER NOT NULL REFERENCES wbl_exit_slips(id),
    confidence   TEXT    NOT NULL CHECK(confidence IN
                 ('instructor_verified','instructor_witnessed')),
    verified_by  TEXT    NOT NULL,
    note         TEXT    NOT NULL DEFAULT '',
    verified_at  INTEGER NOT NULL
);

-- Decision 10: the escape hatch for accidental or junk submissions.
-- The slip itself is NEVER mutated; this marks it excluded, and both the
-- original and the void stay visible. Same append-only shape as
-- wbl_exit_slip_verifications.
CREATE TABLE IF NOT EXISTS wbl_exit_slip_voids (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exit_slip_id INTEGER NOT NULL REFERENCES wbl_exit_slips(id),
    reason       TEXT    NOT NULL,
    voided_by    TEXT    NOT NULL,
    voided_at    INTEGER NOT NULL,
    UNIQUE(exit_slip_id)
);

-- Feedback delivered FORWARD via the next Do Now, never as a correction to a
-- prior entry (§4.3.1). delivered_do_now_id is stamped when the student
-- actually sees it, which is also how "the next Do Now" is resolved.
CREATE TABLE IF NOT EXISTS wbl_dispositional_feedback (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id          INTEGER NOT NULL,
    student_id          TEXT    NOT NULL,
    exit_slip_id        INTEGER REFERENCES wbl_exit_slips(id),
    body                TEXT    NOT NULL,
    author_key          TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    delivered_do_now_id INTEGER REFERENCES wbl_do_nows(id),
    delivered_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wbl_donow_student ON wbl_do_nows(program_id, student_id, date);
CREATE INDEX IF NOT EXISTS idx_wbl_slip_student  ON wbl_exit_slips(program_id, student_id, date);
CREATE INDEX IF NOT EXISTS idx_wbl_slip_donow    ON wbl_exit_slips(do_now_id);
CREATE INDEX IF NOT EXISTS idx_wbl_fb_undelivered
    ON wbl_dispositional_feedback(program_id, student_id) WHERE delivered_at IS NULL;
```

### Invariant triggers (decision 9)

```sql
-- "one (capped at two) dispositional skill(s)" — §4.3.1
CREATE TRIGGER IF NOT EXISTS trg_wbl_do_now_skill_cap
BEFORE INSERT ON wbl_do_now_skills
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM wbl_do_now_skills WHERE do_now_id = NEW.do_now_id) >= 2
BEGIN
    SELECT RAISE(ABORT, 'A Do Now may focus on at most two dispositional skills');
END;

-- "Exit Slip entries are never edited or resubmitted" — §4.3.1.
-- This is the framework's most load-bearing invariant: the entire
-- dispositional lens rests on the reflection being an in-the-moment artifact.
CREATE TRIGGER IF NOT EXISTS trg_wbl_exit_slip_no_update
BEFORE UPDATE ON wbl_exit_slips
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Exit slips are immutable — record a void instead');
END;
```

**There is deliberately no DELETE trigger (decision 15).**

The invariant §4.3.1 states is a prohibition on **falsification** — "never edited or resubmitted" — and the UPDATE trigger enforces exactly that. Deletion is a different act, and blocking it would have cost more than it bought:

- `RAISE(ABORT)` rolls back the **entire enclosing transaction**, not just the row. In a codebase where `foreign_keys = OFF` makes every cascade hand-written, the first class-deletion route to reach this table would abort — and any sweep not already wrapped in a transaction would leave a partial delete behind: assessments gone, slips remaining, orphaned participant references.
- Restoring the trigger around a legitimate purge requires `DROP TRIGGER` / re-`CREATE` inside a transaction (a `try/finally` is *not* sufficient — a process killed mid-purge leaves the trigger silently gone forever). That escape hatch is more moving parts than the guarantee is worth.
- This is school data. A database whose default posture is "deletion refused" is a liability against a records-retention obligation or an erasure request.

The two failure modes are also not symmetrical:

| | Detectable afterward? |
|---|---|
| **Silent edit** | No — the record looks authentic and is wrong |
| **Deletion** | Yes — row counts drop, a `do_now_id` has no slip, gaps are visible |

Editing destroys the framework's claim invisibly; deletion is auditable by absence. The UPDATE trigger closes the dangerous one, and `wbl_exit_slip_voids` already covers the pedagogical case. Physical deletion is left to mean one thing only: a genuine purge.

**Nothing in §7 is scored and nothing here syncs to PowerSchool.** These tables carry no points column at all, so scoring a dispositional skill would require a schema change rather than a settings toggle.

---

## 8. Lens 3b — Transfer skills (dormant Phase 1, scored Phase 2)

```sql
-- Citation-based claims, fact-checked against the student's own record.
-- Verification is genuinely mutable (an instructor can correct a fact-check),
-- so unlike exit slips the verdict lives inline rather than in an append log.
CREATE TABLE IF NOT EXISTS wbl_transfer_claims (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id      INTEGER NOT NULL REFERENCES wbl_work_event_participants(id),
    work_event_id       INTEGER NOT NULL,
    program_id          INTEGER NOT NULL,
    class_id            INTEGER NOT NULL,
    student_id          TEXT    NOT NULL,
    kind                TEXT    NOT NULL CHECK(kind IN ('application','extension')),
    -- application: the prior credential/skill being cited. cited_program_id
    -- MAY differ from program_id (decision 13) — citing a Carpentry
    -- credential while working an Apparel job is explicitly allowed, and is
    -- the most pedagogically interesting form of transfer the framework has.
    cited_skill_id      INTEGER REFERENCES wbl_skills(id),
    cited_credential_id INTEGER REFERENCES wbl_credentials(id),
    cited_program_id    INTEGER REFERENCES wbl_programs(id),
    -- extension: the new capability the student names
    new_capability      TEXT    NOT NULL DEFAULT '',
    claim_text          TEXT    NOT NULL,
    submitted_at        INTEGER NOT NULL,
    -- instructor fact-check (record-checking, not subjective judgment)
    verdict             TEXT    CHECK(verdict IN
                        ('verified','citation_not_on_record','not_novel','insufficient')),
    score               REAL,
    verify_note         TEXT    NOT NULL DEFAULT '',
    verified_by         TEXT,
    verified_at         INTEGER,
    UNIQUE(participant_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_wbl_tc_student ON wbl_transfer_claims(program_id, student_id);
CREATE INDEX IF NOT EXISTS idx_wbl_tc_pending ON wbl_transfer_claims(program_id) WHERE verdict IS NULL;
```

`citation_not_on_record` and `not_novel` are what make this "semi-self-verifying" (§4.3.2): both are answerable by querying `wbl_credential_awards` and `wbl_skill_assessments` for that student, so the UI pre-answers them before the instructor looks. That is the low-burden claim, made mechanical.

**Decision 8 is what makes this lens work at all.** Application of Previous Knowledge cites prior credentials; because awards are now program-scoped rather than class-scoped, a second-year student's citations resolve against everything they earned in year one.

### Cross-program citation (decision 13)

Verification searches the student's **entire** record, not one program:

```sql
-- Does the cited credential actually exist on this student's record, anywhere?
SELECT a.id, a.program_id, p.name AS program_name, c.name AS credential_name
FROM   wbl_credential_awards a
JOIN   wbl_credentials c ON c.id = a.credential_id
JOIN   wbl_programs    p ON p.id = a.program_id
WHERE  a.student_id = ? AND a.credential_id = ? AND a.revoked_at IS NULL;
```

Three consequences worth stating plainly:

1. **`citation_not_on_record` gets stronger.** It now means "not on record in any program," which is the verdict an instructor actually wants.

2. **`not_novel` must also go program-wide — and it sharpens the two lenses against each other.** If a student claims Extension of Knowledge for a capability they already hold a credential for *in another program*, that isn't new learning; it's Application wearing the wrong label. The UI should catch this and say so: *"You already hold this credential in Carpentry — did you mean Application of Previous Knowledge?"* Framework §4.3.2 distinguishes the two lenses by novelty, and novelty is only meaningful when measured against the student's whole history.

3. **This is the first place the program boundary is deliberately crossed.** The Apparel instructor verifying a claim must read award rows owned by the Carpentry instructor. That crossing is narrow and read-only — *does student X hold credential Y, and what is it called* — but it is a real permission the API has to grant explicitly, and it is the one exception to decision 12's "programs stay separate." No writes ever cross.

---

## 9. Credential attainment

```sql
-- Keyed to the STUDENT within a PROGRAM, not to a class (decision 8), so a
-- credential survives section changes and school years. earned_in_class_id
-- records where it was earned, which is what PS sync pushes against.
CREATE TABLE IF NOT EXISTS wbl_credential_awards (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id     INTEGER NOT NULL REFERENCES wbl_credentials(id),
    program_id        INTEGER NOT NULL REFERENCES wbl_programs(id),
    student_id        TEXT    NOT NULL,
    earned_in_class_id INTEGER REFERENCES classes(id),
    awarded_at        INTEGER NOT NULL,
    source            TEXT    NOT NULL DEFAULT 'auto'
                      CHECK(source IN ('auto','manual','migrated')),
    awarded_by        TEXT    NOT NULL DEFAULT '',
    note              TEXT    NOT NULL DEFAULT '',
    revoked_at        INTEGER,
    revoked_note      TEXT    NOT NULL DEFAULT '',
    UNIQUE(credential_id, student_id)
);

-- "A micro-credential must rest on a defensible, complete evidence trail"
-- (§6). Snapshots exactly which assessments satisfied the award, so the
-- trail survives later catalog edits.
CREATE TABLE IF NOT EXISTS wbl_award_evidence (
    award_id      INTEGER NOT NULL REFERENCES wbl_credential_awards(id),
    skill_id      INTEGER NOT NULL,
    assessment_id INTEGER NOT NULL REFERENCES wbl_skill_assessments(id),
    PRIMARY KEY (award_id, assessment_id)
);

CREATE INDEX IF NOT EXISTS idx_wbl_awards_student ON wbl_credential_awards(program_id, student_id);
```

### The credentialing rule, as a query

A demonstration counts only when it is **mastered**, on a Work Event whose **Holistic Call cleared the credential's threshold**, and it must recur across **distinct Work Events**:

```sql
SELECT cs.skill_id, COUNT(DISTINCT sa.work_event_id) AS demos
FROM   wbl_credential_skills cs
JOIN   wbl_skill_assessments sa
       ON sa.skill_id   = cs.skill_id
      AND sa.program_id = ? AND sa.student_id = ?
      AND sa.result     = 'mastered'
JOIN   wbl_holistic_calls hc ON hc.participant_id = sa.participant_id
JOIN   wbl_holistic_tiers ht ON ht.tier = hc.tier
JOIN   wbl_credentials    c  ON c.id    = cs.credential_id
JOIN   wbl_holistic_tiers mt ON mt.tier = c.min_holistic_tier
WHERE  cs.credential_id = ?
  AND  ht.rank >= mt.rank
GROUP BY cs.skill_id
HAVING demos >= cs.required_demonstrations;
```

Award when that returns a row for every skill in `wbl_credential_skills` for the credential. It never filters on `skill_version_id` — that omission *is* decision 7 — and it filters on `program_id` rather than `class_id`, which is decision 8.

---

## 10. PowerSchool sync

Three grains, mirroring the existing `mc_class_assignments` / `mc_checkpoint_sync` pair so the push logic in `server/routes/teacher.js` can be adapted rather than rewritten. **Sync stays class-keyed** — you push a grade to a PS section — even though progression is program-keyed.

Credentials sync as **completion grades, not partial mastery**, in two passes that mirror the `mc_*` checkpoint/summative split teachers already use:

| Pass | Grain | PS category | Score |
|---|---|---|---|
| Skills | one assignment per **(credential, skill)** | Formative | `0` / `100` — is the skill satisfied? |
| Credential | one assignment per credential | Summative | `0` / `100` — is it awarded? |
| Work Event | one assignment per completed job | Summative | Holistic tier × `points_pct` |
| Transfer | one per class per kind | Summative | Sum of verified claim scores |

The skill grain is keyed on the **pair**, not the skill alone: thresholds (`min_holistic_tier`, `required_demonstrations`) belong to the credential, so one skill required by two credentials can be satisfied for one and not the other. That ambiguity could not arise in `mc_*`, where a checkpoint belonged to exactly one microcredential.

```sql
-- One formative PS assignment per skill WITHIN a credential.
CREATE TABLE IF NOT EXISTS wbl_credential_skill_sync (
    credential_id           INTEGER NOT NULL REFERENCES wbl_credentials(id),
    skill_id                INTEGER NOT NULL REFERENCES wbl_skills(id),
    class_id                INTEGER NOT NULL REFERENCES classes(id),
    ps_assignment_id        TEXT,
    ps_assignmentsection_id TEXT,
    sync_enabled            INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (credential_id, skill_id, class_id)
);

-- One summative PS assignment per credential per class.
CREATE TABLE IF NOT EXISTS wbl_credential_sync (
    credential_id           INTEGER NOT NULL REFERENCES wbl_credentials(id),
    class_id                INTEGER NOT NULL REFERENCES classes(id),
    ps_assignment_id        TEXT,
    ps_assignmentsection_id TEXT,
    sync_enabled            INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (credential_id, class_id)
);

-- One PS assignment per Work Event per class, carrying that job's Holistic
-- Calls. Composite key already handles a job worked by two sections.
CREATE TABLE IF NOT EXISTS wbl_work_event_sync (
    work_event_id           INTEGER NOT NULL REFERENCES wbl_work_events(id),
    class_id                INTEGER NOT NULL,
    ps_assignment_id        TEXT,
    ps_assignmentsection_id TEXT,
    sync_enabled            INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (work_event_id, class_id)
);

-- One PS assignment per transfer skill per class, accumulating across Work
-- Events. Per-Work-Event would mean two new PS assignments per job.
CREATE TABLE IF NOT EXISTS wbl_transfer_sync (
    class_id                INTEGER NOT NULL,
    kind                    TEXT    NOT NULL CHECK(kind IN ('application','extension')),
    ps_assignment_id        TEXT,
    ps_assignmentsection_id TEXT,
    sync_enabled            INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (class_id, kind)
);
```

Point values extend the existing per-teacher settings table:

```sql
ALTER TABLE gradebook_settings ADD COLUMN wbl_credential_max_score REAL NOT NULL DEFAULT 50;
ALTER TABLE gradebook_settings ADD COLUMN wbl_holistic_max_score   REAL NOT NULL DEFAULT 20;
ALTER TABLE gradebook_settings ADD COLUMN wbl_transfer_max_score   REAL NOT NULL DEFAULT 10;

-- Tier → points is per program, so "Rework needed" can be worth different
-- credit in Carpentry than in Apparel Decoration.
CREATE TABLE IF NOT EXISTS wbl_holistic_tier_points (
    program_id INTEGER NOT NULL REFERENCES wbl_programs(id),
    tier       TEXT    NOT NULL REFERENCES wbl_holistic_tiers(tier),
    points_pct REAL    NOT NULL,
    PRIMARY KEY (program_id, tier)
);
```

**A credential earned in a prior year has no section to push to.** When `earned_in_class_id` names a class outside the current term, the sync is skipped rather than retargeted — the grade already landed in the year it was earned, and re-pushing it would inflate the current term.

QC Spot Checks and everything in §7 have **no sync table by design**, matching the "Scored?" column of framework §5.

---

## 11. Migrating `mc_*`

Three phases, so the live gradebook is never broken mid-flight.

**Phase A — additive.** Create all `wbl_*` tables, triggers, and seeded vocabularies. `mc_*` keeps running untouched. Nothing user-visible changes.

**Phase B — backfill.** `mc_*` has no program concept, so the migration creates one:

1. One `wbl_programs` row per teacher who owns microcredentials, named from `teacher_profile.name` (falling back to the teacher key).
2. One `wbl_class_programs` row for every class that teacher owns.
3. Then, per credential:

| `mc_*` | → | `wbl_*` |
|---|---|---|
| `microcredentials` | → | `wbl_credentials` (under that teacher's program) |
| `mc_checkpoints` | → | `wbl_skills` (lineage) + `wbl_skill_versions` at **v1, published, is_current** |
| `mc_checkpoints.description` | → | `wbl_skill_versions.description` |
| `mc_subtasks` | → | `wbl_skill_criteria` on that v1 |
| `mc_completions` | → | `wbl_skill_assessments`, `result='mastered'`, against a synthetic per-student "Legacy Work Event" |
| `mc_subtask_completions` | → | `wbl_skill_criterion_results` |
| `mc_class_assignments` | → | `wbl_credential_sync` (PS IDs carry over — **no new PS assignments created**) |
| `mc_checkpoint_sync` | → | `wbl_credential_skill_sync` (PS IDs carry over; the checkpoint's credential supplies the extra key column) |

Migrated credentials get `required_demonstrations = 1` and a synthetic Holistic Call at `meets` on the legacy Work Event, so already-earned credentials do not silently un-earn under the stricter rule. Awards are written with `source = 'migrated'`, `earned_in_class_id` set from the original `mc_completions.class_id`, and no `wbl_award_evidence` beyond the legacy assessment.

**Because awards are now student-keyed, `UNIQUE(credential_id, student_id)` will collide** where a student completed the same credential in two classes. Take the earliest `completed_at` and keep its class as `earned_in_class_id`; log the discarded duplicates rather than dropping them silently.

**"Habits of Mind" is not migrated as a credential.** Its five checkpoints already *are* the five framework soft skills, so they map onto the seeded `wbl_soft_skills` codes instead. Existing `mc_completions` against them are archived, not converted — there is no scored destination for a dispositional skill in the new model, which is exactly the point of §4.3.1. `daily_rubric` is likewise archived rather than mapped; its timeliness / problem-solving / task-completion axes have no home in this framework.

**Phase C — retire.** Once the WBL UI is live: `ALTER TABLE ... RENAME TO legacy_mc_*` for the eight `mc_*` tables plus `daily_rubric`, then delete the `/api/teacher/microcredentials/*` and `/api/teacher/rubric*` blocks in `server/routes/teacher.js` (roughly lines 429–990) and the corresponding readers in `server/routes/student.js`.

---

## 12. Skill retirement (decision 14)

Confirmed as designed. When a skill version is `retired` and no `is_current` replacement exists:

- **Existing evidence still counts.** The credentialing query in §9 joins `wbl_skill_assessments` on `skill_id`, never on version status, so a student mid-credential is not penalised for a retirement that happened after they did the work.
- **No new assessment can be recorded**, because assessment requires an `is_current` version to pin.
- **The credential stays awardable** to anyone who already has the demonstrations, and becomes unreachable for anyone who does not.

That last consequence is the one to watch: retiring a skill silently strands every student who was partway through a credential requiring it. The API should refuse to retire a skill that still appears in a non-archived credential's `wbl_credential_skills` without an explicit `?force=true` and a count of the students it would strand.

---

## 13. Remaining open items

- **Multi-instructor co-ownership of one program.** *Closed — not needed.* Copy-on-demand (§1.1) is sufficient: an instructor adds to their own catalog without forcing the change on anyone else's, and may re-copy at any time. Should team-teaching a single section ever require true shared ownership, it stays additive — every catalog table hangs off `program_id` rather than a teacher key, so it's a `wbl_program_staff` join table and no constraint rebuilds.
- **Import conflict handling.** *Closed — decision 18, merge by link.* See §1.1.
- **`student_id` normalisation.** *Closed — decision 17.* See §14. The one item here that touches **live production tables** and needs a collision check before it runs.

---

## 14. Year-over-year continuity

**Yes — a student's record persists across school years, and that was the point of decision 8.** Every table that holds student history is keyed on `student_id` plus `program_id`, never on `class_id`:

| Table | Key | Survives a new year? |
|---|---|---|
| `wbl_credential_awards` | `(credential_id, student_id)` | ✅ `earned_in_class_id` is provenance only |
| `wbl_student_phase` | `(program_id, student_id)` | ✅ returns as Phase 2 |
| `wbl_skill_assessments` | queried by `(program_id, student_id)` | ✅ |
| `wbl_qc_checks` | `(program_id, student_id, iso_week)` | ✅ `iso_week` carries the year |
| `wbl_do_nows` | `(program_id, student_id, date)` | ✅ `date` carries the year |
| `wbl_exit_slips`, `wbl_transfer_claims`, `wbl_holistic_calls` | student- and program-scoped | ✅ |

Concretely, a returning second-year Carpentry student: keeps every credential, stays Phase 2 rather than reverting to Phase 1, keeps their full exit-slip history, and can cite year-one credentials under Application of Previous Knowledge. A skill demonstrated once in year one and once in year two satisfies `required_demonstrations = 2` **across the year boundary** — which is arguably the truest form of "under varying conditions" the framework describes.

### The join point is `student_id` — canonical form (decision 17)

All of that depends on next year's roster import producing the **same `student_id` string**. It is a `TEXT` comparison, so without normalisation these are three different students:

```
"0012345"   "12345"   "12345 "
```

A CSV exported with different column settings, a different SIS report, or a spreadsheet round-trip that strips leading zeros would silently fork a student's history — they arrive as a brand-new person, back at Phase 1 with no credentials, and nothing errors.

Leading zeros carry no meaning here, so the canonical form strips them:

```js
// server/db.js — apply at EVERY write boundary accepting a student ID:
// roster import, WBL enrollment, assessment writes, IT asset assignment.
function normalizeStudentId(raw) {
    const s = String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) return s;            // non-numeric: trim only, never strip
    const stripped = s.replace(/^0+/, '');
    return stripped === '' ? '0' : stripped;    // "000" → "0", never ""
}
```

Two guards are deliberate. Non-numeric IDs are trimmed but never stripped, so an alphanumeric scheme (`"0A1234"`) can't be silently mangled if the school ever changes format. And an all-zeros ID collapses to `"0"` rather than the empty string, which would otherwise become an invisible catch-all key.

### The backfill is the risky part

Normalising *going forward* while leaving existing rows padded would fork every current student — the exact failure this is meant to prevent. Six columns across the live schema carry a student ID and must migrate together, in one transaction:

| Table | Column | Note |
|---|---|---|
| `class_students` | `student_id` | `UNIQUE(class_id, student_id)` |
| `mc_completions` | `student_id` | archived at Phase C, but the §11 backfill reads it first |
| `mc_subtask_completions` | `student_id` | as above |
| `daily_rubric` | `student_id` | archived; normalise for consistency |
| `it_students` | `student_id` | **PRIMARY KEY — highest collision risk** |
| `it_assets` | `assigned_student_id` | must move in lockstep with `it_students` |

**Run the collision check before writing anything.** If both `"0012345"` and `"12345"` already exist as separate rows, normalisation would violate a primary key or silently merge two students:

```sql
-- Assumes numeric IDs; ltrim(x,'0') strips leading zeros only.
SELECT norm, COUNT(*) AS variants, GROUP_CONCAT(student_id) AS raw_ids
FROM (
    SELECT DISTINCT student_id,
           CASE WHEN ltrim(student_id,'0') = '' THEN '0' ELSE ltrim(student_id,'0') END AS norm
    FROM class_students
    UNION
    SELECT DISTINCT student_id,
           CASE WHEN ltrim(student_id,'0') = '' THEN '0' ELSE ltrim(student_id,'0') END
    FROM it_students
)
GROUP BY norm HAVING variants > 1;
```

An empty result means the backfill is safe. Any rows returned are students whose records are *already* forked today — resolve those by hand first, because which record survives is a judgement call the migration can't make.

> **Checked against production, 2026-08-23.** No ID in either table carries a leading zero or a non-digit: `class_students` holds 17 (1 five-digit, 16 six-digit) and `it_students` holds 237 (35 five-digit, 202 six-digit). The 36 unpadded five-digit IDs prove PowerSchool is not padding — under a padding scheme they would be six characters starting with `0`. The collision check returns empty and the backfill rewrites nothing.
>
> Normalisation is therefore **insurance, not a repair**. Keep it applied at write boundaries so a future export format that starts padding is absorbed rather than forking every student's history.

This runs **before** the §11 Phase B backfill, so WBL history is built on canonical IDs from the start. It's worth doing regardless of the WBL work: it fixes the same latent duplicate-student bug in the IT asset tooling.

### Two secondary risks

**Deleting an old class.** `DELETE /api/teacher/classes/:id` with `foreign_keys = OFF` won't cascade. Awards are safe — `earned_in_class_id` becoming a dangling reference costs nothing, since it's provenance. But `wbl_credential_sync` and `wbl_work_event_sync` rows for that class become orphaned PS assignment IDs. The class-deletion route should clear those explicitly.

**Enrollment — resolved by decision 16.** `wbl_program_enrollments` makes program membership a fact in its own right rather than something inferred from class rosters, so deleting an old class no longer removes a student from the program roster, and `pathway_year` answers "year 2 of 3" directly. Rolling a student into a new year is an increment on their existing enrollment row, not a new record — which keeps the "one student, one pathway history" property that decision 8 established.

---

## Next: the API

Route module `server/routes/wbl.js` mounted at `/api/wbl`, split behind `requireTeacher` and `requireAuth`, in six groups: **programs** (create, class linkage, QC floor), **catalog** (authoring plus version publish/retire), **work events** (jobs and participants), **assessment** (the three lenses against a participant), **student-facing** (Do Now / Exit Slip / transfer claims), and **sync** (PS push plus the derived rotation queue and floor report).
