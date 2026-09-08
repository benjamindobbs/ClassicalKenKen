# Quick Start for Teachers

This guide walks you through everything you need to do the first time you use **Classical Technology**
(DobbsCore): signing in, installing the companion Chrome extension, importing your first class roster
from PowerSchool, linking students to their accounts, and setting up daily practice and grading.

Follow it top to bottom. It should take about 15 minutes, and you only do most of this once.

> The full documentation lives in the **[project wiki](https://github.com/benjamindobbs/ClassicalKenKen/wiki)**.
> This file is the same as the wiki's [Quick Start](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Quick-Start) page.

---

## Part 1 — Sign in

### Step 1. Open the site

In **Google Chrome**, go to **[classicaltech.org](https://classicaltech.org)**. Use Chrome
specifically — the companion extension in Part 2 only runs in Chrome.

### Step 2. Go to the Teacher Portal

In the top navigation bar, click **Sign In**. A Google sign-in window opens. If you don't see "Sign
In," you may be signed in as a student on this browser — sign out first.

### Step 3. Choose your school account

Pick your **@hartfordschools.org** staff account.

- Staff accounts are recognized as **teachers** automatically — no approval step, nobody needs to add
  you. Your teacher space is created the first time you sign in.
- Student accounts (`@students.hartfordschools.org`) can't access the teacher portal.
- Personal Gmail / other-district accounts are rejected.

### Step 4. You're in

You land on the **Teacher Portal**, which shows a short **Getting Started** checklist the first time.
Your session stays signed in on this browser until you click **Sign Out**.

### Step 5. Enter your name

**Classes** tab → **Your Profile** → type your name → **Save**. This is the name on the student
leaderboard.

---

## Part 2 — Install the DobbsCore Chrome extension

Rosters are pulled from PowerSchool by a small Chrome extension, **DobbsCore Gradebook Sync**. The
same extension later pushes grades into PowerSchool and pulls attendance out of it.

> You can skip the extension and build classes by hand from a CSV file
> ([Part 3, Option B](#option-b--create-a-class-by-hand-no-extension)), but the extension is strongly
> recommended.

### Step 1. Get the extension files

Download from **[github.com/benjamindobbs/DobbsCore](https://github.com/benjamindobbs/DobbsCore)**:
green **Code** button → **Download ZIP**. Unzip it somewhere permanent (e.g. `Documents\DobbsCore`).
**Do not delete this folder** — Chrome loads the extension from it on every start.

### Step 2. Load it into Chrome

1. Go to **`chrome://extensions`**.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
4. The card **"DobbsCore Gradebook Sync"** appears.

### Step 3. Pin it

Click the puzzle-piece icon near Chrome's address bar and pin **DobbsCore Gradebook Sync**.

### Step 4. Give the extension your teacher token

1. In the Teacher Portal, **Classes** tab → **Chrome Extension** box → **Copy Token**.
2. Click the pinned **DobbsCore** icon.
3. Set **DobbsCore Server URL** to exactly `https://classicaltech.org`.
4. Paste your token into **Teacher Token**.
5. **Save.**

> If you sign out of the portal and back in later, copy the token again and re-paste it. An
> authorization error on a sync means the token is stale — that's the fix.

---

## Part 3 — Create your first class

### Option A — Import a roster from PowerSchool (recommended)

1. Be **logged into PowerSchool** (PowerTeacher Pro) in another Chrome tab.
2. Open one of your **class sections** in PowerSchool.
3. The extension adds an **"Import Roster to DobbsCore"** button to that page (only on sections not
   yet registered). Click it.
4. It pulls the live roster — names, district **Student Numbers**, and an internal PowerSchool ID for
   later attendance matching — and creates the class in DobbsCore.
5. Back in the Teacher Portal → **Classes** tab → refresh. Your class is listed.

Repeat per section. When enrollment changes later, use **Re-sync Roster** (not re-import) — see the
wiki's [Managing Classes & Rosters](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Managing-Classes-and-Rosters).

### Option B — Create a class by hand (no extension)

1. **Classes** tab → **+ New Class** → name it → **Create**.
2. Open the class → **Import CSV** → a file with **two columns, no header**: `student ID, full name`.
   ```
   123456,Jordan Rivera
   123457,Sam Park
   ```
3. Or add students one at a time with the **Student ID / Student Name / Add Student** fields.

---

## Part 4 — Link students to their accounts

A roster row and a signed-in student account are separate until **linked**. **Grades only compute for
linked students** — an unlinked student always gets the "No Submission" grade.

1. Have students go to **classicaltech.org** and **sign in once** with their
   `@students.hartfordschools.org` account. That's all they need to do.
2. In the class, click **Link Accounts**. Everyone who has signed in is matched by Student ID and
   linked.
3. Re-run **Link Accounts** whenever more students have signed in.

---

## Part 5 — Set what students must do each day

Open the class → **Assignment Requirements**.

- **Check the activities** you require (KenKen, SAT Math, SAT English). Checking more than one means
  the student must do **all** of them. Checking nothing means "either KenKen or SAT English."
- For each checked activity, set the **"… / Day"** count. KenKen games only count if at or above the
  student's own average; SAT items only count if **correct**.
- **Save Requirements.**

Above that: **Assessment** (SAT / PSAT 10 / PSAT 8/9) and **SAT English / Math Domains** (check a
subset to restrict practice, or leave all checked for all domains) → **Save Domains.**

---

## Part 6 — Set your gradebook preferences

**Classes** tab → **Gradebook Settings** (applies to all your classes):

| Setting | Meaning |
|---|---|
| **Assignment Max Score** | Point value of a full-credit assignment. |
| **Completion Score** (%) | Percent of max a student gets once they've met the requirement. Set `100` for "did the work = full credit." |
| **No Submission Score** (%) | Percent of max for a student who did nothing (and the floor for partial work / unlinked students). Often `0`, or `50` to avoid zeros. |

**Save Settings.** Then read
**[How Grading Works](https://github.com/benjamindobbs/ClassicalKenKen/wiki/How-Grading-Works)** in the
wiki — it covers absences, enrollment dates, days a section didn't meet, and worked examples — before
your first real grade push.

---

## Part 7 — Push grades into PowerSchool

1. In PowerSchool, open the class section.
2. Click the extension's **Create DobbsCore Assignment** button.
3. Enter the name, due date, max points, PowerSchool category, and the **date range**.
4. The extension creates the assignment and fills in every student's score from their DobbsCore
   activity over that range.

Full walkthrough:
**[The DobbsCore Extension](https://github.com/benjamindobbs/ClassicalKenKen/wiki/The-DobbsCore-Extension)**.

---

## Where to go next (wiki)

- **[How Grading Works](https://github.com/benjamindobbs/ClassicalKenKen/wiki/How-Grading-Works)** — the grading rules in detail.
- **[Managing Classes & Rosters](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Managing-Classes-and-Rosters)** — mid-year enrollment changes.
- **[Daily Practice & Assignments](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Daily-Practice-and-Assignments)** — students in multiple classes, domain restrictions.
- **[Work-Based Learning Guide](https://github.com/benjamindobbs/ClassicalKenKen/wiki/Work-Based-Learning-Guide)** — assessing real shop/job work.
