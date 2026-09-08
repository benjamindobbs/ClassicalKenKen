# Classical Technology

An educational platform built by and for a Career & Technical Education (CTE) technology program.
What began as a single tool — a digital, self-grading version of a daily KenKen "Do Now" — has grown
into a suite of student-facing practice apps and a full Work-Based Learning assessment system, all
tied together by school-account sign-in and a shared PowerSchool grading pipeline.

Deployed at **[classicaltech.org](https://classicaltech.org)**. One small Express server serves the
static pages and a JSON API, backed by a single SQLite database.

> **📖 Full documentation is in the [project wiki](https://github.com/benjamindobbs/ClassicalKenKen/wiki).**
> Teachers: start with **[Quick Start](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Quick-Start)**
> (also [`QUICKSTART.md`](QUICKSTART.md) in this repo) and
> **[How Grading Works](https://github.com/benjamindobbs/ClassicalKenKen/wiki/How-Grading-Works)**.

- **Origin:** fork of [msakuta/WebKenKen](https://github.com/msakuta/WebKenKen). Thanks to Sid Challa
  for help with the Google Cloud project.
- **Companion repo:** [`DobbsCore`](https://github.com/benjamindobbs/DobbsCore) — the Chrome extension
  that moves grades and attendance between this platform and PowerSchool.

---

## What's here

| Subsystem | In one line | Wiki |
|---|---|---|
| **KenKen Puzzles** | Adaptive number-logic puzzles; grid size and hint count scale with a per-student rank. | [Grading Algorithms](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Grading-Algorithms) |
| **SAT / PSAT Practice** | Official College Board practice questions (Math + English), served adaptively by recent per-skill accuracy. | [SAT Question Pipeline](https://github.com/benjamindobbs/ClassicalKenKen/wiki/SAT-Question-Pipeline) |
| **Skill Maps** | Generated, orbital-style visual maps of each CTE course's skills and career connections. | — |
| **Work-Based Learning** | Framework for assessing real student work: hard-skill micro-credentials, gross-output QC + Holistic Call, and dispositional / transfer soft skills, across a two-phase progression. | [WBL Guide](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Work-Based-Learning-Guide) · [WBL Internals](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Work-Based-Learning-Internals) |
| **Teacher & Student portals** | Rosters, per-class daily-practice settings, grade tables, and the WBL assessment UI. | [Managing Classes](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Managing-Classes-and-Rosters) · [Daily Practice](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Daily-Practice-and-Assignments) |
| **DobbsCore extension** | Creates PowerSchool assignments and fills scores; pulls PowerSchool attendance back in. | [The DobbsCore Extension](https://github.com/benjamindobbs/ClassicalKenKen/wiki/The-DobbsCore-Extension) · [Extension Integration](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Extension-Integration) |
| **IT tool** (`it/`) | Unrelated internal help-desk / device-inventory tool, served on the `it.` subdomain. | — |

Technical overview: [Architecture](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Architecture) ·
[Database Schema](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Database-Schema) ·
[API Reference](https://github.com/benjamindobbs/ClassicalKenKen/wiki/API-Reference) ·
[Deployment & Auth](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Deployment-and-Auth)

---

## Why it exists

The program ran a paper KenKen "Do Now" daily: hand-made puzzles, printed, cut, and graded — 100+ a
day, over 6,000 in a year. The results were strong enough to keep the practice but not the
production cost, so it was rebuilt as software.

**9th-grade PSAT growth — all students vs. course (ECS) students**

| Group | Overall | Math | Reading |
|---|---|---|---|
| 9th Grade (overall) | 25.8 | 12.6 | 13.3 |
| ECS Students | 31.9 | 16.5 | 15.4 |

**ECS students banded by average daily puzzle grade**

| Daily Puzzle Grade | Overall | Math | Reading |
|---|---|---|---|
| > 80% | 41.7 | 20.6 | 21.1 |
| 60–79% | 22.2 | 2.2 | 20.0 |
| < 60% | 7.7 | 7.7 | 0.0 |

Used in the team's student learning objectives for 2022–23.

---

## Repository layout

```
index.html                     Hub page
KenKen/  SAT-Questions/  SAT-Math/  Skill-Maps/   Front-end apps
student/  teacher/  it/                            Portals + IT tool
js/                                               Client scripts
server/                                           Express server
  index.js                                        App + router mounts
  db.js                                           SQLite schema + migrations
  routes/                                         One router per API group
  wbl/logic.js                                    Shared WBL scoring / phase / credential logic
tools/generate-skill-map.js                       CSV -> skill-map data.js + page
SAT-Questions/*.py                                Question-bank extraction pipeline
WBL_Assessment_Framework.md  WBL_Schema_Design.md  WBL_API_Design.md   WBL design docs
privacy-policy.md  terms-of-service.md
```

## Running locally

```bash
npm install
npm start        # node server/index.js   (PORT env, default 8080; DB_PATH for the SQLite file)
npm run dev      # same, with --watch
```

`DEV_USER=<key>` / `DEV_TEACHER=<key>` bypass auth for local work. Use "Play Locally" on the practice
apps to try them without an account. Details:
[Deployment & Auth](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Deployment-and-Auth).

## Privacy

Sign-in uses only the Google `userinfo.email` scope, verified server-side. Email and scores live in
the server's SQLite database, keyed to the email. Full policy in `privacy-policy.md` and on the site's
ReadMe page; terms in `terms-of-service.md`.
