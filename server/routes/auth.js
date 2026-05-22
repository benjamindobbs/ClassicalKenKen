const { Router } = require('express');
const { db, upsertUser } = require('../db');
const { randomUUID } = require('crypto');

const router = Router();
const ALLOWED_DOMAINS = ['hartfordschools.org', 'students.hartfordschools.org'];

router.post('/login', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    try {
        const r = await fetch(
            `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`
        );
        if (!r.ok) return res.status(403).json({ error: 'Invalid token' });
        const data = await r.json();
        if (!data.email || data.error) return res.status(403).json({ error: 'Invalid token' });
        const domain = data.email.split('@')[1];
        if (!ALLOWED_DOMAINS.includes(domain)) return res.status(403).json({ error: 'Unauthorized domain' });
        const userKey = data.email.split('@')[0];
        upsertUser(userKey, data.email);
        const sessionToken = randomUUID();
        db.prepare('INSERT INTO sessions(token, user_key, created_at, last_seen) VALUES(?, ?, ?, ?)')
          .run(sessionToken, userKey, Date.now(), Date.now());
        res.json({ sessionToken });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/me', (req, res) => {
    if (process.env.DEV_USER) return res.json({ userKey: process.env.DEV_USER });
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const session = db.prepare('SELECT user_key FROM sessions WHERE token = ?').get(token);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
    res.json({ userKey: session.user_key });
});

module.exports = router;
