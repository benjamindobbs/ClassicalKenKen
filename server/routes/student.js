const { Router }      = require('express');
const { db }          = require('../db');
const { requireAuth } = require('../auth');

const router = Router();
router.use(requireAuth);

// GET /api/student/daily-progress
// Returns today's submission counts, remaining requirements, and the activity mode.
// Returns 401 (via requireAuth) if the student is not signed in.
router.get('/daily-progress', (req, res) => {
    // Find this student's class — requirements are per-class now, so no
    // separate teacher-wide lookup is needed.
    const classRow = db.prepare(`
        SELECT c.assessment_type,
               c.required_activity, c.required_kenken_count, c.required_sat_count, c.required_sat_math_count
        FROM class_students cs
        JOIN classes c ON cs.class_id = c.id
        WHERE cs.user_key = ?
        LIMIT 1
    `).get(req.userKey);

    if (!classRow) return res.json({ settings: null, assessment_type: 'sat' });

    const settings = {
        required_activity: classRow.required_activity,
        required_kenken_count: classRow.required_kenken_count,
        required_sat_count: classRow.required_sat_count,
        required_sat_math_count: classRow.required_sat_math_count,
    };

    // Midnight UTC today
    const now        = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // KenKen: only count today's puzzles that score >= the student's all-time average
    const avgRow   = db.prepare('SELECT AVG(score) AS avg FROM kenken_scores WHERE user_key = ?').get(req.userKey);
    const avgScore = avgRow?.avg ?? 0;
    const kenkenToday = db.prepare(
        'SELECT COUNT(*) AS n FROM kenken_scores WHERE user_key = ? AND submitted_at >= ? AND score >= ?'
    ).get(req.userKey, todayStart, avgScore).n;

    // SAT English: only count correct answers
    const satToday = db.prepare(
        'SELECT COUNT(*) AS n FROM sat_scores WHERE user_key = ? AND submitted_at >= ? AND correct = 1'
    ).get(req.userKey, todayStart).n;

    // SAT Math: only count correct answers
    const satMathToday = db.prepare(
        'SELECT COUNT(*) AS n FROM sat_math_scores WHERE user_key = ? AND submitted_at >= ? AND correct = 1'
    ).get(req.userKey, todayStart).n;

    const act       = settings.required_activity;
    const remaining = { kenken: 0, sat: 0, sat_math: 0 };

    if (act === 'kenken') {
        remaining.kenken   = Math.max(0, settings.required_kenken_count   - kenkenToday);
    } else if (act === 'sat') {
        remaining.sat      = Math.max(0, settings.required_sat_count      - satToday);
    } else if (act === 'sat-math') {
        remaining.sat_math = Math.max(0, settings.required_sat_math_count - satMathToday);
    } else if (act === 'both') {
        remaining.kenken   = Math.max(0, settings.required_kenken_count   - kenkenToday);
        remaining.sat      = Math.max(0, settings.required_sat_count      - satToday);
    } else if (act === 'sat-both') {
        remaining.sat      = Math.max(0, settings.required_sat_count      - satToday);
        remaining.sat_math = Math.max(0, settings.required_sat_math_count - satMathToday);
    } else if (act === 'kenken-math') {
        remaining.kenken   = Math.max(0, settings.required_kenken_count   - kenkenToday);
        remaining.sat_math = Math.max(0, settings.required_sat_math_count - satMathToday);
    } else if (act === 'all') {
        remaining.kenken   = Math.max(0, settings.required_kenken_count   - kenkenToday);
        remaining.sat      = Math.max(0, settings.required_sat_count      - satToday);
        remaining.sat_math = Math.max(0, settings.required_sat_math_count - satMathToday);
    } else /* either */ {
        remaining.kenken   = Math.max(0, settings.required_kenken_count   - kenkenToday);
        remaining.sat      = Math.max(0, settings.required_sat_count      - satToday);
    }

    res.json({
        settings,
        today:           { kenken: kenkenToday, sat: satToday, sat_math: satMathToday },
        remaining,
        assessment_type: classRow.assessment_type || 'sat',
    });
});

// Render a roster name as "First L." — the full last name is never sent to
// the client. Handles both "Last, First" (PowerSchool export) and "First Last".
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

// GET /api/student/kenken-leaderboard — top 10 average KenKen scores among
// students actively enrolled in a class (a class_students row with a linked
// account). One row per student even if they sit on several rosters.
router.get('/kenken-leaderboard', (req, res) => {
    const rows = db.prepare(`
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
        LIMIT 10
    `).all();

    res.json(rows.map((r, i) => ({
        rank:      i + 1,
        name:      firstNameLastInitial(r.student_name),
        avg_score: Math.round(r.avg_score),
        games:     r.games,
        me:        r.user_key === req.userKey,
    })));
});

// GET /api/student/scores — all KenKen and SAT scores for the signed-in student
router.get('/scores', (req, res) => {
    const kenken = db.prepare(
        'SELECT score, submitted_at FROM kenken_scores WHERE user_key = ? ORDER BY submitted_at'
    ).all(req.userKey);
    const sat = db.prepare(
        'SELECT correct, domain_idx, skill, submitted_at FROM sat_scores WHERE user_key = ? ORDER BY submitted_at'
    ).all(req.userKey);
    const satMath = db.prepare(
        'SELECT correct, domain_idx, skill, submitted_at FROM sat_math_scores WHERE user_key = ? ORDER BY submitted_at'
    ).all(req.userKey);
    res.json({ kenken, sat, sat_math: satMath });
});

module.exports = router;
