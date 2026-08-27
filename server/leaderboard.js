const { db } = require('./db');

// Render a roster name as "First L." — the full last name is never sent to a
// student-facing client. Handles both "Last, First" (PowerSchool export) and
// "First Last".
function firstNameLastInitial(raw) {
    const s = String(raw || '').trim();
    if (!s) return '—';
    if (s.includes(',')) {
        const [last, rest] = s.split(',');
        const first = (rest || '').trim().split(/\s+/)[0] || '';
        const li    = last.trim().charAt(0);
        return li ? `${first} ${li}.`.trim() : first;
    }
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0];
    const li = parts[parts.length - 1].charAt(0);
    return li ? `${parts[0]} ${li}.` : parts[0];
}

// Top `limit` average KenKen scores among students actively enrolled in a
// class (a class_students row with a linked account). One row per student even
// if they sit on several rosters.
function kenkenLeaderboard(limit = 10) {
    return db.prepare(`
        SELECT k.user_key,
               AVG(k.score) AS avg_score,
               COUNT(*)     AS games,
               (SELECT student_name FROM class_students cs
                 WHERE cs.user_key = k.user_key
                 ORDER BY cs.id LIMIT 1) AS student_name
        FROM kenken_scores k
        WHERE k.user_key IN (SELECT user_key FROM class_students WHERE user_key IS NOT NULL)
        GROUP BY k.user_key
        ORDER BY avg_score DESC
        LIMIT ?
    `).all(limit);
}

module.exports = { firstNameLastInitial, kenkenLeaderboard };
