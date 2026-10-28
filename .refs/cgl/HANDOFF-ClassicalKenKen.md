# Handoff: ClassicalKenKen changes for the Graphics & Printing (CGL) curriculum

**From:** the curriculum planning session, 2026-10-21
**For:** a Claude Code session working in `benjamindobbs/ClassicalKenKen` (deployed at classicaltech.org)
**Owner:** Ben Dobbs

## How to use this

Read this whole file before writing code, then read `.refs/WBL_Assessment_Framework.md`, `.refs/WBL_Schema_Design.md` and `.refs/WBL_API_Design.md`. Most of the WBL framework is already built, so most of this is extending it and loading data, not new architecture. Work on a branch, not `main`. Don't deploy (`fly.toml`) and don't run anything against the production database. Test against a copy of the DB or a fresh `data/` directory.

Confirm the decisions in **§9** with Ben before you build anything that depends on them. Everything else is ready to implement.

### Files that come with this handoff

Put these in `.refs/cgl/` (create the folder) so they stay with the repo:

| File | What it is |
|---|---|
| `graphics-printing-catalog-v2.csv` | The v2 credential catalog in the importer's column order (`credential, skill, description, criterion`). It has 8 credentials, 42 skills and 132 rows. The **Habits of Work** rows are removed on purpose (see §2). |
| `credential-changelog-2026-10-21.csv` | What changed from v1 to v2: one reworded skill description, 9 reworded criteria, and one new skill (Screen Reclaim & Cleanup) with 5 criteria. |
| `criteria-proposed-PENDING-APPROVAL.csv` | Proposed criteria for the 10 skills that currently have none. **Don't load these until Ben approves them.** |
| `cgl-work-event-templates.json` | Seed data: 54 Work Event templates (projects, practicals, modules), each with kind, evidence letter, planned skills and gate machine. It also has the shop role vocabulary, the machine list and the pacing floor. |

## 1. Context in one paragraph

Graphics & Printing Technology (the Classical Graphics Lab, or CGL) is a one-semester work-based learning course. Students try to earn all **9 micro-credentials**: Habits of Work, Adobe Illustrator, Silk Screening, Direct to Film, Embroidery, Digital Signmaking & Printing, Logistics & Operations, Marketing & Advertisement, and Storefront & Enterprise. There aren't enough jobs or machines for a linear sequence, so every day each student is in one of three **lanes**:

1. **Live job:** assigned through the CGL website. It always comes first.
2. **Station practical:** a scripted sign-off on one machine.
3. **Project library:** independent Illustrator projects and business modules.

Weeks 1–3 are whole-class onboarding, ending at the **Shop Ready** gate. After that it's open shop. Every job, practical, project and module is a **Work Event**. A skill counts toward a credential only when it has been shown on **more than one Work Event** with a Holistic Call of **Meets spec or better**. Grading stays 30% formative / 70% summative.

**Terms used below.** In this codebase a *credential* is a micro-credential, a *skill* is what the curriculum calls a *checkpoint*, and a *criterion* is a *subtask*.

## 2. Hands off: already done, don't change

- **Do Now, Exit Slips and the Habits of Work sync** already exist (`/me/do-now`, `/me/exit-slip`, `wbl_habits_sync`, `/sync/habits`). District policy says dispositional habits can't be graded. They're scored by the existing function, and DobbsCore syncs them to PowerSchool under the "Habits of Work" category. Don't change that behaviour.
- **The Habits of Work credential's 5 checkpoints are the built-in soft skills** (`wbl_soft_skills`, decision 5). Never import them as hard skills. That's why they're stripped from the catalog CSV.
- **These already exist and match the curriculum. Verify them, don't rebuild them:**
  - The four Holistic tiers: `not_shippable`, `rework`, `meets`, `exceeds`.
  - The QC Spot Check rotation and the floor alert.
  - Transfer claims with fact-check.
  - Versioned skills (publish and retire) with lineage-based credential requirements.
  - Skill Checks.
  - Phase 1/2 with instructor override.
