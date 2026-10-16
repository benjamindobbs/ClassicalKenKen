// `npm run staff:check`: end-to-end checks against a throwaway copy of the
// hub. Seeds a temp staff.db, starts the real server on it (with a temp
// scores.db too, so the real one is never opened), then calls the API as
// each role and walks the done-when flows from STAFF_HUB_README.md.

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staffhub-check-'));
process.env.STAFF_DB_PATH = path.join(tmp, 'staff.db');

const { seed } = require('./seed');
const { ROLES } = require('./permissions');
const { demoDay, earlyRelease, xDay } = seed();
require('./db').db.close();

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}/api/staff`;
const env = { ...process.env, STAFF_DEMO: '1', STAFF_DB_PATH: process.env.STAFF_DB_PATH,
              DB_PATH: path.join(tmp, 'scores.db'), PORT: String(PORT), MAIL_TRANSPORT: 'console' };
delete env.FLY_APP_NAME;
delete env.STAFF_MEMO_CRON;

let failures = 0, passes = 0;
function ok(cond, msg) {
    if (cond) passes++;
    else { failures++; console.log(`  FAIL ${msg}`); }
}

async function call(user, method, p, body, extra = {}) {
    const headers = { 'X-Staff-Date': demoDay, ...extra };
    if (user) headers['X-Staff-User'] = String(user);
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* CSV etc. */ }
    return { status: res.status, json, text };
}

// [method, path, capability, body]. Write bodies are deliberately invalid
// or point at missing rows, so an allowed call returns 400/404 rather than
// changing data; a denied one must return 403 before validation runs.
const MATRIX = [
    ['GET', '/today', 'view_today'],
    ['GET', '/search?q=power', 'view_today'],
    ['GET', '/links', 'view_links'],
    ['POST', '/links', 'edit_links', {}],
    ['PUT', '/links/999999', 'edit_links', {}],
    ['DELETE', '/links/999999', 'edit_links'],
    ['POST', '/links/reorder', 'edit_links', {}],
    ['GET', '/faq', 'view_faq'],
    ['GET', '/directory', 'view_directory'],
    ['GET', '/students?q=re', 'view_students'],
    ['GET', '/flags', 'view_flags'],
    ['POST', '/flags', 'edit_flags', {}],
    ['POST', '/flags/999999/end', 'edit_flags', {}],
    ['GET', '/serves', 'view_serves'],
    ['POST', '/serves', 'edit_serves', {}],
    ['POST', '/serves/999999/status', 'edit_serves', { status: 'served' }],
    ['POST', '/serves/999999/reschedule', 'edit_serves', { serve_date: demoDay }],
    ['GET', '/trips', 'view_trips'],
    ['POST', '/trips', 'submit_trips', {}],
    ['PUT', '/trips/999999', 'submit_trips', {}],
    ['POST', '/trips/999999/approve', 'approve_trips', {}],
    ['POST', '/trips/999999/reject', 'approve_trips', {}],
    ['GET', '/templates', 'view_schedule'],
    ['GET', '/day-plans', 'view_schedule'],
    ['PUT', '/day-plans/2026-02-31/HS', 'edit_day_plans', {}],
    ['GET', '/duties', 'view_schedule'],
    ['GET', '/memo', 'view_memo'],
    ['GET', '/import/sample/students', 'import'],
    ['POST', '/import/students/preview', 'import', { csv: '' }],
    ['POST', '/import/students/commit', 'import', { csv: '' }],
    ['GET', '/users', 'manage_users'],
    ['PUT', '/users/999999', 'manage_users', {}],
    ['GET', '/audit', 'view_audit'],
];

const ADMIN_SERVE_FIELDS = ['comments', 'offense_number', 'sus_letter_sent', 'person_responsible', 'person_responsible_name', 'status', 'ps_incident_id'];

async function main() {
    const personas = (await call(null, 'GET', '/demo/personas')).json;
    const P = Object.fromEntries(personas.map(p => [p.label, p]));
    const as = role => personas.find(p => p.role === role).id;
    const teacher = P['Teacher'].id, office = as('office'), adminS = as('admin_school'), adminT = as('admin_tech'), guest = as('guest'), staff = as('staff');

    console.log(`Staff Hub check · demo day ${demoDay} · ${personas.length} personas`);

    // ── 1. Permission matrix ───────────────────────────────────────────
    console.log('Permission matrix (every route × every role)');
    ok((await call(null, 'GET', '/today')).status === 401, 'no user → 401');
    ok((await call(999999, 'GET', '/today')).status === 401, 'unknown user → 401');
    for (const p of personas) {
        for (const [method, route, cap, body] of MATRIX) {
            const allowed = ROLES[p.role].caps.includes(cap);
            const r = await call(p.id, method, route, body);
            if (allowed) ok(r.status !== 403 && r.status !== 401 && r.status < 500, `${p.label} ${method} ${route} should pass the ${cap} gate (got ${r.status})`);
            else ok(r.status === 403, `${p.label} ${method} ${route} should be 403 without ${cap} (got ${r.status})`);
        }
    }
    const sync = await call(guest, 'POST', '/sync/roster', {});
    ok(sync.status === 403, `guest POST /sync/roster should be 403 (got ${sync.status})`);
    ok((await call(teacher, 'POST', '/sync/roster', {})).status === 400, 'teacher POST /sync/roster passes the gate');

    // ── 2. Serve field stripping ───────────────────────────────────────
    console.log('Serve fields');
    for (const id of [teacher, staff]) {
        const r = await call(id, 'GET', '/serves?from=2000-01-01');
        const leaked = r.json.flatMap(s => ADMIN_SERVE_FIELDS.filter(f => f in s));
        ok(r.json.length > 0 && leaked.length === 0, `role ${id} must not receive ${[...new Set(leaked)].join(', ') || 'admin fields'}`);
        const stu = r.json[0].student_dcid;
        const d = await call(id, 'GET', `/students/${stu}`);
        ok(d.json.serves.every(s => ADMIN_SERVE_FIELDS.every(f => !(f in s))), `role ${id} student page serves are stripped`);
    }
    const full = await call(office, 'GET', '/serves?from=2000-01-01');
    ok(full.json.some(s => s.comments), 'office sees serve comments');
    ok(full.json.some(s => s.status === 'rescheduled'), 'office sees rescheduled serves');
    ok((await call(teacher, 'POST', '/serves', { student_dcid: full.json[0].student_dcid, sanction: 'ISS', serve_date: demoDay, periods: '1' })).status === 403,
       'teacher cannot create a serve with a valid body');
    ok((await call(office, 'POST', '/serves', { student_dcid: full.json[0].student_dcid, sanction: 'ISS', serve_date: demoDay, periods: '1' })).status === 403,
       'office cannot create a serve');

    // ── 3. Today for the demo teacher ──────────────────────────────────
    console.log('Today');
    const today = (await call(teacher, 'GET', '/today')).json;
    ok(today.isSchoolDay && today.schedule.length >= 5, 'demo teacher has a schedule on the demo day');
    ok(today.schedule.filter(s => s.section).length >= 3, 'schedule maps to the teacher\'s sections');
    ok(today.duties.length >= 1, 'demo teacher has a duty on the demo day');
    const iss = today.studentsByPeriod.flatMap(g => g.students.flatMap(s => s.items.map(i => ({ ...i, g: g.period, name: `${s.first} ${s.last}` }))))
        .find(i => i.text === 'ISS (P1–3)');
    ok(iss && iss.affects && iss.name === 'Jordan Reyes', 'Jordan Reyes shows as ISS (P1–3) under a P1–3 period');
    ok(today.studentsByPeriod.some(g => g.students.some(s => s.items.some(i => i.startsToday))), 'a flag starting today is marked new');
    ok(today.studentsByPeriod.some(g => g.students.some(s => s.items.some(i => i.kind === 'trip'))), 'a roster student is on today\'s trip');

    const er = (await call(teacher, 'GET', '/today', null, { 'X-Staff-Date': earlyRelease })).json;
    ok(er.template?.kind === 'early_release' && er.schedule[0].end === '08:16', 'seeded early-release day has early-release times');
    const xd = (await call(teacher, 'GET', '/today', null, { 'X-Staff-Date': xDay })).json;
    ok(xd.template?.kind === 'x_day' && xd.schedule.length === 7, 'seeded X day has 7 slots');

    // Switching a day in Schedule changes Today's times.
    const target = demoDay;
    const put = await call(office, 'PUT', `/day-plans/${target}/HS`, { template_id: 2, is_school_day: true, note: 'Check: switched to early release' });
    ok(put.status === 200, 'office can switch a day to early release');
    const after = (await call(teacher, 'GET', '/today')).json;
    ok(after.schedule[0].end === '08:16' && after.note === 'Check: switched to early release', 'Today shows the switched times and note');
    await call(office, 'PUT', `/day-plans/${target}/HS`, { template_id: 1, is_school_day: true });

    // ── 4. Search ──────────────────────────────────────────────────────
    console.log('Search');
    const s1 = (await call(teacher, 'GET', '/search?q=powerschool')).json.groups;
    ok(s1.link?.length, 'search finds a link');
    ok((await call(teacher, 'GET', '/search?q=attendance')).json.groups.faq?.length, 'search finds a FAQ row');
    ok((await call(teacher, 'GET', '/search?q=okafor')).json.groups.staff?.length, 'search finds a staff member');
    ok((await call(teacher, 'GET', '/search?q=jordan reyes')).json.groups.student?.length, 'teacher search finds a student');
    const gs = (await call(guest, 'GET', '/search?q=jordan')).json.groups;
    ok(!gs.student && !gs.staff && !gs.faq, 'guest search returns no students, staff or FAQ');

    // ── 5. Field trip flow ─────────────────────────────────────────────
    console.log('Field trips');
    const auditBefore = (await call(adminS, 'GET', '/audit')).json.rows.length;
    const okaforSecs = (await call(office, 'GET', '/sections?all=1')).json.filter(s => s.teacher_name === 'Sam Okafor');
    const roster = (await call(teacher, 'GET', `/sections/${okaforSecs[0].id}/students`)).json.slice(0, 2);
    const created = await call(teacher, 'POST', '/trips', { title: 'Check trip', date: demoDay, depart_time: '07:00', return_time: '14:30',
                                                             destination: 'Museum', attendees: roster.map(s => s.dcid) });
    ok(created.status === 200, 'teacher submits a trip');
    const tripId = created.json.id;
    ok((await call(teacher, 'POST', `/trips/${tripId}/approve`, {})).status === 403, 'teacher cannot approve');
    ok((await call(office, 'POST', `/trips/${tripId}/approve`, {})).status === 200, 'office approves');
    const okafor = okaforSecs[0].teacher_id;
    const onToday = async () => (await call(okafor, 'GET', '/today')).json.studentsByPeriod
        .some(g => g.students.some(s => s.items.some(i => i.text.startsWith('Field trip: Check trip'))));
    ok(await onToday(), "trip shows on the attendees' teacher's Today");
    const edit = await call(teacher, 'PUT', `/trips/${tripId}`, { title: 'Check trip', date: demoDay, depart_time: '07:00', return_time: '13:00',
                                                                   destination: 'Museum', attendees: roster.map(s => s.dcid) });
    ok(edit.json?.status === 'changes_pending', 'editing an approved trip creates a pending revision');
    const det = (await call(teacher, 'GET', `/trips/${tripId}`)).json;
    ok(det.trip.return_time === '14:30' && det.revision?.snapshot.return_time === '13:00', 'approved version stays live while the revision is pending');
    ok(await onToday(), 'trip still shows on Today while changes are pending');
    ok((await call(office, 'POST', `/trips/${tripId}/approve`, {})).status === 200, 'office approves the revision');
    ok((await call(teacher, 'GET', `/trips/${tripId}`)).json.trip.return_time === '13:00', 'approved revision is applied');

    // ── 6. Same-day alert ──────────────────────────────────────────────
    console.log('Alerts');
    const stu = roster[0].dcid;
    const serve = await call(adminS, 'POST', '/serves', { student_dcid: stu, sanction: 'ISS', serve_date: demoDay, periods: 'ALL',
                                                         infraction_code: 'X-01', comments: 'check' }, { 'X-Staff-Time': '07:00' });
    ok(serve.status === 200 && serve.json.alert?.count >= 1, `admin serve for today queues alerts (got ${serve.json?.alert?.count})`);
    const flag = await call(office, 'POST', '/flags', { student_dcid: stu, type: 'pass_restriction', note: 'check' }, { 'X-Staff-Time': '07:00' });
    ok(flag.status === 200 && flag.json.alert?.count >= 1, 'office flag for today queues alerts');
    const late = await call(office, 'POST', '/flags', { student_dcid: stu, type: 'elevator_pass' }, { 'X-Staff-Time': '15:00' });
    ok(late.json.alert?.count === 0, 'no alerts after the last period');

    // ── 7. Import diff ─────────────────────────────────────────────────
    console.log('Imports');
    const sample = await call(adminT, 'GET', '/import/sample/students');
    ok(sample.status === 200 && sample.text.startsWith('dcid,'), 'sample CSV downloads');
    const preview = await call(adminT, 'POST', '/import/students/preview', { csv: sample.text });
    ok(preview.json.adds.length === 1 && preview.json.removals.length > 100, 'preview shows adds and removals before commit');
    const stillThere = (await call(teacher, 'GET', '/students?q=re')).json.length;
    ok(stillThere > 0, 'preview did not change any data');

    // ── 8. Memo ────────────────────────────────────────────────────────
    console.log('Memo');
    for (const p of personas) {
        if (!ROLES[p.role].caps.includes('view_memo')) continue;
        const m = await call(p.id, 'GET', '/memo');
        ok(m.status === 200 && m.json.html.includes('Good morning') && m.json.text.length > 50, `memo renders for ${p.label}`);
    }
    const tm = (await call(teacher, 'GET', '/memo')).json;
    ok(tm.html.includes('Jordan') && tm.html.includes('ISS'), 'teacher memo lists students by period');
    ok((await call(teacher, 'POST', '/memo/send-test', {})).json.transport === 'console', 'send test only logs');

    // ── 9. Audit ───────────────────────────────────────────────────────
    console.log('Audit');
    const rows = (await call(adminS, 'GET', '/audit')).json.rows;
    // trip create, approve, revise, approve revision, serve, 2 flags (+ the 2 day-plan writes earlier)
    ok(rows.length - auditBefore === 7, `every write since the trip flow is audited (expected 7, got ${rows.length - auditBefore})`);
    ok(rows.some(r => r.entity === 'day_plan'), 'day plan changes are audited');
}

const server = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

(async () => {
    for (let i = 0; i < 50; i++) {
        try { if ((await fetch(`${BASE}/config`)).ok) break; } catch { /* starting */ }
        await new Promise(r => setTimeout(r, 200));
    }
    try {
        await main();
    } catch (e) {
        failures++;
        console.error(e);
        console.error(log.slice(-2000));
    } finally {
        server.kill();
        console.log(`\n${passes} passed, ${failures} failed`);
        setTimeout(() => {
            try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
            process.exit(failures ? 1 : 0);
        }, 300);
    }
})();
