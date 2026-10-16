// Staff Hub API, mounted at /api/staff. Every route checks a capability from
// server/staff/permissions.js; the UI hiding a button is never the only guard.

const { Router } = require('express');
const { db, audit, tx, rebuildSearch, nowIso, ftsAvailable } = require('../staff/db');
const { can, capsFor, requireCap, shapeServe, ROLES, ROLE_NAMES } = require('../staff/permissions');
const { isDemo, attachUser } = require('../staff/context');
const schedule = require('../staff/schedule');
const time     = require('../staff/time');
const { buildMemo } = require('../staff/memo');
const { sendMail }  = require('../staff/mail');
const imports  = require('../staff/imports');

const router = Router();

if (isDemo() && db.prepare('SELECT COUNT(*) n FROM staff').get().n === 0) {
    const { demoDay } = require('../staff/seed').seed();
    console.log(`staff: empty database, seeded demo data (demo day ${demoDay})`);
}
if (process.env.STAFF_MEMO_CRON === '1') require('../staff/cron').start();

router.use(attachUser);

// Wrap handlers so thrown errors become JSON responses.
const h = fn => (req, res) => {
    try {
        const out = fn(req, res);
        if (out && typeof out.then === 'function') out.catch(e => fail(res, e));
    } catch (e) { fail(res, e); }
};
function fail(res, e) {
    if (!e.status) console.error('[staff]', e);
    res.status(e.status || 500).json({ error: e.message, details: e.details });
}
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const notFound = what => Object.assign(new Error(`${what} not found`), { status: 404 });
const forbidden = msg => Object.assign(new Error(msg), { status: 403 });

const nameOf = s => s ? (s.display_name || `${s.first} ${s.last}`) : null;
// node:sqlite throws on undefined bindings, so validate before querying.
function requireStudent(dcid) {
    if (!/^\d+$/.test(String(dcid ?? '')) || !db.prepare('SELECT 1 FROM students WHERE dcid = ?').get(Number(dcid))) throw bad('Unknown student');
}
const staffName = id => nameOf(db.prepare('SELECT first, last, display_name FROM staff WHERE id = ?').get(id));

// ── Session ──────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
    res.json({ demo: isDemo(), school: 'Classical Magnet School', today: req.today, now: req.now, realToday: time.localDate() });
});

router.get('/demo/personas', h((req, res) => {
    if (!isDemo()) throw notFound('Route');
    const personas = [];
    for (const role of ROLE_NAMES) {
        const s = db.prepare('SELECT * FROM staff WHERE role = ? AND active = 1 ORDER BY id LIMIT 1').get(role);
        if (s) personas.push({ id: s.id, role, label: ROLES[role].label, name: nameOf(s) });
    }
    const ms = db.prepare("SELECT * FROM staff WHERE role = 'teacher' AND division = 'MS' AND active = 1 ORDER BY id LIMIT 1").get();
    if (ms) personas.splice(4, 0, { id: ms.id, role: 'teacher', label: 'Teacher (MS)', name: nameOf(ms) });
    res.json(personas);
}));

router.get('/me', h((req, res) => {
    if (!req.staffUser) return res.status(401).json({ error: 'Not signed in', demo: isDemo() });
    const u = req.staffUser;
    res.json({ id: u.id, name: nameOf(u), email: u.email, role: u.role, roleLabel: ROLES[u.role]?.label,
               division: u.division, caps: capsFor(u.role), demo: isDemo() });
}));

// ── Today ────────────────────────────────────────────────────────────────

router.get('/today', requireCap('view_today'), h((req, res) => {
    const u = req.staffUser;
    res.json({
        now: req.now,
        ...schedule.buildToday(u, req.today, {
            includeStudents: can(u, 'view_students'),
            includeCounts: can(u, 'view_school_counts'),
        }),
    });
}));

// ── Search ───────────────────────────────────────────────────────────────

const KIND_CAP = { link: 'view_links', faq: 'view_faq', staff: 'view_directory', event: 'view_today', student: 'view_students' };

router.get('/search', requireCap('view_today'), h((req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ q, groups: {} });
    const kinds = Object.keys(KIND_CAP).filter(k => can(req.staffUser, KIND_CAP[k]));
    let hits;
    if (ftsAvailable()) {
        const match = q.split(/\s+/).map(t => t.replace(/"/g, '')).filter(Boolean).map(t => `"${t}"*`).join(' ');
        hits = db.prepare(`SELECT kind, ref, title, body FROM search_index WHERE search_index MATCH ?
                           AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY rank LIMIT 60`).all(match, ...kinds);
    } else {
        hits = [];
    }
    const groups = {};
    for (const hit of hits) {
        const g = groups[hit.kind] || (groups[hit.kind] = []);
        if (g.length >= 8) continue;
        g.push(describeHit(hit));
    }
    res.json({ q, groups });
}));