- **The server never pushes to PowerSchool.** DobbsCore pulls. Don't add new gradebook categories unless DobbsCore changes ship with them (see §8).
- **House rules from `server/db.js`:**
  - `foreign_keys` is OFF.
  - Schema changes go through `try { ALTER TABLE } catch {}`.
  - Timestamps are epoch ms and dates are `YYYY-MM-DD`.
  - Students are addressed by canonical `student_id`.

## 3. Task A: fix the catalog importer, then load v2 (do this first)

`POST /api/wbl/programs/:id/catalog/import-csv` (`server/routes/wbl.js` around line 587) and `parseWblCsv` (`teacher/index.html` around line 3884) have four problems for this catalog.

1. **Skill slugs collide across credentials.**
   - The importer slugs on the skill name alone and looks skills up by `(program_id, slug)`.
   - Both **Direct to Film** and **Embroidery** have a skill called **"Machine Maintenance and Setup"**. Today the second one would merge into the first, giving one shared skill with DTF's criteria.
   - Fix: make the slug credential-qualified when the name already exists under a different credential, for example `direct-to-film--machine-maintenance-and-setup`. Don't change slugs that already exist (decision 18: merge by link, never rename).
   - Add a test that imports both and gets two skills with 3 and 5 criteria.
2. **The header row isn't recognised.**
   - Ben's credential files use the header `Microcredential,Checkpoint,Description,Subtask`. The parser only skips a header that reads `credential,skill`, so it would import a credential called "Microcredential".
   - Fix: accept both header spellings, case-insensitively. The provided CSV uses `credential,skill,…` already.
3. **Soft-skill rows aren't skipped.**
   - Skip any row whose credential is "Habits of Work", or whose skill name matches a `wbl_soft_skills.name`. Report the skipped count in the response.
4. **`required_demonstrations` is hard-coded to 1.**
   - The CGL rule is "more than one Work Event", so it needs to be **2**.
   - Fix: add an optional `required_demonstrations` field to the request body (default 1, so nothing else changes) and a number input next to the upload in the teacher UI.
   - Note that `credentialProgress` counts one Skill Check as one demonstration. That's fine: a Skill Check plus one job is 2.

**Then load the catalog.** First check whether a Graphics & Printing program with a v1 catalog already exists in production. Ask Ben, or look for one in a DB copy. `sample-data/graphics-printing-microcredentials.csv` is the v1 file.

- **No existing catalog:** import `graphics-printing-catalog-v2.csv` with `required_demonstrations = 2`. The expected result is 8 credentials and 42 skills, each with criteria matching the CSV. Ten skills will have no criteria until Ben approves the proposed ones.
- **A v1 catalog exists:** don't re-import, because the reworded names would create duplicate skills. Write `tools/apply-credential-changelog.js`. It takes `<programId> <changelog.csv>`, runs as a dry run by default and applies only with `--apply`. For each changelog row:
  - **Reworded description or criteria:** create a new version of the existing skill (the same path as `POST /skills/:id/versions`, then publish). Copy the current criteria and swap only the reworded ones. Old assessments stay pinned to v1.
  - **New checkpoint:** create the skill and its 5 criteria, publish it, and link it to Silk Screening with `required_demonstrations = 2`.
  - Print a summary in both modes.
- Either way, also set every CGL `wbl_credential_skills.required_demonstrations` to 2, and replace `sample-data/graphics-printing-microcredentials.csv` with the v2 file.

**When Ben approves `criteria-proposed-PENDING-APPROVAL.csv`:** load it as new skill versions on those 10 skills, the same way as the changelog. Not before.

## 4. Task B: Work Event kinds, evidence types and templates

The curriculum records an evidence type on every sign-off: **J** for a live or house job, **P** for a station or gate practical, **D** for a digital submission (library project), and **B** for a business module.

