// Teacher authentication, shared by the teacher and WBL routers.
//
// Extracted verbatim from routes/teacher.js so that more than one router can
// gate on it without each keeping its own token cache — two caches would
// double the tokeninfo calls and expire independently.

const { db } = require('./db');

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

    // Check persistent session tokens first — no network call needed
    const session = db.prepare('SELECT user_key FROM teacher_sessions WHERE token = ?').get(token);
    if (session) {
        db.prepare('UPDATE teacher_sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
        req.teacherKey = session.user_key;
        return next();
    }

    // Fall back to verifying a raw Google access token
    const identity = await verifyTeacherToken(token);
    if (!identity) return res.status(403).json({ error: 'Not authorized as teacher' });
    req.teacherKey = identity.teacherKey;
    next();
}

module.exports = { requireTeacher, verifyTeacherToken };
