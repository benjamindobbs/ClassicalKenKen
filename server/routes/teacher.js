const { Router } = require('express');
const { db } = require('../db');
const { randomUUID } = require('crypto');

const router = Router();
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'w3re_it_s0_ez';
const teacherSessions = new Map();

function getCookie(req, name) {
    for (const part of (req.headers.cookie || '').split(';')) {
        const [k, v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v || '');
    }
    return null;
}

function requireTeacher(req, res, next) {
    if (process.env.DEV_USER) return next();
    const token = getCookie(req, 'classtech_teacher');
    if (!token || !teacherSessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

router.post('/login', (req, res) => {
    if (req.body.password !== TEACHER_PASSWORD) {
        return res.status(403).json({ error: 'Wrong password' });
    }
    const token = randomUUID();
    teacherSessions.set(token, Date.now());
    res.setHeader('Set-Cookie',
        `classtech_teacher=${token}; Max-Age=${30 * 24 * 60 * 60}; Path=/; SameSite=Strict; HttpOnly`
    );
    res.json({ ok: true });
});

router.get('/check', requireTeacher, (_req, res) => res.json({ ok: true }));

// ── Teacher profile ───────────────────────────────────────────────────────────
router.get('/profile', requireTeacher, (_req, res) => {
    const row = db.prepare('SELECT name FROM teacher_profile WHERE id = 1').get();
    res.json({ name: row ? row.name : '' });
});

router.post('/profile', requireTeacher, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    db.prepare('INSERT OR REPLACE INTO teacher_profile(id, name) VALUES(1, ?)').run(name.trim());
    res.json({ ok: true });
});

// ── Gradebook settings ────────────────────────────────────────────────────────
router.get('/gradebook-settings', requireTeacher, (_req, res) => {
    const row = db.prepare('SELECT * FROM gradebook_settings WHERE id = 1').get();
    res.json(row ?? { assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0 });
});

router.post('/gradebook-settings', requireTeacher, (req, res) => {
    const { assignment_max_score, completion_score_pct, no_submission_score_pct } = req.body;
    if ([assignment_max_score, completion_score_pct, no_submission_score_pct].some(v => v == null || isNaN(Number(v))))
        return res.status(400).json({ error: 'All three fields are required and must be numbers' });
    db.prepare(`
        INSERT OR REPLACE INTO gradebook_settings(id, assignment_max_score, completion_score_pct, no_submission_score_pct)
        VALUES(1, ?, ?, ?)
    `).run(Number(assignment_max_score), Number(completion_score_pct), Number(no_submission_score_pct));
    res.json({ ok: true });
});

// ── Assignment settings ───────────────────────────────────────────────────────
const VALID_ACTIVITIES = new Set(['kenken', 'sat', 'both', 'either']);

router.get('/assignment-settings', requireTeacher, (_req, res) => {
    const row = db.prepare('SELECT * FROM assignment_settings WHERE id = 1').get();
    res.json(row ?? { required_activity: 'either', required_kenken_count: 1, required_sat_count: 1, required_either_count: 1 });
});

router.post('/assignment-settings', requireTeacher, (req, res) => {
    const { required_activity, required_kenken_count, required_sat_count, required_either_count } = req.body;
    if (!VALID_ACTIVITIES.has(required_activity))
        return res.status(400).json({ error: 'invalid required_activity' });
    db.prepare(`
        INSERT OR REPLACE INTO assignment_settings
            (id, required_activity, required_kenken_count, required_sat_count, required_either_count)
        VALUES (1, ?, ?, ?, ?)
    `).run(required_activity, Number(required_kenken_count) || 1, Number(required_sat_count) || 1, Number(required_either_count) || 1);
    res.json({ ok: true });
});

// ── Classes ───────────────────────────────────────────────────────────────────
router.get('/classes', requireTeacher, (_req, res) => {
    const rows = db.prepare(`
        SELECT c.id, c.name, c.created_at,
               COUNT(cs.id)       AS student_count,
               COUNT(cs.user_key) AS linked_count
        FROM classes c
        LEFT JOIN class_students cs ON cs.class_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `).all();
    res.json(rows);
});

router.post('/classes', requireTeacher, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    const result = db.prepare('INSERT INTO classes(name, created_at) VALUES(?, ?)').run(name.trim(), Date.now());
    res.json({ id: result.lastInsertRowid, name: name.trim(), student_count: 0, linked_count: 0 });
});

router.delete('/classes/:id', requireTeacher, (req, res) => {
    db.prepare('DELETE FROM classes WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
});

router.get('/classes/:id', requireTeacher, (req, res) => {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(req.params.id));
    if (!cls) return res.status(404).json({ error: 'Not found' });
    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(Number(req.params.id));
    res.json({ ...cls, students });
});

// Bulk-import students from parsed CSV  { students: [{student_id, student_name}] }
router.post('/classes/:id/students', requireTeacher, (req, res) => {
    const classId = Number(req.params.id);
    const { students } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'students array required' });
    const insert = db.prepare(
        'INSERT OR IGNORE INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)'
    );
    let added = 0;
    for (const s of students) {
        if (!s.student_id || !s.student_name) continue;
        const r = insert.run(classId, String(s.student_id).trim(), String(s.student_name).trim());
        added += r.changes;
    }
    res.json({ added });
});

// Link or unlink a student to an app user_key  { user_key: "..." | null }
router.patch('/classes/:classId/students/:studentId', requireTeacher, (req, res) => {
    const { user_key } = req.body;
    db.prepare('UPDATE class_students SET user_key = ? WHERE class_id = ? AND student_id = ?')
        .run(user_key || null, Number(req.params.classId), req.params.studentId);
    res.json({ ok: true });
});

router.delete('/classes/:classId/students/:studentId', requireTeacher, (req, res) => {
    db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?')
        .run(Number(req.params.classId), req.params.studentId);
    res.json({ ok: true });
});

// ── All data ──────────────────────────────────────────────────────────────────
router.get('/data', requireTeacher, (_req, res) => {
    const users  = db.prepare('SELECT * FROM users ORDER BY user_key').all();
    const kenken = db.prepare(
        'SELECT ks.*, u.email FROM kenken_scores ks JOIN users u ON ks.user_key = u.user_key ORDER BY ks.submitted_at DESC'
    ).all();
    const sat = db.prepare(
        'SELECT ss.*, u.email FROM sat_scores ss JOIN users u ON ss.user_key = u.user_key ORDER BY ss.submitted_at DESC'
    ).all();
    res.json({ users, kenken, sat });
});

module.exports = router;
