const { db, upsertUser } = require('./db');

const ALLOWED_DOMAINS = ['hartfordschools.org', 'students.hartfordschools.org'];

// Cache verified tokens: token → { userKey, email, exp }
const tokenCache = new Map();

async function verifyToken(token) {
    const cached = tokenCache.get(token);
    if (cached && cached.exp * 1000 > Date.now()) return cached;

    const res = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.email || data.error) return null;

    const domain = data.email.split('@')[1];
    if (!ALLOWED_DOMAINS.includes(domain)) return null;

    const userKey = data.email.split('@')[0];
    const entry = { userKey, email: data.email, exp: data.expires_in
        ? Math.floor(Date.now() / 1000) + parseInt(data.expires_in)
        : Math.floor(Date.now() / 1000) + 3600
    };

    tokenCache.set(token, entry);
    // Clean up expired entries periodically
    if (tokenCache.size > 500) {
        const now = Date.now();
        for (const [k, v] of tokenCache) {
            if (v.exp * 1000 <= now) tokenCache.delete(k);
        }
    }

    return entry;
}

async function requireAuth(req, res, next) {
    if (process.env.DEV_USER) {
        upsertUser(process.env.DEV_USER, `${process.env.DEV_USER}@hartfordschools.org`);
        req.userKey = process.env.DEV_USER;
        return next();
    }

    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    // Check our own session tokens first (fast, no network call)
    const session = db.prepare('SELECT user_key FROM sessions WHERE token = ?').get(token);
    if (session) {
        db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now(), token);
        req.userKey = session.user_key;
        return next();
    }

    // Fall back to verifying as a raw Google access token
    const identity = await verifyToken(token);
    if (!identity) return res.status(403).json({ error: 'Invalid or unauthorized token' });

    upsertUser(identity.userKey, identity.email);
    req.userKey = identity.userKey;
    next();
}

module.exports = { requireAuth };