function describeHit({ kind, ref, title }) {
    switch (kind) {
        case 'link': {
            const l = db.prepare('SELECT url, category FROM links WHERE id = ?').get(ref);
            return { kind, id: ref, title, sub: l?.category, href: l?.url, external: true };
        }
        case 'faq': {
            const f = db.prepare('SELECT primary_contact FROM faq WHERE id = ?').get(ref);
            return { kind, id: ref, title, sub: f ? `Contact: ${staffName(f.primary_contact)}` : '', href: `contacts.html?q=${encodeURIComponent(title)}` };
        }
        case 'staff': {
            const s = db.prepare('SELECT title, room FROM staff WHERE id = ?').get(ref);
            return { kind, id: ref, title, sub: [s?.title, s?.room && `Rm ${s.room}`].filter(Boolean).join(' · '), href: `directory.html?q=${encodeURIComponent(title)}` };
        }
        case 'event': {
            const e = db.prepare('SELECT start FROM calendar_events WHERE id = ?').get(ref);
            return { kind, id: ref, title, sub: e?.start.slice(0, 10), href: `index.html?date=${e?.start.slice(0, 10)}` };
        }
        case 'student': {
            const s = db.prepare('SELECT student_number, grade FROM students WHERE dcid = ?').get(ref);
            return { kind, id: ref, title, sub: `#${s?.student_number} · Grade ${s?.grade}`, href: `students.html?dcid=${ref}` };
        }
    }
}

// ── Links ────────────────────────────────────────────────────────────────

router.get('/links', requireCap('view_links'), h((req, res) => {
    res.json(db.prepare(`SELECT l.*, s.display_name AS owner_name FROM links l LEFT JOIN staff s ON s.id = l.owner_staff_id
                         ORDER BY l.sort, l.id`).all());
}));

function linkInput(b) {
    if (!b.title || !b.url || !b.category) throw bad('title, url and category are required');
    return { title: String(b.title).trim(), url: String(b.url).trim(), category: String(b.category).trim(),
             description: b.description ? String(b.description).trim() : null, pinned: b.pinned ? 1 : 0,
             owner_staff_id: b.owner_staff_id ? Number(b.owner_staff_id) : null };
}