- **Schema:** add these columns to `wbl_work_events`:
  - `kind TEXT NOT NULL DEFAULT 'job'`. Validate it in the route as one of `job`, `practical`, `project` or `module`. Existing rows stay `job`.
  - `template_code TEXT` (nullable).
  - `is_house INTEGER NOT NULL DEFAULT 0`. A house job is one where the school store is the client. It still counts as J.
- **Evidence letter:** derive it from `kind` (job→J, practical→P, project→D, module→B). Show it on every assessment row, on the participant view, on `/me/work-history`, and on the credential evidence trail (`wbl_award_evidence` joins back to the Work Event). Don't store it separately.
- **Templates:** add a `wbl_work_event_templates` table holding `program_id, code, title, kind, gate_machine_code, onboarding, brief_url, notes, order_idx`, plus a `wbl_work_event_template_skills` join table.
  - Seed it from `cgl-work-event-templates.json` with a one-off tool (`tools/seed-cgl-templates.js <programId>`). Resolve each `{credential, skill}` pair to a skill id by its credential link, not by slug, because of the collision in §3.1.
  - Leave `brief_url` empty. Ben will paste the Shared Drive links.
- **"Start from template":** on the teacher's work-event screen, add a way to pick a template and one or more students. It creates the Work Event (kind, title, `template_code`, planned skills in `wbl_work_event_skills`) and the participants in one step. Practicals usually run with 1–4 students in a single period. Make the same action available from a student's row.
- **Acceptance:**
  - A practical created from `SS-P3` shows kind P and leads with "Expose and Wash Out Frames" in the Hard Skills lens.
  - Assessing it "mastered", with a qualifying Holistic Call, counts as one of the two demonstrations.

## 5. Task C: machines and gate clearances

A gate practical clears a student to run that machine **solo on live jobs**. A gate isn't a credential, and passing one is only the first piece of evidence toward a credential. There are 7 gates:

| Gate practical | Machine code |
|---|---|
| SS-P3 | `x-vactor-exposure` |
| SS-P5 | `screen-press` |
| DTF-P1 | `mimaki-txf150` |
| DTF-P3 | `heater-shaker` |
| DTF-P4 | `heat-press` |
| EMB-P2 | `ricoma-mt1501` |
| DS-P1 | `mimaki-cjv200` |

The full machine list is in the JSON.

- **Schema:**
  - `wbl_machines`: `program_id, code, label, gate_template_code, status ('available','in_use','down'), note`. Seed it from the JSON.
  - `wbl_gate_clearances`: `program_id, student_id, machine_code, work_event_id (nullable), cleared_by, cleared_at, revoked_at, revoked_by, revoke_note`, with `UNIQUE(program_id, student_id, machine_code)`.
  - Revoking sets `revoked_at`. It doesn't delete the row, because this is a safety record.
- **Clearing:** when a teacher records a Holistic Call of Meets or better on a participant of a practical whose template has a `gate_machine_code`, show a "Clear for solo use on <machine>" action. Make it explicit rather than automatic. A teacher can also clear or revoke a gate directly from the roster.
- **Enforcement:**
  - When a participant is added to a `kind='job'` Work Event with `role='production'` and one or more machines, warn if any machine isn't cleared and require a teacher override with a note. Store machines per participant in `wbl_participant_machines(participant_id, machine_code)`.
  - This is the "block solo machine work until the gate is signed off" requirement. Use a warning plus override, not a hard block, so a supervised first run is still possible.
- **Read API for the CGL website:** `GET /api/wbl/programs/:id/gates?student_id=…` returns the cleared machines. The CGL Job Sheet will call this before it allows a task assignment. Teacher auth is fine for now. See §8 for the cross-repo contract.

## 6. Task D: shop roles and rotation

`wbl_work_event_participants.role` is free text today. The CGL roles are:

