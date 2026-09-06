# Classical Technology

An educational platform built by and for a Career & Technical Education (CTE) technology program.
What began as a single tool — a digital, self-grading version of a daily KenKen "Do Now" — has grown
into a suite of student-facing practice apps and a full Work-Based Learning assessment system, all
tied together by school-account sign-in and a shared PowerSchool grading pipeline.

The deployed site (`index.html`) is the hub. Everything runs off one small Express server that serves
static pages and a JSON API, backed by a single SQLite database.

- **Live credit / origin:** fork of [msakuta/WebKenKen](https://github.com/msakuta/WebKenKen). Thanks to
  Sid Challa for help setting up the Google Cloud project.
- **Companion repo:** [`DobbsCore`](https://github.com/benjamindobbs/DobbsCore) — the Chrome extension
  that pushes data from this system into PowerSchool.

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [KenKen Puzzles](#kenken-puzzles)
- [SAT / PSAT Practice (Math & English)](#sat--psat-practice-math--english)
- [Skill Maps](#skill-maps)
- [Work-Based Learning (WBL) Assessment Framework](#work-based-learning-wbl-assessment-framework)
- [PowerSchool Extension](#powerschool-extension)
- [Student & Teacher portals](#student--teacher-portals)
- [IT tool](#it-tool)
- [Running locally](#running-locally)
- [Privacy](#privacy)

---

## Architecture

| Layer | Detail |
|---|---|
| Server | Node ≥ 22.5, Express 4, one process (`server/index.js`). Serves the repo as static files and mounts API routers under `/api/*`. |
| Database | SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) — no ORM, raw SQL. Schema and one-time `ALTER TABLE` migrations live in `server/db.js`. `PRAGMA foreign_keys = OFF` — `REFERENCES` clauses are documentation; cascades are done in the route layer. |
| Auth | Google Identity Services (OAuth 2.0 implicit token flow). The browser gets a Google access token; the server verifies it against Google's `tokeninfo` endpoint and issues a random session UUID stored in `localStorage`. Only accounts on the authorized school domain can persist data. Teacher access is a separate token gate (`server/teacherAuth.js`). |
| Deploy | `Dockerfile` + `fly.toml` (Fly.io). The `it.` subdomain rewrites to the `/it` bundle; everything else falls through to the KenKen hub. |
| Student identity | Students authenticate as a `user_key` (email) but all cross-system records are keyed on `student_id`, the school-assigned number, in a canonical form with leading zeros stripped (`normalizeStudentId`). |

API routers: `auth`, `kenken`, `sat`, `sat-math`, `teacher`, `student`, `questions`, `it`, `wbl`.

---

## Repository layout

```
index.html            Hub page
KenKen/               KenKen puzzle app (client)
SAT-Questions/         SAT English app + the question-bank extraction pipeline
SAT-Math/             SAT Math app (client)
Skill-Maps/           Interactive course skill maps + generator input CSVs
student/              Student dashboard
teacher/              Teacher portal
it/                   Classical IT help-desk / inventory tool (separate subdomain)
js/                   Client scripts for the apps above
server/               Express server, routes, SQLite schema, WBL logic
  routes/             One router per API group
  wbl/logic.js        Shared WBL scoring / phase / credential logic
tools/generate-skill-map.js   CSV -> skill-map data.js + page
WBL_Assessment_Framework.md   WBL philosophy / design
WBL_Schema_Design.md          WBL data model
WBL_API_Design.md             WBL route design
sample-data/          Example micro-credential CSVs
assets/, privacy-policy*, terms-of-service.md
```

---

## KenKen Puzzles

### Origin

The program ran a paper KenKen "Do Now" daily: hand-made puzzles, printed, cut, and graded — 100+ a day,
over 6,000 in a year. The findings below (9th-grade PSAT growth, overall vs. students in the course that
used the puzzles — "ECS") were strong enough to keep the practice, but the production and grading cost
was not sustainable. This app replaced all of it: puzzles are generated on demand, scored automatically,
and served at each student's level.

**9th-grade PSAT growth — all students vs. course (ECS) students**

| Group | Overall Growth | Math Growth | Reading Growth |
|---|---|---|---|
| 9th Grade (overall) | 25.8 | 12.6 | 13.3 |
| ECS Students | 31.9 | 16.5 | 15.4 |

**ECS students banded by average daily puzzle grade**

| Daily Puzzle Grade | Overall Growth | Math Growth | Reading Growth |
|---|---|---|---|
| > 80% | 41.7 | 20.6 | 21.1 |
| 60–79% | 22.2 | 2.2 | 20.0 |
| < 60% | 7.7 | 7.7 | 0.0 |

This data was used in the team's student learning objectives for the 2022–23 school year.

### How a puzzle is built

Difficulty is two variables: **grid size** and **hint count**.

- **Rank** is a floating-point number derived from the student's cumulative average score. The integer
  part sets the grid: `grid = floor(rank) + 2`, capped at 9×9.
- The **sub-rank** (fractional part) controls how many cells are pre-filled as hints. More progress
  through a rank → fewer hints → more of the puzzle solved unaided before the grid grows.

Rank level thresholds (`LEVEL_STARTS`, shared between `server/rankTable.js` and `js/kenken.js`):

| Rank | Grid | Avg score to enter |
|---|---|---|
| 1 | 3×3 | 0 |
| 2 | 4×4 | 50 |
| 3 | 5×5 | 84 |
| 4 | 6×6 | 116 |
| 5 | 7×7 | 144 |
| 6 | 8×8 | 168 |
| 7 | 9×9 | 188 |

Within a level, rank interpolates linearly toward the next threshold.

### Scoring

```
score = round( ( unsolved / guesses  +  2.5 × unsolved / time ) × gridSize × 10 )
```

- **unsolved** = cells the student actually had to solve (`gridSize² − hints`).
- **time** = seconds elapsed; weighted 2.5× relative to guess efficiency.
- The per-game score is capped at `round(nextRankThreshold × 1.3)` so one lucky puzzle can't
  vault a student past a rank.

### Turning scores into a grade

The teacher sets **Max Score**, **Completion Score (%)**, and **No-Submission Score (%)**. Over the
assignment window, a student's qualifying daily submissions are counted against the required number
per day:

```
grade = (qualifying_count / required) × MaxScore
```

floored at the Completion Score when the requirement is met, or the No-Submission Score when nothing
was submitted. A KenKen game only counts as *qualifying* if its score meets or exceeds the student's
all-time average — completion has to mean effort, not just clicking through.

---

## SAT / PSAT Practice (Math & English)

Two adaptive question apps — `SAT-Questions/` (Reading & Writing) and `SAT-Math/` — that serve
official practice questions matched to a student's demonstrated level in each domain/skill/difficulty.

### Where the questions come from

Questions are sourced from the **College Board SAT Suite Question Bank** PDF exports. Each exported
block carries `Question ID`, `Assessment`, `Test`, `Domain`, `Skill`, `Difficulty`, the question,
the four choices, the correct answer, and a rationale. The `SAT-Questions/` directory holds a small
Python pipeline that turns those PDFs into the JSON banks the apps load:

| Script | Purpose |
|---|---|
| `extract_questions.py` | English/R&W PDFs. They have a real text layer — parsed directly with `pdfplumber`. Splits on `Question ID:` markers, parses the metadata table, choices, answer, and rationale. Flags questions whose text mentions a graph/table/figure for manual review. `--assessment` overrides the label for PSAT 10 / PSAT 8/9 exports. |
| `extract_math_questions.py` | Math PDFs have **no text layer** — every page is vector paths. Each page is rasterized at 200 DPI with PyMuPDF and run through Tesseract OCR, then parsed with the same block logic plus OCR-tolerant regexes. Domain/skill strings are fuzzy-matched to a canonical list. Student-Produced-Response (free-response) items are detected and skipped (`math_spr.txt`); image/chart questions are recorded to `math_flagged.txt`. |
| `extract_math_images.py` | Runs after the above. For each flagged math question, saves an embedded raster if the page has one, otherwise OCR-locates the "Answer" heading and crops the question + chart region above it. Writes `math-images/<ID>.png` and adds `"image": "math-images/<ID>.png"` to the JSON in place. |
| `classify_domains.py` | Backfills missing `Domain`/`Skill` on questions the parsers couldn't tag, by keyword-matching the question + rationale text against per-domain pattern sets. |
| `patch_*.py` | Targeted one-off fixups applied to specific banks (OCR'd choice cleanup, merged-choice splitting, assessment-field patches, math flag corrections). |

Output banks, served as static JSON and fetched by the browser:

- `SAT-Math-Questions.json`, `SAT-English-Questions.json` (SAT)
- `PSAT-Math-Questions.json`, `PSAT-English-Questions.json` (PSAT/NMSQT & PSAT 10)
- `PSAT89-Math-Questions.json`, `PSAT89-English-Questions.json` (PSAT 8/9)

A signed-in student's `assessment_type` (from teacher settings) picks which bank loads; anonymous
users get the SAT bank. Suspended/reported question IDs are filtered out at load time.

### Adaptive serving logic

The client asks the server *what* to serve next (`GET /api/sat/next` or `/api/sat-math/next`); the
server returns `{ domainIdx, skill, difficulty }` and the client pulls a matching question from the
loaded bank. Attempts are logged back to the server (`domainIdx`, `skill`, `difficulty`, correct?).

1. **Allowed domains.** Class settings may restrict which of the four domains are active; otherwise all four.
2. **Recent history only.** A SQL window function takes the last 25 attempts per `(domain, skill, difficulty)`, so old struggles don't permanently hold a student down.
3. **Accuracy map.** Those rows are aggregated in JS into `{ "domain|skill|difficulty": { attempts, accuracy } }`.
4. **Candidate list.**
   - *Unseen domains* enter at Easy with weight `1.0`.
   - *Seen `(domain, skill)`* — target difficulty is found by walking the tiers: start Easy; advance to Medium only with ≥ 5 Easy attempts **and** > 70% accuracy; advance to Hard on the same bar at Medium.
   - *Inverse-accuracy weight:* `weight = max(0.05, 1 − accuracy)`. 0% → 1.0 (most likely), 75% → 0.25, 100% → 0.05 (mastered areas still resurface occasionally).
5. **Weighted random pick** across the candidate list — lower-accuracy areas occupy proportionally more of the range.

Grades for SAT/PSAT practice use the same daily-count model as KenKen (see above), with a required
count per day set by the teacher.

---

## Skill Maps

`Skill-Maps/` is a set of interactive, orbital-style visualizations — one per CTE course — that lay
out the course's topics ("planets") and the skills under each ("moons"), tagged with the career
clusters and sub-cluster areas they connect to. They're a curriculum-communication tool for students,
families, and administrators.

Each map is generated, not hand-written:

```
Skill-Maps/data/<slug>.csv   ──►  node tools/generate-skill-map.js <slug>  ──►  Skill-Maps/<slug>/data.js
                                                                              Skill-Maps/<slug>/index.html
```

The CSV rows are typed `course` / `topic` / `skill`, with columns for name, initials, color, icon,
description, and cluster tags. `data.js` is marked *do not edit by hand* — change the CSV and re-run.
Current maps: Graphics & Printing Technology, Computer Aided Manufacturing Technology, Intro to Robotics.

The same topic/checkpoint/subtask structure feeds the WBL micro-credential catalog — see
`sample-data/*-microcredentials.csv` for the import shape.

---

## Work-Based Learning (WBL) Assessment Framework

The largest subsystem. A universal framework for assessing students doing **real work** in a
school-based enterprise (apparel decoration, job shop, print production, etc.), designed so the
mechanics stay constant while the specific skills, credentials, and quality criteria are configured
per sector. Full design in `WBL_Assessment_Framework.md`, data model in `WBL_Schema_Design.md`,
routes in `WBL_API_Design.md`.

### Core ideas

- **Hard skills are the context; professional soft skills are the object.** The framework assesses
  *how a student works* — persistence, applying and extending knowledge, holding a standard, curiosity —
  through the act of doing technical work, not as abstract traits.
- **The Work Event** is the organizing unit: one real, discrete job (an order, a build, a print run),
  viewed through all three assessment lenses at once rather than three separate processes. Work Events
  are shared job entities with per-student participant rows, so team jobs and multi-week jobs both work.
- **Program vs. class.** A *program* owns curriculum and progression (skills, credentials, phase,
  awards); a *class* is just roster + which PowerSchool section to push grades to. Credentials and
  phase survive section changes and school years.

### The three lenses

| Lens | Cadence | Mechanism |
|---|---|---|
| **Hard Skills → Micro-credentials** | Every Work Event | Mastery checklist against *versioned* skills. A skill counts toward a credential only when demonstrated across multiple Work Events, under varying conditions, and only on jobs that also clear a minimum output-quality bar. |
| **Gross Output** | QC Spot Checks (rotating weekly queue, one per student per week) + a Holistic Call per completed job | The QC checks are an accumulating objective evidence trail; the Holistic Call is the workplace-authentic final judgment of the finished work, on a tiered scale. |
| **Soft Skills** | Formative throughout | *Dispositional* (Persistence, Commitment to Excellence, Academic Curiosity) via a daily Do Now / Exit Slip lens. *Transfer* (Application of Previous Knowledge, Extension of Knowledge) via claims the student makes citing their own credential history. |

### Two phases

- **Phase 1 — scoped/introductory.** Instructor-designed units. Hard skills taught and assessed directly.
  Dispositional soft skills active and instructor-scaffolded. Transfer soft skills dormant (no history to cite yet).
- **Phase 2 — open jobs.** Triggered when a student earns the prerequisite credentials for independent
  work. Real jobs with unscoped demands. Transfer soft skills activate and become formally scored;
  the Holistic Call becomes the primary output mechanism.

### PowerSchool sync

WBL data is designed to sync to PowerSchool from day one, at several grains — credential award,
Holistic Call / Work Event score, and the soft-skill ("Habits of Work") ratings — each as its own
assignment. The push itself is done by the extension (below); `server/wbl/logic.js` and the
`/api/wbl/*` routes compute the scores, phase, and credential progress it reads.

### Notable schema rules

- Skill versions are pinned on each assessment; credential requirements reference the skill *lineage*,
  not one version — changing a skill's scope doesn't corrupt historical evidence.
- Exit slips are **append-only**: voided via a separate table, never edited. A database trigger blocks
  `UPDATE`. Do Now submissions are capped (one per student per day) by trigger.
- QC coverage *alerts*, it doesn't gate — the denominator is active weeks, not calendar weeks.
- Student IDs are normalized (leading zeros stripped) on ingest; the WBL tables and the older
  `class_students` roster are dual-looked-up because the latter still carries raw PS numbers.

---

## PowerSchool Extension

A separate repo ([`DobbsCore`](https://github.com/benjamindobbs/DobbsCore)): a Manifest V3 Chrome
extension that runs inside PowerTeacher Pro and moves data from this system into the PowerSchool
gradebook. It talks to this server's `/api/teacher` and `/api/wbl` endpoints for the numbers, and to
PowerSchool's internal `ws/xte` endpoints to create assignments and push scores.

What it does:

- **Create DobbsCore assignment** — creates a PS assignment and fills it from a student-activity grade
  over a date range (KenKen / SAT counts), meeting-day-aware so weekends and holidays don't dilute the
  denominator.
- **Sync Work-Based Learning** — one PS assignment per credential, per credential-skill, and per
  completed Work Event. Credentials/skills carry a per-class **Not Started / In Progress / Due**
  lifecycle that controls whether they sync and whether non-earners get a blank or a hard zero.
  Work Event assignments are scoped to just the participants with a Holistic Call.
- **Sync Habits of Work** — all five soft skills in one assignment each, created *not counted toward
  the traditional final grade* per district policy. Transfer skills only sync once a student reaches
  Phase 2.
- **Pull PS attendance** — caches section attendance into the server so it can back both the
  meeting-day proration above and the Work Event attendance blend.

See the extension repo's README for the exact scoring math and field-level detail.

---

## Student & Teacher portals

- **`student/`** — "My Progress": a signed-in student's KenKen and SAT/PSAT scores, daily-requirement
  progress, and WBL micro-credential / rubric history.
- **`teacher/`** — the teacher portal: class rosters, per-class activity settings (which activities are
  required and how many per day, which SAT domains are active, assessment type), score tables and a
  leaderboard, and the full WBL catalog / assessment UI (programs, skills, credentials, Work Events,
  QC checks, Do Now / Exit Slip verification, phase overrides).

---

## IT tool

`it/` (served on the `it.` subdomain) is an unrelated internal help-desk and device-inventory tool for
the school's IT team — ticket queue, device status, inventory, and a quick-reference knowledge base.
It shares this server and the `/api/it` router but is otherwise independent of the education apps.

---

## Running locally

```bash
npm install
npm start            # node server/index.js  (PORT env var, default 8080)
npm run dev          # same, with --watch
```

The server serves the repo root statically and creates/opens the SQLite database on first run
(path configurable via env). Google sign-in requires the OAuth client ID configured for the
deployment's domain; use "Play Locally" on the apps to try them without an account.

Regenerate a skill map: `node tools/generate-skill-map.js <slug>` after editing its CSV.

Re-extract a question bank: see the script headers in `SAT-Questions/` for the required
`pip install` packages (`pdfplumber` for English; `pymupdf` + `pytesseract` + a Tesseract binary
for Math).

---

## Privacy

Sign-in uses only the Google `userinfo.email` scope, verified server-side; no password is ever
received. Email and scores live in the server's SQLite database, keyed to the email address. Only
accounts on the authorized school domain can store data. Full policy in `privacy-policy.md` and on
the site's ReadMe page; terms in `terms-of-service.md`.
