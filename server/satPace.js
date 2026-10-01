const { db } = require('./db');

// Anti-spam pacing for SAT English / SAT Math. /next stamps when a question
// was served; /score discards any answer that arrives sooner than
// MIN_ANSWER_MS after that. A discarded answer is never written to
// sat_scores / sat_math_scores, so it doesn't count toward the daily
// requirement, the adaptive engine or any chart. The client answers a
// flagged response with a lockout on the next question (js/satpace.js).
//
// No stamp (a tab opened before this shipped, or a second submit for the
// same question) is let through. Only the normal click-through flow is
// policed, and an honest student never loses an answer to a missing row.
const MIN_ANSWER_MS = 10000;

function markServed(userKey, subject) {
    db.prepare(`
        INSERT INTO sat_serves(user_key, subject, served_at) VALUES(?, ?, ?)
        ON CONFLICT(user_key, subject) DO UPDATE SET served_at = excluded.served_at
    `).run(userKey, subject, Date.now());
}

// True when this answer came in too fast and must be discarded. Consumes the
// stamp either way, so each served question is judged once.
function answeredTooFast(userKey, subject) {
    const row = db.prepare('SELECT served_at FROM sat_serves WHERE user_key = ? AND subject = ?')
        .get(userKey, subject);
    if (!row) return false;
    db.prepare('DELETE FROM sat_serves WHERE user_key = ? AND subject = ?').run(userKey, subject);
    return Date.now() - row.served_at < MIN_ANSWER_MS;
}

module.exports = { MIN_ANSWER_MS, markServed, answeredTooFast };