| Code | Role | Planned skills |
|---|---|---|
| `job_lead` | Job Lead | Client Communication, Project Management |
| `buyer_receiver` | Buyer / Receiver | Procurement Shipping & Receiving |
| `qc_inspector` | QC Inspector | Quality Control |
| `shipper` | Shipper | Outgoing Packaging & Shipping |
| `photographer` | Photographer | Product Photography |
| `production` | Production (operator) | Comes from the job process; needs gate clearance |

All the planned skills above are Logistics & Operations skills except Product Photography, which is Marketing & Advertisement.

- Store the role vocabulary per program, either as a `wbl_roles` table or a program config JSON, seeded from the JSON file. Keep free text as a fallback for other programs.
- **Role drives planned skills:** the Hard Skills lens for a participant should lead with the job's planned skills plus their role's skills.
- **Rotation view:** for each student, a count of jobs held in each role, with a "suggested role" for the next job (the role held least). Every student should hold each business role at least once.

## 7. Task E: job packet import, the Today screen, pacing

**Job packet import.** The CGL website will export a **job packet** file and ClassicalKenKen imports it as a Work Event in one step. CGL-Website doesn't build this export yet, so you own the format. Define it as JSON and document it in `.refs/cgl/job-packet.schema.md`:

```json
{
  "job_number": "CGL-26-014",
  "is_house": false,
  "order":     { "customer": "", "contact": "", "due_date": "YYYY-MM-DD", "quantities": [{"size": "M", "qty": 12}], "invoice_ref": "" },
  "product":   { "type": "garment|substrate", "brand_style": "", "color": "", "supplied_by": "customer|ordered" },
  "process":   { "method": "screen|dtf|embroidery|solvent", "colors": 2, "ink_or_thread": ["PMS 286 C"], "media_finish": "" },
  "placement": [{ "location": "full front", "size": "11 in wide", "from": "3 in below collar", "notes": "" }],
  "files":     { "drive_folder_url": "", "approved_art_url": "", "proof_url": "", "stitch_file_url": "" },
  "assessment":{ "roles_needed": ["job_lead","buyer_receiver","qc_inspector","shipper","photographer","production"],
                 "machines": ["screen-press","x-vactor-exposure"],
                 "suggested_skills": [{"credential":"Silk Screening","skill":"Single & Multi-Color Printing"}] }
}
```

- `POST /api/wbl/programs/:id/work-events/import` accepts that JSON, from an upload or pasted text.
  - It creates a `kind='job'` event with `external_ref = job_number`, sets `title` to the customer name plus a short product description, stores the full packet in the event's `description` (or a new `packet_json` column), and adds the planned skills.
  - Make it **idempotent on `external_ref`**: re-importing updates the event rather than duplicating it.
  - Participants are assigned after import, using the role and gate checks above.
- Show the packet fields on the job's detail page so a student can run the job without asking. The Drive links in the packet are the source of truth for files.

**Student "Today" screen** (`student/index.html`). Keep it simple: one screen that shows today's lane and the single next step, picked in this order:

1. **Lane 1:** if the student is a participant on an active `kind='job'` event, show the job, their role, the due date and the packet link.
2. **Lane 2:** otherwise, if a machine is `available` and there is a practical template whose planned skills the student hasn't satisfied (and whose gate prerequisites, if any, they meet), suggest that practical.
3. **Lane 3:** otherwise, suggest the next library project or module for an unearned skill, in template `order_idx` order, with onboarding templates first in Phase 1.

Below that, show one progress bar per credential (`/me/credentials` already has the data). Everything else is a click deeper.

**Station board.** Add a teacher page (and a read-only student view) listing `wbl_machines` with their status, which the teacher or a student shift lead can toggle. That's the "station board" the lane poster points to.

**Pacing floor.**
- Add a `term_start` date to the program config.
- From it, compute each student's week and compare against the floor in the JSON:

  | Week | Minimum |
  |---|---|
  | 3 | Shop Ready |
  | 8 | 3 credentials (Habits of Work, Illustrator and one equipment credential) |
  | 13 | 5 credentials |
  | 18 | All 9 |