router.post('/links', requireCap('edit_links'), h((req, res) => {
    const l = linkInput(req.body);
    const sort = (db.prepare('SELECT MAX(sort) m FROM links').get().m ?? 0) + 1;
    const id = Number(db.prepare(`INSERT INTO links(title, url, category, description, owner_staff_id, pinned, sort, drive_modified_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        l.title, l.url, l.category, l.description, l.owner_staff_id ?? req.staffUser.id, l.pinned, sort, nowIso()).lastInsertRowid);
    audit(req.staffUser.id, 'create', 'link', id, null, { ...l, sort });
    rebuildSearch();
    res.json({ id });
}));

router.put('/links/:id', requireCap('edit_links'), h((req, res) => {
    const before = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Link');
    const l = linkInput({ owner_staff_id: before.owner_staff_id, ...req.body });
    db.prepare('UPDATE links SET title = ?, url = ?, category = ?, description = ?, owner_staff_id = ?, pinned = ?, drive_modified_at = ? WHERE id = ?')
        .run(l.title, l.url, l.category, l.description, l.owner_staff_id, l.pinned, nowIso(), before.id);
    audit(req.staffUser.id, 'update', 'link', before.id, before, l);
    rebuildSearch();
    res.json({ ok: true });
}));

router.delete('/links/:id', requireCap('edit_links'), h((req, res) => {
    const before = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Link');
    db.prepare('DELETE FROM links WHERE id = ?').run(before.id);
    audit(req.staffUser.id, 'delete', 'link', before.id, before, null);
    rebuildSearch();
    res.json({ ok: true });
}));

// Body: { ids: [...] } in the new order.
router.post('/links/reorder', requireCap('edit_links'), h((req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
    if (!ids) throw bad('ids array required');
    const before = db.prepare('SELECT id, sort FROM links ORDER BY sort').all();
    tx(() => ids.forEach((id, i) => db.prepare('UPDATE links SET sort = ? WHERE id = ?').run(i, id)));
    audit(req.staffUser.id, 'reorder', 'link', null, before.map(r => r.id), ids);
    res.json({ ok: true });
}));

// ── FAQ & directory ──────────────────────────────────────────────────────

router.get('/faq', requireCap('view_faq'), h((req, res) => {
    res.json(db.prepare(`
        SELECT f.*, p.display_name AS primary_name, p.email AS primary_email, p.phone_ext AS primary_ext,
               s.display_name AS secondary_name, s.email AS secondary_email, s.phone_ext AS secondary_ext
        FROM faq f LEFT JOIN staff p ON p.id = f.primary_contact LEFT JOIN staff s ON s.id = f.secondary_contact
        ORDER BY f.topic`).all());
}));

router.get('/directory', requireCap('view_directory'), h((req, res) => {
    res.json(db.prepare(`SELECT id, email, first, last, display_name, title, room, phone_ext, office_hours, division
                         FROM staff WHERE active = 1 AND role != 'guest' ORDER BY last, first`).all());
}));

// ── Students ─────────────────────────────────────────────────────────────

router.get('/students', requireCap('view_students'), h((req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    res.json(db.prepare(`
        SELECT dcid, student_number, first, last, grade FROM students
        WHERE active = 1 AND (first || ' ' || last LIKE ? OR last || ', ' || first LIKE ? OR student_number LIKE ? OR CAST(dcid AS TEXT) = ?)
        ORDER BY last, first LIMIT 25`).all(like, like, `${q}%`, q));
}));

function servesFor(user, where, args) {
    const rows = db.prepare(`
        SELECT sv.*, st.student_number, st.first, st.last, st.grade, pr.display_name AS person_responsible_name
        FROM serves sv JOIN students st ON st.dcid = sv.student_dcid
        LEFT JOIN staff pr ON pr.id = sv.person_responsible
        WHERE ${where} ORDER BY sv.serve_date DESC, st.last`).all(...args);
    // Basic viewers see scheduled and served serves only, and only whitelisted fields.
    return rows.filter(r => can(user, 'view_serves_full') || ['scheduled', 'served'].includes(r.status))
               .map(r => shapeServe(r, user));
}

router.get('/students/:dcid', requireCap('view_students'), h((req, res) => {
    const u = req.staffUser;
    const student = db.prepare('SELECT * FROM students WHERE dcid = ?').get(req.params.dcid);
    if (!student) throw notFound('Student');
    const sharedSections = db.prepare(`
        SELECT sec.id, sec.course_name, sec.ps_expression, sec.period, sec.room
        FROM sections sec JOIN enrollments e ON e.section_id = sec.id
        WHERE sec.teacher_id = ? AND e.student_dcid = ? AND e.exited_on IS NULL ORDER BY sec.period`).all(u.id, student.dcid)
        .map(s => ({ ...s, period: schedule.periodLabel(s) }));
    const flags = can(u, 'view_flags') ? db.prepare(`
        SELECT f.*, c.display_name AS created_by_name FROM student_flags f LEFT JOIN staff c ON c.id = f.created_by
        WHERE f.student_dcid = ? ORDER BY f.start_date DESC`).all(student.dcid)
        .map(f => ({ ...f, label: schedule.FLAG_LABELS[f.type], expired: !!f.end_date && f.end_date < req.today })) : [];
    const serves = can(u, 'view_serves') ? servesFor(u, 'sv.student_dcid = ?', [student.dcid]) : [];
    const trips = can(u, 'view_trips') ? db.prepare(`
        SELECT t.id, t.title, t.date, t.status FROM field_trips t JOIN trip_attendees a ON a.trip_id = t.id
        WHERE a.student_dcid = ? ORDER BY t.date DESC`).all(student.dcid) : [];
    res.json({ student, sharedSections, flags, serves, trips });
}));

// ── Flags (student lists) ────────────────────────────────────────────────

router.get('/flags', requireCap('view_flags'), h((req, res) => {
    const type = req.query.type;
    if (type && !schedule.FLAG_TYPES.includes(type)) throw bad('Unknown flag type');
    const rows = db.prepare(`
        SELECT f.*, s.student_number, s.first, s.last, s.grade, c.display_name AS created_by_name
        FROM student_flags f JOIN students s ON s.dcid = f.student_dcid LEFT JOIN staff c ON c.id = f.created_by
        WHERE (? IS NULL OR f.type = ?) ORDER BY s.last, s.first`).all(type || null, type || null);
    res.json(rows.map(f => ({ ...f, label: schedule.FLAG_LABELS[f.type], expired: !!f.end_date && f.end_date < req.today })));
}));

// Alert the teachers who still see this student later today.
function queueAlert(req, dcid, what) {
    const targets = schedule.alertTargets(Number(dcid), req.today, req.now);
    const st = db.prepare('SELECT first, last FROM students WHERE dcid = ?').get(dcid);
    for (const t of targets.teachers) {
        console.log(`[staff alert] to ${t.name} (${t.period} at ${time.clock(t.start)}): ${st?.first} ${st?.last} — ${what}`);
    }
    return { count: targets.teachers.length, teachers: targets.teachers, seeingToday: targets.seeingToday, asOf: req.now };
}

router.post('/flags', requireCap('edit_flags'), h((req, res) => {
    const b = req.body;
    if (!schedule.FLAG_TYPES.includes(b.type)) throw bad('Unknown flag type');
    requireStudent(b.student_dcid);
    const start = b.start_date || req.today;
    if (!time.isDate(start) || (b.end_date && !time.isDate(b.end_date))) throw bad('Dates must be YYYY-MM-DD');
    if (b.end_date && b.end_date < start) throw bad('End date is before start date');
    const row = { student_dcid: Number(b.student_dcid), type: b.type, note: b.note ? String(b.note).trim() : null,
                  start_date: start, end_date: b.end_date || null };
    const id = Number(db.prepare(`INSERT INTO student_flags(student_dcid, type, note, start_date, end_date, created_by, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(row.student_dcid, row.type, row.note, row.start_date, row.end_date,
                                  req.staffUser.id, nowIso()).lastInsertRowid);
    audit(req.staffUser.id, 'create', 'flag', id, null, row);
    const coversToday = start <= req.today && (!row.end_date || row.end_date >= req.today);
    res.json({ id, alert: coversToday ? queueAlert(req, row.student_dcid, schedule.FLAG_LABELS[row.type]) : null });
}));

router.post('/flags/:id/end', requireCap('edit_flags'), h((req, res) => {
    const before = db.prepare('SELECT * FROM student_flags WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Flag');
    const end = req.body.end_date || time.addDays(req.today, -1);
    if (!time.isDate(end)) throw bad('end_date must be YYYY-MM-DD');
    db.prepare('UPDATE student_flags SET end_date = ? WHERE id = ?').run(end, before.id);
    audit(req.staffUser.id, 'end', 'flag', before.id, before, { ...before, end_date: end });
    res.json({ ok: true });
}));

// ── Discipline serves ────────────────────────────────────────────────────

const SANCTIONS = ['ISS', 'OSS', 'Detention', 'Lunch detention'];
const SERVE_STATUSES = ['scheduled', 'served', 'missed', 'rescheduled'];

function cleanPeriods(p) {
    if (p === 'ALL' || p === 'LUNCH' || p === 'AFTER') return p;
    const list = (Array.isArray(p) ? p : String(p || '').split(',')).map(x => String(x).trim()).filter(Boolean);
    if (!list.length || list.some(x => !/^[1-7]$/.test(x))) throw bad('periods must be 1–7, ALL, LUNCH or AFTER');
    return [...new Set(list)].sort().join(',');
}

router.get('/serves', requireCap('view_serves'), h((req, res) => {
    const { from, to, status } = req.query;
    const where = ['1 = 1'], args = [];
    if (from && time.isDate(from)) { where.push('COALESCE(sv.serve_end_date, sv.serve_date) >= ?'); args.push(from); }
    if (to && time.isDate(to))     { where.push('sv.serve_date <= ?'); args.push(to); }
    if (status && SERVE_STATUSES.includes(status)) { where.push('sv.status = ?'); args.push(status); }
    res.json(servesFor(req.staffUser, where.join(' AND '), args));
}));

router.post('/serves', requireCap('edit_serves'), h((req, res) => {
    const b = req.body;
    requireStudent(b.student_dcid);
    if (!SANCTIONS.includes(b.sanction)) throw bad(`sanction must be one of ${SANCTIONS.join(', ')}`);
    if (!time.isDate(b.serve_date)) throw bad('serve_date must be YYYY-MM-DD');
    if (b.serve_end_date && (!time.isDate(b.serve_end_date) || b.serve_end_date < b.serve_date)) throw bad('serve_end_date is invalid');
    if (b.incident_date && !time.isDate(b.incident_date)) throw bad('incident_date must be YYYY-MM-DD');
    const row = {
        student_dcid: Number(b.student_dcid), ps_incident_id: b.ps_incident_id || null, infraction_code: b.infraction_code || null,
        incident_date: b.incident_date || null, sanction: b.sanction, serve_date: b.serve_date,
        serve_end_date: b.serve_end_date && b.serve_end_date !== b.serve_date ? b.serve_end_date : null,
        periods: cleanPeriods(b.periods), comments: b.comments || null,
        offense_number: b.offense_number ? Number(b.offense_number) : null,
        sus_letter_sent: b.sus_letter_sent ? 1 : 0, person_responsible: b.person_responsible ? Number(b.person_responsible) : req.staffUser.id,
    };
    const id = Number(db.prepare(`INSERT INTO serves(student_dcid, ps_incident_id, infraction_code, incident_date, sanction, serve_date,
            serve_end_date, periods, status, comments, offense_number, sus_letter_sent, person_responsible, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`).run(
        row.student_dcid, row.ps_incident_id, row.infraction_code, row.incident_date, row.sanction, row.serve_date,
        row.serve_end_date, row.periods, row.comments, row.offense_number, row.sus_letter_sent, row.person_responsible,
        req.staffUser.id, nowIso()).lastInsertRowid);
    audit(req.staffUser.id, 'create', 'serve', id, null, row);
    const coversToday = row.serve_date <= req.today && (row.serve_end_date || row.serve_date) >= req.today;
    res.json({ id, alert: coversToday
        ? queueAlert(req, row.student_dcid, `${row.sanction} (${schedule.formatPeriods(row.periods)})`) : null });
}));

router.post('/serves/:id/status', requireCap('edit_serves'), h((req, res) => {
    const before = db.prepare('SELECT * FROM serves WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Serve');
    const status = req.body.status;
    if (!['served', 'missed', 'scheduled'].includes(status)) throw bad('status must be served, missed or scheduled');
    db.prepare('UPDATE serves SET status = ? WHERE id = ?').run(status, before.id);
    audit(req.staffUser.id, `mark_${status}`, 'serve', before.id, before, { ...before, status });
    res.json({ ok: true });
}));

router.post('/serves/:id/reschedule', requireCap('edit_serves'), h((req, res) => {
    const before = db.prepare('SELECT * FROM serves WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Serve');
    if (!time.isDate(req.body.serve_date)) throw bad('serve_date must be YYYY-MM-DD');
    const periods = req.body.periods ? cleanPeriods(req.body.periods) : before.periods;
    const newId = tx(() => {
        const id = Number(db.prepare(`INSERT INTO serves(student_dcid, ps_incident_id, infraction_code, incident_date, sanction, serve_date,
                periods, status, comments, offense_number, sus_letter_sent, person_responsible, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`).run(
            before.student_dcid, before.ps_incident_id, before.infraction_code, before.incident_date, before.sanction,
            req.body.serve_date, periods, `Rescheduled from ${before.serve_date}.`, before.offense_number,
            before.sus_letter_sent, before.person_responsible, req.staffUser.id, nowIso()).lastInsertRowid);
        db.prepare("UPDATE serves SET status = 'rescheduled', rescheduled_to = ? WHERE id = ?").run(id, before.id);
        return id;
    });
    audit(req.staffUser.id, 'reschedule', 'serve', before.id, before, { rescheduled_to: newId, serve_date: req.body.serve_date, periods });
    res.json({ id: newId });
}));

// ── Field trips ──────────────────────────────────────────────────────────

function tripAttendees(tripId) {
    return db.prepare(`SELECT s.dcid, s.student_number, s.first, s.last, s.grade FROM trip_attendees a
                       JOIN students s ON s.dcid = a.student_dcid WHERE a.trip_id = ? ORDER BY s.last, s.first`).all(tripId);
}

function pendingRevision(tripId) {
    const r = db.prepare("SELECT * FROM trip_revisions WHERE trip_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(tripId);
    return r ? { ...r, snapshot: JSON.parse(r.snapshot_json) } : null;
}

router.get('/trips', requireCap('view_trips'), h((req, res) => {
    res.json(db.prepare(`
        SELECT t.*, s.display_name AS submitted_by_name, r.display_name AS reviewed_by_name,
               (SELECT COUNT(*) FROM trip_attendees a WHERE a.trip_id = t.id) AS attendee_count
        FROM field_trips t LEFT JOIN staff s ON s.id = t.submitted_by LEFT JOIN staff r ON r.id = t.reviewed_by
        ORDER BY t.date DESC`).all());
}));

router.get('/trips/:id', requireCap('view_trips'), h((req, res) => {
    const trip = db.prepare(`SELECT t.*, s.display_name AS submitted_by_name FROM field_trips t
                             LEFT JOIN staff s ON s.id = t.submitted_by WHERE t.id = ?`).get(req.params.id);
    if (!trip) throw notFound('Trip');
    const rev = pendingRevision(trip.id);
    let revision = null;
    if (rev) {
        const ph = rev.snapshot.attendees.map(() => '?').join(',') || 'NULL';
        revision = { ...rev, submitted_by_name: staffName(rev.submitted_by),
            attendees: db.prepare(`SELECT dcid, student_number, first, last, grade FROM students WHERE dcid IN (${ph}) ORDER BY last, first`)
                .all(...rev.snapshot.attendees) };
    }
    res.json({ trip, attendees: tripAttendees(trip.id), revision });
}));

function tripInput(b) {
    if (!b.title || !time.isDate(b.date)) throw bad('title and date are required');
    for (const k of ['depart_time', 'return_time']) if (b[k] && !time.isTime(b[k])) throw bad(`${k} must be HH:MM`);
    if (b.depart_time && b.return_time && b.return_time <= b.depart_time) throw bad('return_time must be after depart_time');
    const attendees = [...new Set((b.attendees || []).map(Number))];
    if (!attendees.length) throw bad('Add at least one student');
    const known = db.prepare(`SELECT COUNT(*) n FROM students WHERE dcid IN (${attendees.map(() => '?').join(',')})`).get(...attendees).n;
    if (known !== attendees.length) throw bad('Unknown student in attendees');
    return { title: String(b.title).trim(), date: b.date, depart_time: b.depart_time || null, return_time: b.return_time || null,
             destination: b.destination || null, info: b.info || null, attendees };
}

function setAttendees(tripId, dcids) {
    db.prepare('DELETE FROM trip_attendees WHERE trip_id = ?').run(tripId);
    const ins = db.prepare('INSERT INTO trip_attendees(trip_id, student_dcid) VALUES (?, ?)');
    for (const d of dcids) ins.run(tripId, d);
}

router.post('/trips', requireCap('submit_trips'), h((req, res) => {
    const t = tripInput(req.body);
    const id = tx(() => {
        const id = Number(db.prepare(`INSERT INTO field_trips(title, date, depart_time, return_time, destination, info, submitted_by, status)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`).run(
            t.title, t.date, t.depart_time, t.return_time, t.destination, t.info, req.staffUser.id).lastInsertRowid);
        setAttendees(id, t.attendees);
        return id;
    });
    audit(req.staffUser.id, 'create', 'trip', id, null, t);
    res.json({ id });
}));

// Pending/rejected trips are edited in place. Approved trips get a revision
// that needs re-approval; the approved version stays live until then.
router.put('/trips/:id', requireCap('submit_trips'), h((req, res) => {
    const before = db.prepare('SELECT * FROM field_trips WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Trip');
    if (before.submitted_by !== req.staffUser.id && !can(req.staffUser, 'approve_trips')) throw forbidden('Only the submitter or an approver can edit this trip');
    const t = tripInput(req.body);
    const beforeFull = { ...before, attendees: tripAttendees(before.id).map(s => s.dcid) };

    if (before.status === 'approved' || before.status === 'changes_pending') {
        tx(() => {
            db.prepare("UPDATE trip_revisions SET status = 'superseded' WHERE trip_id = ? AND status = 'pending'").run(before.id);
            db.prepare(`INSERT INTO trip_revisions(trip_id, snapshot_json, submitted_by, submitted_at, status) VALUES (?, ?, ?, ?, 'pending')`)
                .run(before.id, JSON.stringify(t), req.staffUser.id, nowIso());
            db.prepare("UPDATE field_trips SET status = 'changes_pending' WHERE id = ?").run(before.id);
        });
        audit(req.staffUser.id, 'revise', 'trip', before.id, beforeFull, t);
        return res.json({ ok: true, status: 'changes_pending' });
    }
    tx(() => {
        db.prepare(`UPDATE field_trips SET title = ?, date = ?, depart_time = ?, return_time = ?, destination = ?, info = ?,
                    status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`)
            .run(t.title, t.date, t.depart_time, t.return_time, t.destination, t.info, before.id);
        setAttendees(before.id, t.attendees);
    });
    audit(req.staffUser.id, 'update', 'trip', before.id, beforeFull, t);
    res.json({ ok: true, status: 'pending' });
}));

router.post('/trips/:id/:decision(approve|reject)', requireCap('approve_trips'), h((req, res) => {
    const before = db.prepare('SELECT * FROM field_trips WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('Trip');
    const approve = req.params.decision === 'approve';
    const stamp = nowIso();

    if (before.status === 'changes_pending') {
        const rev = pendingRevision(before.id);
        if (!rev) throw bad('No pending revision');
        tx(() => {
            if (approve) {
                const t = rev.snapshot;
                db.prepare(`UPDATE field_trips SET title = ?, date = ?, depart_time = ?, return_time = ?, destination = ?, info = ? WHERE id = ?`)
                    .run(t.title, t.date, t.depart_time, t.return_time, t.destination, t.info, before.id);
                setAttendees(before.id, t.attendees);
            }
            db.prepare('UPDATE trip_revisions SET status = ? WHERE id = ?').run(approve ? 'approved' : 'rejected', rev.id);
            db.prepare("UPDATE field_trips SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(req.staffUser.id, stamp, before.id);
        });
        audit(req.staffUser.id, approve ? 'approve_revision' : 'reject_revision', 'trip', before.id, before, rev.snapshot);
        return res.json({ ok: true, status: 'approved' });
    }
    if (before.status !== 'pending') throw bad(`Trip is ${before.status}`);
    const status = approve ? 'approved' : 'rejected';
    db.prepare('UPDATE field_trips SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(status, req.staffUser.id, stamp, before.id);
    audit(req.staffUser.id, status === 'approved' ? 'approve' : 'reject', 'trip', before.id, before, { ...before, status });
    res.json({ ok: true, status });
}));

// ── Sections ─────────────────────────────────────────────────────────────

router.get('/sections', requireCap('view_today'), h((req, res) => {
    const all = can(req.staffUser, 'approve_trips') && req.query.all === '1';
    const rows = db.prepare(`
        SELECT sec.*, st.display_name AS teacher_name,
               (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.id AND e.exited_on IS NULL) AS student_count
        FROM sections sec JOIN staff st ON st.id = sec.teacher_id
        WHERE (? = 1 OR sec.teacher_id = ?) ORDER BY st.last, sec.period`).all(all ? 1 : 0, req.staffUser.id);
    res.json(rows.map(s => ({ ...s, period: schedule.periodLabel(s) })));
}));

router.get('/sections/:id/students', requireCap('view_students'), h((req, res) => {
    res.json(schedule.rosterFor(req.params.id, req.today));
}));

// ── Schedule ─────────────────────────────────────────────────────────────

router.get('/templates', requireCap('view_schedule'), h((req, res) => {
    res.json(db.prepare('SELECT id, name, division, kind FROM bell_templates ORDER BY division, id').all()
        .map(t => ({ ...t, slots: schedule.slotsFor(t.id) })));
}));

router.get('/day-plans', requireCap('view_schedule'), h((req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : req.today.slice(0, 7);
    const division = req.query.division === 'MS' ? 'MS' : 'HS';
    const days = [];
    for (let d = `${month}-01`; d.startsWith(month); d = time.addDays(d, 1)) {
        const p = schedule.getDayPlan(d, division);
        days.push({ date: d, isSchoolDay: p.isSchoolDay, dayType: p.dayType, note: p.note,
                    template: p.template, weekday: time.isWeekday(d) });
    }
    res.json({ month, division, days });
}));

router.put('/day-plans/:date/:division(HS|MS)', requireCap('edit_day_plans'), h((req, res) => {
    const { date, division } = req.params;
    if (!time.isDate(date)) throw bad('Bad date');
    const before = db.prepare('SELECT * FROM day_plans WHERE date = ? AND division = ?').get(date, division) || null;
    const isSchoolDay = req.body.is_school_day === false || req.body.is_school_day === 0 ? 0 : 1;
    let templateId = null, map = null;
    if (isSchoolDay) {
        const tpl = schedule.templateById(req.body.template_id);
        if (!tpl || tpl.division !== division) throw bad('Pick a template for this division');
        templateId = tpl.id;
        map = JSON.stringify(schedule.defaultSlotMap(tpl, date));
    }
    const note = req.body.note ? String(req.body.note).trim() : null;
    db.prepare(`INSERT INTO day_plans(date, division, template_id, slot_map_json, note, is_school_day) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(date, division) DO UPDATE SET template_id = excluded.template_id, slot_map_json = excluded.slot_map_json,
                note = excluded.note, is_school_day = excluded.is_school_day`).run(date, division, templateId, map, note, isSchoolDay);
    const after = db.prepare('SELECT * FROM day_plans WHERE date = ? AND division = ?').get(date, division);
    audit(req.staffUser.id, before ? 'update' : 'create', 'day_plan', `${date}/${division}`, before, after);
    res.json({ ok: true, plan: schedule.getDayPlan(date, division) });
}));

router.get('/duties', requireCap('view_schedule'), h((req, res) => {
    const weekType = req.query.week_type || '5-day';
    const slots = db.prepare('SELECT * FROM duty_slots WHERE week_type = ? ORDER BY start_time, name').all(weekType);
    const who = db.prepare(`SELECT st.id, st.display_name FROM duty_assignments a JOIN staff st ON st.id = a.staff_id
                            WHERE a.duty_slot_id = ? ORDER BY st.last`);
    res.json({ weekType, slots: slots.map(s => ({ ...s, staff: who.all(s.id) })) });
}));

// ── Memo ─────────────────────────────────────────────────────────────────

router.get('/memo', requireCap('view_memo'), h((req, res) => {
    res.json({ date: req.today, ...buildMemo(req.staffUser.id, req.today) });
}));

router.post('/memo/send-test', requireCap('view_memo'), h(async (req, res) => {
    const memo = buildMemo(req.staffUser.id, req.today);
    const result = await sendMail(memo);
    res.json({ ok: true, to: memo.to, transport: result.transport });
}));

// ── Imports, users, audit ────────────────────────────────────────────────

router.get('/import/sample/:type', requireCap('import'), h((req, res) => {
    const csv = imports.sampleCsv(req.params.type);
    if (!csv) throw notFound('Import type');
    res.type('text/csv').attachment(`staffhub-${req.params.type}-sample.csv`).send(csv);
}));

router.post('/import/:type/preview', requireCap('import'), h((req, res) => {
    res.json(imports.diff(req.params.type, req.body.csv || ''));
}));

router.post('/import/:type/commit', requireCap('import'), h((req, res) => {
    res.json(imports.commit(req.params.type, req.body.csv || '', req.staffUser.id));
}));

router.get('/users', requireCap('manage_users'), h((req, res) => {
    res.json({ roles: ROLE_NAMES.map(r => ({ role: r, label: ROLES[r].label })),
               users: db.prepare('SELECT id, email, display_name, role, division, active FROM staff ORDER BY active DESC, last, first').all() });
}));

router.put('/users/:id', requireCap('manage_users'), h((req, res) => {
    const before = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
    if (!before) throw notFound('User');
    const role = req.body.role ?? before.role;
    if (!ROLE_NAMES.includes(role)) throw bad('Unknown role');
    const active = req.body.active === undefined ? before.active : (req.body.active ? 1 : 0);
    if (before.id === req.staffUser.id && (role !== before.role || !active)) throw bad("You can't change your own role or deactivate yourself");
    db.prepare('UPDATE staff SET role = ?, active = ? WHERE id = ?').run(role, active, before.id);
    audit(req.staffUser.id, 'update', 'user', before.id, { role: before.role, active: before.active }, { role, active });
    rebuildSearch();
    res.json({ ok: true });
}));

router.get('/audit', requireCap('view_audit'), h((req, res) => {
    const { entity, action, user_id, from, to } = req.query;
    const where = ['1 = 1'], args = [];
    if (entity)  { where.push('a.entity = ?');  args.push(entity); }
    if (action)  { where.push('a.action = ?');  args.push(action); }
    if (user_id) { where.push('a.user_id = ?'); args.push(Number(user_id)); }
    if (from && time.isDate(from)) { where.push('a.at >= ?'); args.push(from); }
    if (to && time.isDate(to))     { where.push('a.at < ?');  args.push(time.addDays(to, 1)); }
    res.json({
        rows: db.prepare(`SELECT a.*, s.display_name AS user_name FROM audit_log a LEFT JOIN staff s ON s.id = a.user_id
                          WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 500`).all(...args),
        entities: db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').all().map(r => r.entity),
        actions:  db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map(r => r.action),
    });
}));

// ── Integration stubs ────────────────────────────────────────────────────

// Contract for the DobbsCore extension: one section plus its current roster.
// Students missing from the payload are exited from the section.
router.post('/sync/roster', h((req, res) => {
    const u = req.staffUser;
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    if (!can(u, 'sync_roster') && !can(u, 'sync_own_roster')) throw forbidden('Requires sync_own_roster');
    const { section, students } = req.body || {};
    if (!section?.ps_expression || !section?.course_name || !Array.isArray(students)) throw bad('section {ps_expression, course_name, room, period} and students[] required');
    const teacherId = can(u, 'sync_roster') && req.body.teacher_id ? Number(req.body.teacher_id) : u.id;
    const teacher = db.prepare('SELECT * FROM staff WHERE id = ?').get(teacherId);
    if (!teacher) throw bad('Unknown teacher');
    for (const s of students) if (!s.dcid || !s.student_number || !s.first || !s.last) throw bad('Each student needs dcid, student_number, first, last');

    const result = tx(() => {
        let sec = db.prepare("SELECT * FROM sections WHERE teacher_id = ? AND ps_expression = ? AND term = '26-27'").get(teacherId, section.ps_expression);
        const period = String(section.period ?? (/(\d)/.exec(section.ps_expression)?.[1] || section.ps_expression));
        if (sec) {
            db.prepare('UPDATE sections SET course_name = ?, room = ?, period = ? WHERE id = ?').run(section.course_name, section.room || sec.room, period, sec.id);
        } else {
            const id = Number(db.prepare(`INSERT INTO sections(teacher_id, course_name, ps_expression, period, division, room, term)
                VALUES (?, ?, ?, ?, ?, ?, '26-27')`).run(teacherId, section.course_name, section.ps_expression, period,
                teacher.division === 'MS' ? 'MS' : 'HS', section.room || teacher.room).lastInsertRowid);
            sec = { id };
        }
        const upStu = db.prepare(`INSERT INTO students(dcid, student_number, first, last, grade, active) VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(dcid) DO UPDATE SET student_number = excluded.student_number, first = excluded.first, last = excluded.last,
            grade = excluded.grade, active = 1`);
        const enroll = db.prepare(`INSERT INTO enrollments(section_id, student_dcid, enrolled_on) VALUES (?, ?, ?)
            ON CONFLICT(section_id, student_dcid) DO UPDATE SET exited_on = NULL`);
        for (const s of students) {
            upStu.run(Number(s.dcid), String(s.student_number), s.first, s.last, Number(s.grade) || 0);
            enroll.run(sec.id, Number(s.dcid), req.today);
        }
        const keep = students.map(s => Number(s.dcid));
        const exited = db.prepare(`UPDATE enrollments SET exited_on = ? WHERE section_id = ? AND exited_on IS NULL
            AND student_dcid NOT IN (${keep.map(() => '?').join(',') || 'NULL'})`).run(req.today, sec.id, ...keep).changes;
        return { section_id: sec.id, students: students.length, exited };
    });
    audit(u.id, 'sync', 'roster', result.section_id, null, { section, count: students.length, exited: result.exited });
    rebuildSearch();
    res.json(result);
}));

module.exports = router;
