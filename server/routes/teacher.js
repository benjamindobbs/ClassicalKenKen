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
