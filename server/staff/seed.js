// Wipes and reseeds staff.db with FAKE demo data. Every name, ID and email
// below is made up. Dates are relative to the day the seed runs so the demo
// always has "today" content.
//
//   npm run staff:seed

const { db, rebuildSearch, tx, nowIso } = require('./db');
const time = require('./time');

// Deterministic PRNG so every reseed produces the same rosters.
function rng(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TABLES = [
    'staff', 'students', 'sections', 'enrollments', 'student_flags', 'serves',
    'field_trips', 'trip_attendees', 'trip_revisions', 'links', 'faq',
    'bell_templates', 'bell_slots', 'day_plans', 'duty_slots', 'duty_assignments',
    'calendar_events', 'audit_log',
];

const EMAIL_DOMAIN = 'demo.classical.example';

// [first, last, role, title, division, room, ext, office hours]
const STAFF = [
    ['Dana',    'Whitfield',  'admin_school', 'Principal',                    'BOTH', '101', '1001', 'By appointment'],
    ['Marcus',  'Ortega',     'admin_school', 'Assistant Principal (HS)',     'HS',   '103', '1003', 'Mon–Fri 7:00–7:30'],
    ['Priya',   'Nandakumar', 'admin_tech',   'Technology Coordinator',       'BOTH', '118', '1018', 'Tue/Thu 2:15–3:00'],
    ['Lena',    'Kowalski',   'office',       'Office Manager',               'BOTH', '100', '1000', 'Mon–Fri 7:00–3:00'],
    ['Tomás',   'Rivera',     'office',       'Attendance Clerk',             'BOTH', '100', '1002', 'Mon–Fri 7:00–3:00'],
    ['Morgan',  'Avery',      'teacher',      'Mathematics',                  'HS',   '214', '2214', 'Wed 2:15–3:00'],
    ['Jordan',  'Ellis',      'teacher',      'English Language Arts (MS)',   'MS',   '112', '2112', 'Tue 2:15–3:00'],
    ['Sam',     'Okafor',     'teacher',      'Biology',                      'HS',   '305', '2305', 'Mon 2:15–3:00'],
    ['Riley',   'Chen',       'teacher',      'English',                      'HS',   '220', '2220', 'Thu 2:15–3:00'],
    ['Casey',   'Brooks',     'teacher',      'U.S. History',                 'HS',   '226', '2226', 'Tue 2:15–3:00'],
    ['Alex',    'Lindqvist',  'teacher',      'Spanish',                      'HS',   '231', '2231', 'Fri 2:15–3:00'],
    ['Jamie',   'Patel',      'teacher',      'Visual Art',                   'HS',   '140', '2140', 'Mon 2:15–3:00'],
    ['Drew',    'Santos',     'teacher',      'Physical Education & Health',  'HS',   'Gym', '2190', 'Wed 2:15–3:00'],
    ['Quinn',   'Harper',     'teacher',      'Physics',                      'HS',   '310', '2310', 'Thu 2:15–3:00'],
    ['Taylor',  'Nguyen',     'teacher',      'Mathematics (MS)',             'MS',   '114', '2114', 'Mon 2:15–3:00'],
    ['Robin',   'Adeyemi',    'teacher',      'Science (MS)',                 'MS',   '116', '2116', 'Thu 2:15–3:00'],
    ['Kendall', 'Moss',       'staff',        'School Counselor (Grades 10–12)', 'HS', '150', '1150', 'Mon–Fri 7:15–2:30'],
    ['Ellis',   'Grant',      'staff',        'Paraprofessional',             'BOTH', '214', '1214', ''],
    ['Sydney',  'Park',       'teacher',      'Special Education',            'HS',   '208', '2208', 'Tue 2:15–3:00'],
    ['Rowan',   'Fisher',     'teacher',      'Music',                        'BOTH', '144', '2144', 'Fri 2:15–3:00'],
    ['Jesse',   'Alvarez',    'staff',        'School Social Worker',         'BOTH', '152', '1152', 'Mon–Fri 7:15–2:30'],
    ['Blake',   'Turner',     'staff',        'School Nurse',                 'BOTH', '105', '1105', 'Mon–Fri 7:00–2:30'],
    ['Cameron', 'Wu',         'staff',        'Athletic Director',            'BOTH', 'Gym', '1190', 'Mon–Fri 1:00–4:00'],
    ['Frankie', 'Dubois',     'staff',        'ML Coordinator',               'BOTH', '154', '1154', 'Wed/Fri 2:15–3:00'],
    ['Leslie',  'Ramos',      'staff',        'School Counselor (Grades 6–9)', 'BOTH', '151', '1151', 'Mon–Fri 7:15–2:30'],
    ['Pat',     'Lee',        'guest',        'Substitute Teacher',           'BOTH', '',    '',     ''],
];

const FIRSTS = ['Jordan','Aaliyah','Mateo','Zoe','Elijah','Sofia','Isaiah','Camila','Malik','Ava','Diego','Nia','Liam','Maya',
    'Andre','Leah','Xavier','Imani','Gabriel','Chloe','Jayden','Ariana','Lucas','Jasmine','Noah','Valeria','Caleb','Amara',
    'Adrian','Naomi','Kai','Elena','Darius','Lila','Omar','Gianna','Tyler','Kiara','Ezra','Renata','Miles','Tessa','Rafael',
    'Simone','Theo','Paloma','Desmond','Hana','Julian','Brianna','Felix','Yara','Marcus','Esme','Dominic','Iris','Hugo','Talia'];
const LASTS = ['Reyes','Johnson','Martinez','Okoro','Brown','Santiago','Williams','Nguyen','Davis','Rodriguez','Smith','Garcia',
    'Thompson','Lopez','Jackson','Perez','White','Harris','Clark','Lewis','Robinson','Walker','Young','Allen','King','Wright',
    'Scott','Torres','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
    'Diaz','Phillips','Evans','Turner','Morales','Parker','Collins','Edwards','Stewart','Sanchez'];

const HS_COURSES = {
    Avery:     ['Algebra II', 'Algebra II', 'Precalculus', 'Geometry', null, 'AP Statistics'],
    Okafor:    ['Biology', 'Biology', 'AP Biology', 'Biology', 'Environmental Science', 'Biology', 'Seminar'],
    Chen:      ['English 9', 'English 10', 'English 9', 'AP Literature', 'English 10', 'English 9', 'Seminar'],
    Brooks:    ['U.S. History', 'World History', 'U.S. History', 'Civics', 'U.S. History', 'AP U.S. History', 'Seminar'],
    Lindqvist: ['Spanish I', 'Spanish II', 'Spanish III', 'Spanish I', 'Spanish II', 'Spanish I', 'Seminar'],
    Patel:     ['Studio Art', 'Ceramics', 'Studio Art', 'AP Art', 'Studio Art', 'Ceramics', 'Seminar'],
    Santos:    ['PE 9', 'Health', 'PE 10', 'PE 9', 'Health', 'PE 10', 'Seminar'],
    Harper:    ['Physics', 'Chemistry', 'AP Physics', 'Chemistry', 'Physics', 'Chemistry', 'Seminar'],
    Park:      ['Math Lab', 'Literacy Lab', 'Math Lab', 'Literacy Lab', 'Study Skills', 'Math Lab', 'Seminar'],
    Fisher:    ['Concert Band', 'Chorus', 'Music Theory', 'Concert Band', 'Chorus', 'Guitar', 'Seminar'],
};

// HS 5-day rotation (26-27): slot -> what meets, by weekday.
const HS_ROTATION = {
    Mon: { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P7', 5: 'P4', 6: 'P5' },
    Tue: { 1: 'P6', 2: 'P1', 3: 'P2', 4: 'P7', 5: 'P3', 6: 'P4' },
    Wed: { 1: 'P5', 2: 'P6', 3: 'P1', 4: 'Gladiator Block', 5: 'P2', 6: 'P3' },
    Thu: { 1: 'P4', 2: 'P5', 3: 'P6', 4: 'P7', 5: 'P1', 6: 'P2' },
    Fri: { 1: 'P3', 2: 'P4', 3: 'Advisory & SAT Prep', 4: 'P7', 5: 'P5', 6: 'P6' },
};
const MS_ROTATION = {
    Mon: { 1: 'Advisory', 2: 'P1', 3: 'P2', 4: 'Electives A', 5: 'P3', 6: 'P4' },
    Tue: { 1: 'WIN B', 2: 'P5', 3: 'P1', 4: 'Electives B', 5: 'P2', 6: 'P3' },
    Wed: { 1: 'WIN A', 2: 'P4', 3: 'P5', 4: 'P1', 5: 'P2', 6: 'P3' },
    Thu: { 1: 'WIN B', 2: 'P4', 3: 'P5', 4: 'Electives A', 5: 'P1', 6: 'P2' },
    Fri: { 1: 'P3', 2: 'WIN A', 3: 'P4', 4: 'Electives B', 5: 'P5', 6: 'Advisory' },
};
const SLOT_TIMES = [['07:30','08:26'], ['08:30','09:26'], ['09:30','10:26'], ['10:30','12:10'], ['12:14','13:10'], ['13:14','14:10']];
const X_MAP = Object.fromEntries(['Mon','Tue','Wed','Thu','Fri'].map(d => [d, { 5: 'P7' }]));

function seed() {
    const rand = rng(2627);
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    const shuffle = arr => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    const today = time.localDate();
    let demoDay = today;
    while (!time.isWeekday(demoDay)) demoDay = time.addDays(demoDay, 1);
    // n school days (weekdays) from the demo day, so nothing lands on a weekend.
    const d = n => {
        let day = demoDay;
        for (let k = Math.abs(n); k > 0;) {
            day = time.addDays(day, Math.sign(n));
            if (time.isWeekday(day)) k--;
        }
        return day;
    };
    const created = nowIso();

    // Next Wednesday and Friday strictly after the demo day.
    let erWed = d(1);  while (time.dayKey(erWed) !== 'Wed') erWed = time.addDays(erWed, 1);
    let xFri  = d(1);  while (time.dayKey(xFri)  !== 'Fri') xFri  = time.addDays(xFri, 1);

    tx(() => {
        for (const t of TABLES) db.exec(`DELETE FROM ${t}`);

        // ── Staff ────────────────────────────────────────────────────────
        const insStaff = db.prepare(`INSERT INTO staff(id, email, first, last, display_name, role, phone_ext, room, title, office_hours, division, active)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
        const staffId = {};
        STAFF.forEach(([first, last, role, title, division, room, ext, hours], i) => {
            const id = i + 1;
            staffId[last] = id;
            const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[^a-z.]/g, '') + '@' + EMAIL_DOMAIN;
            insStaff.run(id, email, first, last, `${first} ${last}`, role, ext || null, room || null, title, hours || null, division);
        });
        const DEMO_T = staffId.Avery, DEMO_MS = staffId.Ellis;

        // ── Students ─────────────────────────────────────────────────────
        const insStu = db.prepare('INSERT INTO students(dcid, student_number, first, last, grade, active) VALUES (?, ?, ?, ?, ?, 1)');
        const usedIds = new Set(), usedNames = new Set();
        const sixDigits = () => { let n; do { n = 100000 + Math.floor(rand() * 900000); } while (usedIds.has(n)); usedIds.add(n); return n; };
        const makeStudent = grade => {
            let first, last;
            do { first = pick(FIRSTS); last = pick(LASTS); } while (usedNames.has(first + last));
            usedNames.add(first + last);
            const s = { dcid: sixDigits(), student_number: String(sixDigits()), first, last, grade };
            insStu.run(s.dcid, s.student_number, first, last, grade);
            return s;
        };
        // Keep the brief's example name for the ISS demo student.
        usedNames.add('JordanReyes');
        const jordan = { dcid: sixDigits(), student_number: String(sixDigits()), first: 'Jordan', last: 'Reyes', grade: 10 };
        insStu.run(jordan.dcid, jordan.student_number, jordan.first, jordan.last, jordan.grade);

        const hs = [jordan];
        for (const g of [9, 10, 11, 12]) for (let i = 0; i < 20; i++) if (!(g === 10 && i === 0)) hs.push(makeStudent(g));
        const ms = [];
        for (const [g, n] of [[6, 14], [7, 13], [8, 13]]) for (let i = 0; i < n; i++) ms.push(makeStudent(g));

        // ── Sections & enrollments ───────────────────────────────────────
        // Every HS student takes exactly one section per period 1–7, so
        // alert counts ("still see them later today") are realistic.
        const insSec = db.prepare(`INSERT INTO sections(teacher_id, course_name, ps_expression, period, division, room, term)
                                   VALUES (?, ?, ?, ?, ?, ?, '26-27')`);
        const insEnr = db.prepare('INSERT OR IGNORE INTO enrollments(section_id, student_dcid, enrolled_on) VALUES (?, ?, ?)');
        const roomOf = last => STAFF.find(s => s[1] === last)[5];
        const enrolledOn = '2026-08-27';

        // The demo teacher's periods that meet on the demo day, in slot order,
        // so "today" seed items land in classes the teacher actually sees.
        const demoKey = time.dayKey(demoDay);
        const meeting = Object.values(HS_ROTATION[demoKey])
            .map(m => /^P(\d)$/.exec(m)).filter(Boolean).map(m => Number(m[1]))
            .filter(p => HS_COURSES.Avery[p - 1]);
        const issPeriod = meeting.find(p => p <= 3);

        const hsOthers = ['Okafor', 'Chen', 'Brooks', 'Lindqvist', 'Patel', 'Santos', 'Harper', 'Park', 'Fisher'];
        let rr = 0;
        const demoRoster = {};
        const demoCount = new Map(hs.map(s => [s.dcid, 0]));
        for (let p = 1; p <= 7; p++) {
            let order = shuffle(hs);
            if (HS_COURSES.Avery[p - 1]) {
                // Spread the demo teacher's 100 seats over 80 students, and keep
                // Jordan (the ISS demo) in exactly one of their sections.
                order.sort((a, b) => demoCount.get(a.dcid) - demoCount.get(b.dcid));
                order = order.filter(s => s !== jordan);
                if (p === issPeriod) order.unshift(jordan); else order.push(jordan);
                order.slice(0, 20).forEach(s => demoCount.set(s.dcid, demoCount.get(s.dcid) + 1));
            }
            const teachers = [];
            if (HS_COURSES.Avery[p - 1]) teachers.push('Avery');
            while (teachers.length < 4) {
                const t = hsOthers[rr++ % hsOthers.length];
                if (!teachers.includes(t)) teachers.push(t);
            }
            teachers.forEach((t, gi) => {
                const course = HS_COURSES[t][p - 1] || 'Seminar';
                const secId = Number(insSec.run(staffId[t], course, `HS${p}(A)`, String(p), 'HS', roomOf(t)).lastInsertRowid);
                const group = order.slice(gi * 20, gi * 20 + 20);
                for (const s of group) insEnr.run(secId, s.dcid, enrolledOn);
                if (t === 'Avery') demoRoster[p] = group;
            });
        }

        const msCourses = {
            Ellis:   { 1: 'ELA 6', 2: 'ELA 7', 3: 'ELA 8', 4: 'ELA 7', Advisory: 'Advisory 7' },
            Nguyen:  { 1: 'Math 7', 2: 'Math 6', 3: 'Math 8', 4: 'Math 6', 5: 'Math 7', Advisory: 'Advisory 6' },
            Adeyemi: { 1: 'Science 8', 2: 'Science 6', 3: 'Science 7', 4: 'Science 8', 5: 'Science 6' },
        };
        const msDemoRoster = {};
        for (const p of ['1', '2', '3', '4', '5', 'Advisory']) {
            const order = shuffle(ms);
            const teachers = Object.keys(msCourses).filter(t => msCourses[t][p]).slice(0, 2);
            teachers.forEach((t, gi) => {
                const expr = /^\d$/.test(p) ? `MS${p}(A)` : 'ADV(A)';
                const secId = Number(insSec.run(staffId[t], msCourses[t][p], expr, p, 'MS', roomOf(t)).lastInsertRowid);
                const group = order.slice(gi * 20, gi * 20 + 20);
                for (const s of group) insEnr.run(secId, s.dcid, enrolledOn);
                if (t === 'Ellis') msDemoRoster[p] = group;
            });
        }

        // ── Flags ────────────────────────────────────────────────────────
        const insFlag = db.prepare(`INSERT INTO student_flags(student_dcid, type, note, start_date, end_date, created_by, created_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const R = demoRoster;
        const M = i => R[meeting[i % meeting.length]];   // a demo section that meets on the demo day
        const flag = (s, type, note, start, end = null) => insFlag.run(s.dcid, type, note, start, end, staffId.Ortega, created);
        flag(M(1)[3],  'pass_restriction', 'Escort required for all passes', demoDay);                  // starts today
        flag(R[2][2],  'elevator_pass',    'Temporary — ankle injury', d(-6), d(14));
        flag(R[3][4],  'tech_restriction', 'Chromebook for class use only', d(-20), d(10));
        flag(R[4][1],  'accommodation',    'Preferential seating; extended time', '2026-09-02');
        flag(R[6][5],  'has_504',          null, '2026-09-02');
        flag(R[1][7],  'has_iep',          null, '2026-08-27');
        flag(R[2][9],  'has_safety_plan',  null, d(-9));
        flag(R[6][2],  'student_senate',   'Class of 2028 representative', '2026-09-15');
        flag(hs[60],   'morning_search',   null, d(-4), d(21));
        flag(hs[45],   'pass_restriction', 'Main office passes only', d(-12));
        flag(hs[70],   'student_senate',   'Class of 2027 president', '2026-09-15');
        flag(msDemoRoster[1][2], 'elevator_pass', 'Temporary — crutches', d(-3), d(11));
        flag(msDemoRoster[2][5], 'tech_restriction', 'No personal devices', d(-15));
        flag(msDemoRoster[3][1], 'accommodation', 'Breaks as needed', '2026-09-02');
        flag(ms[20],   'student_senate',   'Grade 8 representative', '2026-09-15');
        // Expired, for the "show expired" toggle.
        flag(R[3][8],  'pass_restriction', 'Escort required', d(-40), d(-10));
        flag(hs[33],   'tech_restriction', 'Chromebook for class use only', d(-60), d(-30));

        // ── Serves ───────────────────────────────────────────────────────
        const insServe = db.prepare(`INSERT INTO serves(student_dcid, ps_incident_id, infraction_code, incident_date, sanction,
                serve_date, serve_end_date, periods, status, rescheduled_to, comments, offense_number, sus_letter_sent,
                person_responsible, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const serve = o => Number(insServe.run(o.s.dcid, o.inc || null, o.code, o.incident, o.sanction, o.date, o.end || null,
            o.periods, o.status || 'scheduled', o.to || null, o.comments || null, o.offense ?? null, o.letter ?? null,
            o.resp ?? staffId.Ortega, staffId.Ortega, created).lastInsertRowid);

        serve({ s: jordan, inc: 'INC-90412', code: 'B-12', incident: d(-2), sanction: 'ISS', date: demoDay, periods: '1,2,3',
                comments: 'Parent contacted by phone. Re-entry meeting after P3.', offense: 2, letter: 1 });
        serve({ s: M(2)[6], inc: 'INC-90398', code: 'C-04', incident: d(-3), sanction: 'OSS', date: d(-1), end: d(1), periods: 'ALL',
                comments: 'Re-entry meeting required before return.', offense: 1, letter: 1, resp: staffId.Whitfield });
        const later = serve({ s: R[6][8], code: 'A-02', incident: d(-6), sanction: 'Detention', date: d(2), periods: 'AFTER',
                comments: 'Rescheduled from missed detention.', offense: 3, letter: 0 });
        serve({ s: R[6][8], code: 'A-02', incident: d(-6), sanction: 'Detention', date: d(-3), periods: 'AFTER',
                status: 'rescheduled', to: later, comments: 'Did not report.', offense: 3, letter: 0 });
        serve({ s: R[2][11], code: 'A-01', incident: d(-8), sanction: 'Lunch detention', date: d(-5), periods: 'LUNCH',
                status: 'served', offense: 1, letter: 0 });
        serve({ s: hs[52], inc: 'INC-90420', code: 'B-07', incident: d(-1), sanction: 'ISS', date: demoDay, periods: 'ALL',
                comments: 'Second offense this quarter.', offense: 2, letter: 1 });
        serve({ s: hs[38], code: 'B-03', incident: d(-1), sanction: 'ISS', date: d(3), periods: '5,6',
                offense: 1, letter: 0, resp: staffId.Whitfield });
        serve({ s: msDemoRoster[2][3], code: 'A-01', incident: d(-1), sanction: 'Lunch detention', date: demoDay, periods: 'LUNCH',
                offense: 1, letter: 0 });

        // ── Field trips ──────────────────────────────────────────────────
        const insTrip = db.prepare(`INSERT INTO field_trips(title, date, depart_time, return_time, destination, info, submitted_by, status, reviewed_by, reviewed_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insAtt = db.prepare('INSERT OR IGNORE INTO trip_attendees(trip_id, student_dcid) VALUES (?, ?)');
        const trip = (o, students) => {
            const id = Number(insTrip.run(o.title, o.date, o.depart, o.ret, o.dest, o.info, o.by, o.status,
                o.status === 'pending' ? null : staffId.Kowalski, o.status === 'pending' ? null : created).lastInsertRowid);
            for (const s of students) insAtt.run(id, s.dcid);
            return id;
        };
        trip({ title: 'Science Center Field Study', date: demoDay, depart: '08:45', ret: '12:30', dest: 'Connecticut Science Center',
               info: 'Bus leaves from the front loop. Bagged lunch provided.', by: staffId.Okafor, status: 'approved' },
             [M(0)[1], M(1)[5], M(1)[10], M(2)[12], hs[40], hs[41]]);
        trip({ title: 'Hartford Stage Student Matinee', date: d(6), depart: '09:15', ret: '13:00', dest: 'Hartford Stage',
               info: 'English 10 sections. Permission slips due Friday.', by: staffId.Chen, status: 'pending' },
             [R[1][12], R[3][13], hs[10], hs[11], hs[12], hs[13], hs[14], hs[15]]);
        const visitAttendees = [R[2][14], R[3][15], hs[71], hs[72], hs[73]];
        const visit = trip({ title: 'College Visit — State University', date: d(8), depart: '08:00', ret: '13:30',
               dest: 'State University main campus', info: 'Grade 11 and 12 visit with admissions tour.',
               by: staffId.Brooks, status: 'changes_pending' }, visitAttendees);
        db.prepare(`INSERT INTO trip_revisions(trip_id, snapshot_json, submitted_by, submitted_at, status) VALUES (?, ?, ?, ?, 'pending')`).run(
            visit, JSON.stringify({
                title: 'College Visit — State University', date: d(8), depart_time: '08:00', return_time: '14:15',
                destination: 'State University main campus', info: 'Grade 11 and 12 visit with admissions tour. Return moved to 2:15 for the engineering session.',
                attendees: [...visitAttendees, hs[74], hs[75]].map(s => s.dcid),
            }), staffId.Brooks, created);

        // ── Links ────────────────────────────────────────────────────────
        const insLink = db.prepare(`INSERT INTO links(title, url, category, description, owner_staff_id, drive_file_id, drive_modified_at, pinned, sort)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const drive = id => `https://docs.google.com/document/d/DEMO-${id}/edit`;
        const LINKS = [
            ['PowerSchool', 'https://example.com/powerschool', 'Operational Responsibilities', 'Student information system', 'Nandakumar', 1],
            ['PowerTeacher', 'https://example.com/powerteacher', 'Grading & ACE', 'Attendance and gradebook', 'Nandakumar', 1],
            ['Frontline', 'https://example.com/frontline', 'Operational Responsibilities', 'Staff absences and sub requests', 'Kowalski', 1],
            ['IT Help Ticket', 'https://example.com/it-ticket', 'Operational Responsibilities', 'Report a device or tech problem', 'Nandakumar', 1],
            ['District Calendar', 'https://example.com/district-calendar', 'School Launch', '2026–27 district calendar', 'Kowalski', 1],
            ['Field Trip Requests', '/staff/trips.html', 'Operational Responsibilities', 'Submit and track field trips', 'Kowalski', 1],
            ['Duty Roster 26–27', drive('duty'), 'Operational Responsibilities', 'Morning, lunch and dismissal duties', 'Ortega'],
            ['Emergency Procedures Flipchart', drive('emerg'), 'Culture/Climate & Safety', 'Lockdown, evacuation and shelter steps', 'Whitfield'],
            ['Behavior Response Matrix', drive('matrix'), 'Culture/Climate & Safety', 'Classroom vs. office-managed behaviors', 'Ortega'],
            ['Referral Form', 'https://example.com/referral', 'Culture/Climate & Safety', 'Submit a behavior referral', 'Ortega'],
            ['Grading Policy 26–27', drive('grading'), 'Grading & ACE', 'Weights, late work and retakes', 'Whitfield'],
            ['ACE Guidance', drive('ace'), 'Grading & ACE', 'Academic Credit Enhancement process', 'Ortega'],
            ['Progress Report Calendar', drive('progress'), 'Grading & ACE', 'Quarter and progress-report deadlines', 'Kowalski'],
            ['Curriculum Maps', drive('maps'), 'Curriculum & Instruction', 'Course maps by department', 'Whitfield'],
            ['Lesson Plan Template', drive('lesson'), 'Curriculum & Instruction', 'Shared lesson plan format', 'Whitfield'],
            ['SAT Prep Resources', drive('sat'), 'Curriculum & Instruction', 'Advisory & SAT Prep block materials', 'Avery'],
            ['ML Strategies Toolkit', drive('ml'), 'Curriculum & Instruction', 'Supports for multilingual learners', 'Dubois'],
            ['Opening Day Checklist', drive('opening'), 'School Launch', 'First-week tasks for staff', 'Kowalski'],
            ['Staff Handbook', drive('handbook'), 'School Launch', 'Policies and procedures', 'Whitfield'],
            ['Room Assignments', drive('rooms'), 'School Launch', 'Rooms and shared spaces', 'Kowalski'],
            ['Learning Walk Form', 'https://example.com/learning-walk', 'Learning Walk Tools', 'Observation form', 'Ortega'],
            ['Look-Fors 26–27', drive('lookfors'), 'Learning Walk Tools', 'Focus indicators this year', 'Whitfield'],
            ['Learning Walk Schedule', drive('lwsched'), 'Learning Walk Tools', 'Who visits which rooms', 'Ortega'],
            ['PLC Agenda Template', drive('plcagenda'), 'PLCs', 'Weekly PLC agenda format', 'Whitfield'],
            ['PLC Norms', drive('plcnorms'), 'PLCs', 'Agreed team norms', 'Whitfield'],
            ['Data Protocol', drive('dataprot'), 'PLCs', 'Looking-at-student-work protocol', 'Ortega'],
            ['Grade 9 Team Folder', drive('g9'), 'Grade Level Teams', 'Grade 9 team notes and plans', 'Chen'],
            ['Grade 10 Team Folder', drive('g10'), 'Grade Level Teams', 'Grade 10 team notes and plans', 'Avery'],
            ['Grade 11–12 Team Folder', drive('g1112'), 'Grade Level Teams', 'Upper grades team notes', 'Brooks'],
            ['MS Team Folder', drive('ms'), 'Grade Level Teams', 'Middle school team notes', 'Ellis'],
        ];
        LINKS.forEach(([title, url, cat, desc, owner, pinned], i) => {
            const isDrive = url.includes('docs.google.com');
            insLink.run(title, url, cat, desc, staffId[owner], isDrive ? `DEMO-${i}` : null,
                d(-Math.floor(rand() * 40) - 1) + 'T14:00:00Z', pinned ? 1 : 0, i);
        });

        // ── FAQ ──────────────────────────────────────────────────────────
        const insFaq = db.prepare('INSERT INTO faq(topic, primary_contact, secondary_contact, notes) VALUES (?, ?, ?, ?)');
        [
            ['Building concerns (heat, leaks, furniture)', 'Kowalski', 'Ortega', 'Email with room number; urgent issues call ext. 1000.'],
            ['Attendance', 'Rivera', 'Kowalski', 'Corrections must be emailed by end of day.'],
            ['Grades 6–9: emotional or home issues', 'Ramos', 'Alvarez', 'Walk the student to the counseling office if urgent.'],
            ['Grades 10–12: emotional or home issues', 'Moss', 'Alvarez', 'Walk the student to the counseling office if urgent.'],
            ['Student schedules', 'Moss', 'Ramos', 'Schedule change form is in the counseling office.'],
            ['Technology', 'Nandakumar', null, 'Use the IT Help Ticket for anything non-urgent.'],
            ['504 plans', 'Ramos', 'Moss', 'Plans are in PowerSchool; ask before sharing with subs.'],
            ['IEPs', 'Park', 'Ortega', 'Case manager list is in the Staff Handbook.'],
            ['Staff absences and coverage', 'Kowalski', 'Whitfield', 'Enter in Frontline by 6:00 a.m.; text the office line too.'],
            ['Morning announcements', 'Rivera', null, 'Submit by 2:00 p.m. the day before.'],
            ['Athletics', 'Wu', null, 'Eligibility lists go out every Monday.'],
            ['ML supports', 'Dubois', 'Ramos', 'Request push-in support by email.'],
        ].forEach(([topic, p, s, notes]) => insFaq.run(topic, staffId[p], s ? staffId[s] : null, notes));

        // ── Bell templates ───────────────────────────────────────────────
        const insTpl = db.prepare('INSERT INTO bell_templates(id, name, division, kind, default_map_json) VALUES (?, ?, ?, ?, ?)');
        const insSlot = db.prepare('INSERT INTO bell_slots(template_id, slot_order, start_time, end_time, label, note) VALUES (?, ?, ?, ?, ?, ?)');
        insTpl.run(1, 'HS 5-day', 'HS', 'regular', JSON.stringify(HS_ROTATION));
        SLOT_TIMES.forEach(([s, e], i) => insSlot.run(1, i + 1, s, e, `Slot ${i + 1}`,
            i === 3 ? 'Lunch: MS 10:30–11:00 · Gr 10/11 11:05–11:35 · Gr 9/12 11:40–12:10' : null));
        insTpl.run(2, 'HS early release', 'HS', 'early_release', null);
        [['07:30','08:16','P5',null], ['08:20','09:06','P6',null], ['09:10','09:56','P1',null],
         ['10:00','11:00','P2','Staggered dismissal from 10:45'], ['11:45','14:10','Staff PL','Staff professional learning']]
            .forEach(([s, e, l, n], i) => insSlot.run(2, i + 1, s, e, l, n));
        insTpl.run(3, 'HS X day', 'HS', 'x_day', JSON.stringify(X_MAP));
        [['07:30','08:11','P1'], ['08:15','08:56','P2'], ['09:00','09:41','P3'], ['09:45','10:26','P4'],
         ['10:30','12:10','X block'], ['12:14','13:10','P5'], ['13:14','14:10','P6']]
            .forEach(([s, e, l], i) => insSlot.run(3, i + 1, s, e, l, i === 4 ? 'X block: P7 or Advisory · lunch waves as usual' : null));
        insTpl.run(4, 'MS 5-day', 'MS', 'regular', JSON.stringify(MS_ROTATION));
        SLOT_TIMES.forEach(([s, e], i) => insSlot.run(4, i + 1, s, e, `Slot ${i + 1}`, i === 3 ? 'MS lunch 10:30–11:00' : null));

        // ── Day plans: two weeks back, four weeks ahead ──────────────────
        const insPlan = db.prepare('INSERT INTO day_plans(date, division, template_id, slot_map_json, note, is_school_day) VALUES (?, ?, ?, ?, ?, ?)');
        for (let day = d(-14); day <= d(28); day = time.addDays(day, 1)) {
            if (!time.isWeekday(day)) continue;
            const key = time.dayKey(day);
            if (day.endsWith('-11-11')) {
                insPlan.run(day, 'HS', null, null, 'Veterans Day — no school', 0);
                insPlan.run(day, 'MS', null, null, 'Veterans Day — no school', 0);
            } else if (day === erWed) {
                insPlan.run(day, 'HS', 2, null, 'Early release — staggered dismissal from 10:45, staff PL at 11:45', 1);
                insPlan.run(day, 'MS', 4, JSON.stringify(MS_ROTATION[key]), 'Early release — MS bell times to be confirmed', 1);
            } else if (day === xFri) {
                insPlan.run(day, 'HS', 3, JSON.stringify(X_MAP[key]), 'X day — X block is P7 this week', 1);
                insPlan.run(day, 'MS', 4, JSON.stringify(MS_ROTATION[key]), null, 1);
            } else {
                insPlan.run(day, 'HS', 1, JSON.stringify(HS_ROTATION[key]), null, 1);
                insPlan.run(day, 'MS', 4, JSON.stringify(MS_ROTATION[key]), null, 1);
            }
        }

        // ── Duties ───────────────────────────────────────────────────────
        const insDuty = db.prepare(`INSERT INTO duty_slots(name, location, start_time, end_time, week_type, day_key) VALUES (?, ?, ?, ?, '5-day', ?)`);
        const insAssign = db.prepare('INSERT OR IGNORE INTO duty_assignments(duty_slot_id, staff_id) VALUES (?, ?)');
        const DUTIES = [
            ['Morning — Front Entrance', 'Main entrance', '07:05', '07:30'],
            ['Morning — Breakfast', 'Cafeteria', '07:00', '07:30'],
            ['HS Lunch', 'Cafeteria', '11:05', '12:10'],
            ['MS Lunch', 'Cafeteria', '10:30', '11:00'],
            ['Dismissal — Bus Loop', 'Front loop', '14:10', '14:30'],
            ['Dismissal — Main Lobby', 'Main lobby', '14:10', '14:25'],
        ];
        const pool = ['Okafor','Chen','Brooks','Lindqvist','Patel','Santos','Harper','Park','Fisher','Grant','Nguyen','Adeyemi','Wu','Dubois'];
        let pi = 0;
        for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
            DUTIES.forEach(([name, loc, s, e]) => {
                const id = Number(insDuty.run(name, loc, s, e, day).lastInsertRowid);
                if (name === 'Morning — Front Entrance' && day === demoKey) insAssign.run(id, DEMO_T);
                else if (name === 'Dismissal — Bus Loop' && day === 'Thu') insAssign.run(id, DEMO_T);
                else if (name === 'MS Lunch' && day === demoKey) insAssign.run(id, DEMO_MS);
                else insAssign.run(id, staffId[pool[pi++ % pool.length]]);
                if (name.startsWith('Dismissal') || name === 'HS Lunch') insAssign.run(id, staffId[pool[pi++ % pool.length]]);
            });
        }

        // ── Calendar ─────────────────────────────────────────────────────
        const insEv = db.prepare(`INSERT INTO calendar_events(uid, title, start, end, all_day, location, source) VALUES (?, ?, ?, ?, ?, ?, 'manual')`);
        [
            ['Math & Science PLC', `${demoDay}T14:20`, `${demoDay}T15:10`, 0, 'Room 214'],
            ['Grade 10 Team Meeting', `${d(1)}T14:20`, `${d(1)}T15:00`, 0, 'Room 220'],
            ['Early Release — Staff PL', erWed, erWed, 1, 'Library'],
            ['ELA & Social Studies PLC', `${d(4)}T14:20`, `${d(4)}T15:10`, 0, 'Room 226'],
            ['SAT School Day (Grade 11)', d(7), d(7), 1, 'Gym & cafeteria'],
            ['Parent–Teacher Conferences', `${d(9)}T15:30`, `${d(9)}T19:00`, 0, 'All classrooms'],
            ['Math & Science PLC', `${d(7)}T14:20`, `${d(7)}T15:10`, 0, 'Room 214'],
            ['Fire Drill (announced)', `${d(10)}T09:40`, `${d(10)}T09:55`, 0, 'Whole building'],
            ['Quarter 1 grades due', d(13), d(13), 1, 'PowerTeacher'],
            ['MS Family Night', `${d(15)}T17:30`, `${d(15)}T19:00`, 0, 'Cafeteria'],
            ['Faculty Meeting', `${d(18)}T14:20`, `${d(18)}T15:20`, 0, 'Library'],
        ].forEach(([title, start, end, allDay, loc], i) => insEv.run(`demo-${i}@staffhub`, title, start, end, allDay, loc));
    });

    rebuildSearch();
    return { demoDay, earlyRelease: erWed, xDay: xFri };
}

if (require.main === module) {
    const out = seed();
    const counts = ['staff', 'students', 'sections', 'enrollments', 'student_flags', 'serves', 'field_trips', 'links', 'faq', 'day_plans', 'duty_slots', 'calendar_events']
        .map(t => `${t}=${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`).join(' ');
    console.log(`Staff Hub demo data seeded. ${counts}`);
    console.log(`Demo day ${out.demoDay} · early release ${out.earlyRelease} · X day ${out.xDay}`);
}

module.exports = { seed };
