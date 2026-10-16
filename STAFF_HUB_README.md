# Staff Hub: Demo Build Brief

**Goal:** build a working **dummy demo** of Staff Hub inside the existing `ClassicalKenKen` repo, to show school leadership what it will look and feel like. Use **fake data only**. No real student or staff records go anywhere near this build.

Staff Hub replaces a 9-tab Google Sheet that staff at Classical Magnet School use for links, contacts, duties, schedules and student lists. Leadership has seen and approved the scope overview. This demo makes it concrete.

## Running the demo

```
npm run staff:seed     # wipe and reseed data/staff.db with fake data
npm run staff:demo     # starts the server with STAFF_DEMO=1 (works in PowerShell and bash)
npm run staff:check    # end-to-end checks against a throwaway copy (never touches data/)
```

Open **http://localhost:8080/staff/**, or **http://staff.localhost:8080/** (served as the site root, like `staff.<domain>` will be).

- **Role switcher** (header): Admin (school), Admin (technical), Office, Teacher (HS demo teacher Morgan Avery), Teacher (MS), Staff and Guest. `?as=<staff id>` on any page URL also picks the role, which is handy for walkthrough links.
- **Demo date and time** (header): every page follows the picked date. Seeded content is built around the **demo day**: the day `staff:seed` ran, or the next Monday if run on a weekend. The seed output prints the demo day, the early-release Wednesday and the X-day Friday. Leave the time blank for real time, or set it (e.g. 07:00) to make same-day alerts show more teachers.
- **Dev Fly app:** deploy as usual with `STAFF_DEMO=1` set on that app. An empty `staff.db` seeds itself on startup in demo mode. Demo mode is refused on the production app (`FLY_APP_NAME=classicalkenken`).
- **Other env:** `STAFF_DB_PATH` (default `data/staff.db`), `MAIL_TRANSPORT=console|resend` (default `console`; `resend` needs `RESEND_API_KEY` and `MAIL_FROM`), `STAFF_MEMO_CRON=1` for the 7:00 a.m. America/New_York memo job (off in the demo; machines that auto-stop won't be awake for it).

---

## 1. Where it lives

- **Repo:** `benjamindobbs/ClassicalKenKen`, an Express app on Node ≥ 22.5 using `node:sqlite` (`DatabaseSync`), with vanilla HTML/JS front ends and no framework. Match that style. Don't add React or a build step.
- **Pattern to copy:** the IT tool. `server/index.js` rewrites requests on the `it.` hostname to serve `/it/` as the site root, and `server/routes/it.js` provides its API. Staff Hub mirrors this:
  - Front end in `/staff/` (served as root on the `staff.` hostname)
  - API under `/api/staff/*` in `server/routes/staff.js` (split into `server/staff/*.js` modules as it grows)
  - Host rewrite: add a `staff.` branch next to the `it.` one, both in the rewrite middleware and in the `app.get('*')` fallback
- **Separate database.** Staff Hub must **not** share `scores.db`. Create `server/staff/db.js` that opens its own file from `STAFF_DB_PATH`, defaulting to `data/staff.db`. In production it shares the existing `classicalkenken` Fly app and `kenken_data` volume as a separate file (`STAFF_DB_PATH=/data/staff.db`). It will not get its own app or volume.
- **Removable.** Keep Staff Hub self-contained so it can be removed later:
  - All code lives in `/staff/`, `server/routes/staff.js` and `server/staff/`.
  - No staff code imports the main `server/db.js` or touches `scores.db`. No existing KenKen/SAT/WBL/IT code imports staff code.
  - `server/index.js` is the only shared file, and it changes in two places: the `staff.` host branch (rewrite and fallback) and the `/api/staff` route mount.
  - Removing it means deleting those, the `staff:*` npm scripts and `staff.db`.
- **Hosting note:** the Fly app currently runs in `ams`. It should move to a US region before real student data goes in (planned separately, not part of this build).
- **Local dev:** `localhost` won't have a `staff.` hostname. Also serve the hub at `/staff/` on any host, and/or support `staff.localhost` (which resolves to 127.0.0.1 in most browsers). Document whichever you pick.

## 2. Auth for the demo

The real app will use the existing Google OAuth flow (`js/auth.js`, `server/teacherAuth.js`) plus an email allowlist with a role per person. **For the demo:**

- Add `STAFF_DEMO=1`. When it is set, skip Google login and show a **role switcher** in the header with six roles: Admin (school), Admin (technical), Office, Teacher, Staff, Guest. Each role logs in as a seeded fake user.
- Build the permission checks for real anyway. Use one capability map in `server/staff/permissions.js` (role → capabilities) and enforce it on **every API route**, not just in the UI. Switching roles should visibly change what you can see and edit.
- **Date override (demo only):** when `STAFF_DEMO=1`, every page and API that uses "today" accepts `?date=YYYY-MM-DD`, and the header has a date picker that sets it. The demo can then be shown on any day, including weekends, and you can jump to a specific early-release or X day.
- Leave a clear seam (`getCurrentUser(req)`) where the Google allowlist check slots in later.

## 3. Roles and permissions

| Role | View | Edit / approve |
|---|---|---|
| admin_school | Everything, including serve comments and suspension-letter status | Schedule discipline serves, approve field trips and rosters, edit lists, links, duties, day plans |
| admin_tech | Everything | Users and roles, imports, settings |
| office | Everything, including serve comments | Approve field trips and rosters, edit lists, day plans, duties |
| teacher | All student flags (read-only), serve dates and periods, generic infraction code and incident date | Submit field trips, sync own rosters |
| staff | Same as teacher | Submit field trips |
| guest | Today page and links only (placeholder for substitutes) | Nothing |

**Only admin_school can create or edit discipline serves.** Every write goes to `audit_log`.

## 4. Data model (`server/staff/db.js`)

Use DCID as the student key everywhere, and show the school student ID to people.

```
staff            id, email UNIQUE, first, last, display_name, role, phone_ext, room,
                 title, office_hours, division ('MS'|'HS'|'BOTH'), active
students         dcid PK, student_number UNIQUE, first, last, grade, active
sections         id, teacher_id→staff, course_name, ps_expression (e.g. 'HS1(A)'),
                 period (int or label like 'WIN A'), division, room, term
enrollments      section_id, student_dcid, enrolled_on, exited_on
student_flags    id, student_dcid, type, note, start_date, end_date, created_by, created_at
                 type ∈ pass_restriction | elevator_pass | tech_restriction | morning_search |
                        accommodation | has_safety_plan | has_iep | has_504 | student_senate
serves           id, student_dcid, ps_incident_id, infraction_code, incident_date,
                 sanction ('ISS'|'OSS'|'Detention'|'Lunch detention'), serve_date,
                 periods (comma list '1,2,3' or 'ALL'), status ('scheduled'|'served'|'missed'|'rescheduled'),
                 rescheduled_to→serves, comments, offense_number, sus_letter_sent,
                 person_responsible→staff, created_by, created_at
                 -- comments, offense_number, sus_letter_sent, person_responsible: admin/office only
field_trips      id, title, date, depart_time, return_time, destination, info, submitted_by,
                 status ('pending'|'approved'|'changes_pending'|'rejected'),
                 reviewed_by, reviewed_at
trip_attendees   trip_id, student_dcid
trip_revisions   id, trip_id, snapshot_json, submitted_by, submitted_at, status
links            id, title, url, category, description, owner_staff_id, drive_file_id,
                 drive_modified_at, pinned (quick link), sort
faq              id, topic, primary_contact→staff, secondary_contact→staff, notes
bell_templates   id, name, division
bell_slots       template_id, slot_order, start_time, end_time, label
                 -- label is a placeholder like 'P1' or a fixed block like 'Lunch'
day_plans        date, division, template_id, slot_map_json, note, is_school_day
                 -- slot_map_json maps slot_order → what meets (e.g. {"1":"P6","2":"P1",...})
duty_slots       id, name, location, start_time, end_time, week_type, day_key
                 -- day_key: 'Mon'..'Fri' or 'Day1'..'Day4' for 4-day weeks
duty_assignments duty_slot_id, staff_id
calendar_events  id, uid, title, start, end, all_day, location, source ('ics'|'manual')
audit_log        id, user_id, action, entity, entity_id, before_json, after_json, at
```

Turn on SQLite FTS5 search across links (title, description, category), faq (topic, notes), staff (name, title, room), calendar_events (title), and students (name, student_number). Student results only appear for roles allowed to see them.

## 5. Seed data (all fake)

Write `server/staff/seed.js`, runnable with `npm run staff:seed`. It should wipe and reseed so the demo resets cleanly.

- **Staff (~25):** made-up names, one or two per role. The **demo teacher** has a full HS schedule; there's also one MS teacher.
- **Students (~120):** made-up names across grades 6–12, each with a fake DCID (6-digit) and student number (6-digit).
- **Sections/enrollments:** give the demo teacher 5 HS sections (`HS1(A)` … `HS6(A)`, one free period) with ~20 students each.
- **Flags:** about 15 active flags of mixed types. Several must hit the demo teacher's rosters, and at least one must start **today** (for the alert demo).
- **Serves:** about 8. Include an ISS **today** for a student on the demo teacher's roster, covering periods `1,2,3`. Include one OSS spanning several days, one missed detention that was rescheduled, and one in the past marked served.
- **Field trips:** one approved (today or tomorrow, with roster students on it), one pending approval, and one with changes pending.
- **Links:** about 30 across the real categories: *Operational Responsibilities, Grading & ACE, Curriculum & Instruction, Culture/Climate & Safety, School Launch, Learning Walk Tools, PLCs, Grade Level Teams*. Point them at `https://example.com/...` or fake Drive URLs. Mark 6 as quick links (PowerSchool, PowerTeacher, Frontline, IT Help Ticket, District Calendar, Field Trip Requests).
- **FAQ:** about 12 who-to-contact rows (building concerns, attendance, grades 6–9 emotional/home issues, grades 10–12 emotional/home issues, schedules, technology, 504 plans, IEPs, staff absences/coverage, morning announcements, athletics, ML supports).
- **Calendar:** about 10 events over the next 3 weeks (PLCs, parent conferences, early release, SAT day).
- **Duties:** morning, dismissal and lunch duty slots for the 5-day week, with the demo teacher on at least one today.

## 6. Bell schedules (seed from the real 26–27 schedules)

Every normal day uses the same HS time slots. **Which period meets in which slot rotates by weekday.**

**HS slots:** `7:30–8:26`, `8:30–9:26`, `9:30–10:26`, `10:30–12:10`, `12:14–1:10`, `1:14–2:10`

**HS 5-day rotation:**

| Slot | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| 1 | P1 | P6 | P5 | P4 | P3 |
| 2 | P2 | P1 | P6 | P5 | P4 |
| 3 | P3 | P2 | P1 | P6 | Advisory & SAT Prep |
| 4 | P7 | P7 | Gladiator Block | P7 | P7 |
| 5 | P4 | P3 | P2 | P1 | P5 |
| 6 | P5 | P4 | P3 | P2 | P6 |

HS lunch waves run inside slot 4: MS `10:30–11:00`, grades 10/11 `11:05–11:35`, grades 9/12 `11:40–12:10`.

**HS early-release Wednesday (4.5-day week):** `7:30–8:16` P5, `8:20–9:06` P6, `9:10–9:56` P1, `10:00–11:00` P2 (staggered dismissal from 10:45), then staff PL from 11:45.

**HS X day (Mon/Tue/Thu/Fri):** `7:30–8:11` P1, `8:15–8:56` P2, `9:00–9:41` P3, `9:45–10:26` P4, `10:30–12:10` X block (P7 or Advisory), `12:14–1:10` P5, `1:14–2:10` P6.

**MS 5-day** (same slot times; lunch `10:30–11:00`):

| Slot | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| 1 | Advisory | WIN B | WIN A | WIN B | P3 |
| 2 | P1 | P5 | P4 | P4 | WIN A |
| 3 | P2 | P1 | P5 | P5 | P4 |
| 4 | Electives A | Electives B | P1 | Electives A | Electives B |
| 5 | P3 | P2 | P2 | P1 | P5 |
| 6 | P4 | P3 | P3 | P2 | Advisory |

Seed `day_plans` for the next 4 weeks using the 5-day templates. Make one Wednesday an early-release day and one Friday an X day, so the Today page shows that variation.

## 7. Pages (`/staff/`)

Use one shared header on every page: the school name, a **global search bar** (searches as you type, results grouped by type), the role switcher (demo only) and nav links.

1. **Today** (home)
   - Today's date, the day type ("5-day week · Wednesday" / "Early release") and any note from the day plan
   - **My schedule:** the HS or MS slots with clock times, mapped to *my* sections and rooms
   - **My duties today**
   - **My students today:** students on my rosters who have an active flag, a serve today, or are on an approved trip today. Group them by the period I see them, e.g. "P1 (9:30–10:26): Jordan Reyes — ISS (P1–3)". This is the core feature, so make it obvious.
   - **Today's events** from the calendar
   - Admin/office additionally see school-wide counts (ISS today, trips today, pending approvals)
2. **Links:** quick links pinned at the top, then categories as collapsible groups, each link showing owner and last updated. Filter box. Admin/office can add, edit and reorder.
3. **Who to contact:** the FAQ table, searchable.
4. **Directory:** staff cards with name, title, room, extension, office hours and division. Searchable.
5. **Students:** search by name or ID. The student page shows grade, IDs, the sections they share with *me* (for teachers), active flags, serves, and trips. Flags are read-only for teacher/staff. Admin/office can add or end flags.
6. **Student lists:** one tab per flag type, mirroring the old sheet (Pass restrictions, Elevator passes, Tech restrictions, Morning search, Accommodations, Safety plans, Student Senate), each with start and end dates. Show "Expired" entries greyed out under a toggle.
7. **Discipline** (admin_school edits; office views everything; teacher/staff see only serve date, sanction, periods and code): a serve list filterable by date and status, a create-serve form (student picker, sanction, date, periods checkboxes 1–7 or all day), and mark served / missed / reschedule actions.
8. **Field trips:** list with a status badge, and a create form (info + attendee picker by student or by whole section). Approve/reject buttons for admin/office. Editing an approved trip creates a revision with status `changes_pending` that needs re-approval, and the approved version stays visible until then.
9. **Schedule:** a month view of `day_plans` (colour by day type). Office/admin can click a day to change its template, mark it no school (snow day) or add a note. Also show a read-only duty grid for the current week type.
10. **Memo preview:** shows **exactly** the 7:00 a.m. email for the current user, as rendered HTML, plus a "Send test to me" button that only logs to the console in demo mode. The memo contains: greeting, day type, my schedule, my duties, my students today grouped by period, today's events, and coverages/room changes (placeholder section).
11. **Admin › Imports** (admin_tech): CSV upload for students, staff, duties and links. Show a **preview diff** (adds / changes / removals) before commit. Provide a sample CSV download for each type.
12. **Admin › Audit log:** a filterable table.

## 8. Memo and alerts (demo behaviour)

- `server/staff/memo.js` exports `buildMemo(staffId, date)` → `{ subject, html, text }`. The memo preview page and the future 7:00 a.m. job both use it.
- Do **not** send real email. Put sending behind `MAIL_TRANSPORT=console|resend`, defaulting to `console`. The real system will use Resend.
- **Same-day alert demo:** when admin/office adds a flag or serve for **today**, compute which teachers still see that student in a later period today, and log or show the alert they would get ("Alert queued for 2 teachers").
- Schedule the daily job with a simple in-process scheduler at 7:00 America/New_York, using an IANA time zone rather than a fixed offset, behind `STAFF_MEMO_CRON=1`. Leave it off in the demo.

## 9. Look and feel

Clean, fast and dense enough for a teacher to scan in 10 seconds between classes. Light and dark mode. Readable on a phone (teachers will check Today in the hallway). Plain CSS in `/staff/style.css`. Use school-neutral colours, no logos.

## 10. Out of scope for the demo

- Real Google login and allowlist (stub only)
- Real PowerSchool sync. The DobbsCore extension (`benjamindobbs/DobbsCore`) will later send rosters and section expressions to an endpoint. For now, stub `POST /api/staff/sync/roster` to accept `{ section: {ps_expression, course_name, room, period}, students: [{dcid, student_number, first, last, grade}] }` and upsert, so the contract exists.
- Outlook ICS fetch (stub a function `syncIcs(url)` and seed events instead)
- Google Drive metadata fetch (seeded `drive_modified_at` instead)
- Fly deployment (production will reuse the existing app and volume; see §1)

## 11. Data rules to respect even in the demo

- Never store incident narratives, other parties involved, or the contents of safety plans, IEPs or 504s. Flags only say "has one".
- `serves.comments`, `offense_number`, `sus_letter_sent` and `person_responsible` must not appear in API responses for teacher, staff or guest. Strip them server-side.
- All student identifiers in the seed are fake. Add a visible "DEMO DATA" banner when `STAFF_DEMO=1`.

## 12. Done when

- [ ] `npm run staff:seed` then `npm run staff:demo` (which sets `STAFF_DEMO=1` itself, so it works in PowerShell and bash) → the hub works at the documented local URL
- [ ] As the demo teacher on a seeded school day, Today shows the rotated schedule with times, a duty, and roster students grouped by period, including the ISS for periods 1–3
- [ ] Switching a day to early release or X day in Schedule, then viewing that date (`?date=`), changes Today's times
- [ ] Global search finds a link, a FAQ row, a staff member and (for allowed roles) a student. Guest gets no student results.
- [ ] `npm run staff:check` calls every protected API route as each of the six roles and asserts allow/deny per `permissions.js`. It includes teacher/staff/guest not creating serves and not receiving `comments`, `offense_number`, `sus_letter_sent` or `person_responsible`.
- [ ] Field trip flow: teacher submits → office approves → trip shows on the attendees' teachers' Today. Editing it creates a pending revision, and the approved version stays visible until that revision is approved.
- [ ] Adding a flag or serve for today shows "Alert queued for N teachers"
- [ ] CSV import shows a diff before committing
- [ ] Memo preview renders for every role except guest (guests see Today and Links only). Roles without sections show duties and (admin/office) school-wide counts instead of a schedule.
- [ ] Every write appears in the audit log
- [ ] DEMO DATA banner visible. Today is usable at phone width in light and dark mode.
- [ ] No changes to existing KenKen/SAT/WBL/IT behaviour: `it.` routing and the KenKen/SAT pages checked by hand; `scores.db` untouched
- [ ] Removing the `/api/staff` mount and `staff.` host branch from `server/index.js` leaves the rest of the app working
