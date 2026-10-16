// Who is asking, and what "today" and "now" mean for this request.

const { db }   = require('./db');
const time     = require('./time');

const PROD_APP = 'classicalkenken';

// Demo mode skips Google sign-in, so it must never switch on in production.
function isDemo() {
    if (process.env.STAFF_DEMO !== '1') return false;
    return process.env.FLY_APP_NAME !== PROD_APP;
}

if (process.env.STAFF_DEMO === '1' && !isDemo()) {
    console.error(`staff: STAFF_DEMO ignored on ${PROD_APP}; demo mode is not allowed in production`);
}

function staffById(id) {
    return db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(id) || null;
}

// The seam for real auth. In demo mode the role switcher sends the chosen
// seeded user's id. Later: verify the Google token, look the email up in
// `staff` (the allowlist) and return that row, or null.
function getCurrentUser(req) {
    if (isDemo()) {
        const id = parseInt(req.get('X-Staff-User'), 10);
        return Number.isInteger(id) ? staffById(id) : null;
    }
    return null;
}

// Demo-only overrides so the demo works on any day and at any time.
function getToday(req) {
    if (isDemo()) {
        const d = req.query.date || req.get('X-Staff-Date');
        if (time.isDate(d)) return d;
    }
    return time.localDate();
}

function getNow(req) {
    if (isDemo()) {
        const t = req.query.time || req.get('X-Staff-Time');
        if (time.isTime(t)) return t;
    }
    return time.localTime();
}

function attachUser(req, _res, next) {
    req.staffUser = getCurrentUser(req);
    req.today = getToday(req);
    req.now = getNow(req);
    next();
}

module.exports = { isDemo, getCurrentUser, getToday, getNow, attachUser, staffById };