- Show a below-floor flag on the roster and sort flagged students to the top. Students below the floor get priority for the next job or station.
- **Credential coverage:** a teacher view per credential showing how many students have each skill at 0, 1 or 2+ qualifying demonstrations.

## 8. Cross-repo contracts (record them, don't build the other side)

- **CGL-Website → ClassicalKenKen:**
  - The job packet JSON (§7).
  - The gate read API (§5). The CGL Job Sheet checks gates before assigning a task. The QC Inspector's sign-off happens here, through the participant role.
  - The CGL website owns the shop forms: intake, job sheet, PO and receiving, QC log, shipping, inventory and ledger. None of that belongs in this repo.
  - For now the integration is file-based (export, then import). Server-to-server auth can come later. Leave a note in the schema doc.
- **DobbsCore:** nothing changes unless you add a gradebook category. The existing syncs (credential award, Holistic Call, transfer, Habits of Work) cover the curriculum. Formative assignments, like the planning forms and reflections in Google Forms, stay in Google Classroom, not here.

## 9. Decisions to confirm with Ben before building

1. **Holistic Calls on practicals, projects and modules.**
   - `credentialProgress` only counts an assessment if its participant has a Holistic Call of Meets or better. The framework doc says the Gross Output lens is "not active" in Phase 1.
   - As written, a practical or onboarding project could never count toward a credential.
   - Proposal: allow and require a Holistic Call on every kind, and record it in the same step as the sign-off for practicals, projects and modules.
2. **How Shop Ready moves a student to Phase 2.**
   - Phase 2 prerequisites are credential-based today, but Shop Ready means completing the onboarding templates (IL-00, IL-04, IL-15, IL-01, IL-02, IL-03) plus the safety sign-off. It isn't a credential.
   - Options: (a) add template-completion prerequisites alongside the credential ones (`wbl_phase2_prereq_templates`), or (b) use the existing instructor override.
   - Proposal: (a), with the safety sign-off as a Skill Check or a dedicated flag.
3. **Gate enforcement strength:** a warning plus teacher override (as proposed), or a hard block?
4. **Is there already a v1 Graphics & Printing catalog in production?** This decides the path in §3.
5. **The proposed criteria** for the 10 skills without any: approve, edit, or hold.

## 10. Smaller items

- **Skill map** (`Skill-Maps/graphics-printing/`):
  - Regenerate it for v2: add **Screen Reclaim & Cleanup** under Silk Screening and update the **Embroidery Digitizing** description from the changelog.
  - The source CSV is `Skill-Maps/data/graphics-printing.csv`, but `data/` is in `.gitignore`, so it may only exist on Ben's machine. Ask before regenerating, or edit `data.js` by hand and note it.
  - The cluster tags already follow the National Career Clusters Framework, with Arts, Entertainment & Design as the home cluster. No change needed.
- **Wiki and QUICKSTART:** add a short "CGL program setup" page covering the import, template seeding, machine and gate setup, and the term start date.
- **Open question from the API design doc:** Do Nows and Exit Slips have no submission window. Leave it alone; it's a policy call and not part of this work.

## 11. Suggested order

1. §3 importer fixes and tests, then load the catalog (decision 4).
2. §4 kinds, evidence letters and templates.
3. §9 decisions 1–2, then the Holistic Call and Phase 2 changes.
4. §5 machines and gates.
5. §6 roles.
6. §7 job packet import, then the Today screen and station board, then pacing and coverage.
7. §10 skill map and docs.

Steps 1–3 give Ben a working CGL catalog with practicals that count. The rest is additive.

There's no test framework. Follow the `tools/test-projection-core.js` pattern and add plain-node test scripts under `tools/` for the importer, the credential rule and the gate checks.
