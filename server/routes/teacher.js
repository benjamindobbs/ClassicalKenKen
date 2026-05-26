const { Router } = require('express');
const { db } = require('../db');

const router = Router();

const teacherTokenCache = new Map();

async function verifyTeacherToken(token) {
    const cached = teacherTokenCache.get(token);
    if (cached && cached.exp * 1000 > Date.now()) return cached;

    const res = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.email || data.error) return null;

    const domain = data.email.split('@')[1];
    // Explicitly exclude student subdomain
    if (domain !== 'hartfordschools.org') return null;

    const teacherKey = data.email.split('@')[0];
    const entry = {
        teacherKey,
        email: data.email,
        exp: data.expires_in
            ? Math.floor(Date.now() / 1000) + parseInt(data.expires_in)
            : Math.floor(Date.now() / 1000) + 3600,
    };

    teacherTokenCache.set(token, entry);
    if (teacherTokenCache.size > 200) {
        const now = Date.now();
        for (const [k, v] of teacherTokenCache) {
            if (v.exp * 1000 <= now) teacherTokenCache.delete(k);
        }
    }

    return entry;
}

async function requireTeacher(req, res, next) {
    if (process.env.DEV_TEACHER) {
        req.teacherKey = process.env.DEV_TEACHER;
        return next();
    }
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const identity = await verifyTeacherToken(token);
    if (!identity) return res.status(403).json({ error: 'Not authorized as teacher' });
    req.teacherKey = identity.teacherKey;
    next();
}

router.get('/check', requireTeacher, (req, res) => res.json({ ok: true, teacherKey: req.teacherKey }));

// ── Teacher profile ───────────────────────────────────────────────────────────
router.get('/profile', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT name FROM teacher_profile WHERE teacher_key = ?').get(req.teacherKey);
    res.json({ name: row ? row.name : '' });
});

router.post('/profile', requireTeacher, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    db.prepare('INSERT OR REPLACE INTO teacher_profile(teacher_key, name) VALUES(?, ?)').run(req.teacherKey, name.trim());
    res.json({ ok: true });
});

// ── Gradebook settings ────────────────────────────────────────────────────────
router.get('/gradebook-settings', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT * FROM gradebook_settings WHERE teacher_key = ?').get(req.teacherKey);
    res.json(row ?? { assignment_max_score: 100, completion_score_pct: 100, no_submission_score_pct: 0 });
});

router.post('/gradebook-settings', requireTeacher, (req, res) => {
    const { assignment_max_score, completion_score_pct, no_submission_score_pct } = req.body;
    if ([assignment_max_score, completion_score_pct, no_submission_score_pct].some(v => v == null || isNaN(Number(v))))
        return res.status(400).json({ error: 'All three fields are required and must be numbers' });
    db.prepare(`
        INSERT OR REPLACE INTO gradebook_settings(teacher_key, assignment_max_score, completion_score_pct, no_submission_score_pct)
        VALUES(?, ?, ?, ?)
    `).run(req.teacherKey, Number(assignment_max_score), Number(completion_score_pct), Number(no_submission_score_pct));
    res.json({ ok: true });
});

// ── Assignment settings ───────────────────────────────────────────────────────
const VALID_ACTIVITIES = new Set(['kenken', 'sat', 'both', 'either']);

router.get('/assignment-settings', requireTeacher, (req, res) => {
    const row = db.prepare('SELECT * FROM assignment_settings WHERE teacher_key = ?').get(req.teacherKey);
    res.json(row ?? { required_activity: 'either', required_kenken_count: 1, required_sat_count: 1 });
});

router.post('/assignment-settings', requireTeacher, (req, res) => {
    const { required_activity, required_kenken_count, required_sat_count } = req.body;
    if (!VALID_ACTIVITIES.has(required_activity))
        return res.status(400).json({ error: 'invalid required_activity' });
    db.prepare(`
        INSERT OR REPLACE INTO assignment_settings(teacher_key, required_activity, required_kenken_count, required_sat_count)
        VALUES(?, ?, ?, ?)
    `).run(req.teacherKey, required_activity, Number(required_kenken_count) || 1, Number(required_sat_count) || 1);
    res.json({ ok: true });
});

// ── Classes ───────────────────────────────────────────────────────────────────
router.get('/classes', requireTeacher, (req, res) => {
    const rows = db.prepare(`
        SELECT c.id, c.name, c.created_at,
               COUNT(cs.id)       AS student_count,
               COUNT(cs.user_key) AS linked_count
        FROM classes c
        LEFT JOIN class_students cs ON cs.class_id = c.id
        WHERE c.teacher_key = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `).all(req.teacherKey);
    res.json(rows);
});

router.post('/classes', requireTeacher, (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    const result = db.prepare(
        'INSERT INTO classes(teacher_key, name, created_at) VALUES(?, ?, ?)'
    ).run(req.teacherKey, name.trim(), Date.now());
    res.json({ id: result.lastInsertRowid, name: name.trim(), student_count: 0, linked_count: 0 });
});

router.delete('/classes/:id', requireTeacher, (req, res) => {
    db.prepare('DELETE FROM classes WHERE id = ? AND teacher_key = ?').run(Number(req.params.id), req.teacherKey);
    res.json({ ok: true });
});

router.get('/classes/:id', requireTeacher, (req, res) => {
    const cls = db.prepare(
        'SELECT * FROM classes WHERE id = ? AND teacher_key = ?'
    ).get(Number(req.params.id), req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    const students = db.prepare(
        'SELECT * FROM class_students WHERE class_id = ? ORDER BY student_name'
    ).all(Number(req.params.id));
    res.json({ ...cls, students });
});

router.post('/classes/:id/students', requireTeacher, (req, res) => {
    const classId = Number(req.params.id);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
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

router.patch('/classes/:classId/students/:studentId', requireTeacher, (req, res) => {
    const classId = Number(req.params.classId);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    const { user_key } = req.body;
    db.prepare('UPDATE class_students SET user_key = ? WHERE class_id = ? AND student_id = ?')
        .run(user_key || null, classId, req.params.studentId);
    res.json({ ok: true });
});

router.delete('/classes/:classId/students/:studentId', requireTeacher, (req, res) => {
    const classId = Number(req.params.classId);
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND teacher_key = ?').get(classId, req.teacherKey);
    if (!cls) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?')
        .run(classId, req.params.studentId);
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
