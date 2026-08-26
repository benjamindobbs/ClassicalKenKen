const { Router }      = require('express');
const { db }          = require('../db');
const { requireAuth } = require('../auth');

const router = Router();
router.use(requireAuth);

// GET /api/student/daily-progress
// Returns today's submission counts, remaining requirements, and the activity mode.
// Returns 401 (via requireAuth) if the student is not signed in.
router.get('/daily-progress', (req, res) => {
    // Find this student's teacher via class linkage
    const classRow = db.prepare(`
        SELECT c.teacher_key, c.assessment_type FROM class_students cs
        JOIN classes c ON cs.class_id = c.id
        WHERE cs.user_key = ?
        LIMIT 1
    `).get(req.userKey);

    if (!classRow) return res.json({ settings: null, assessment_type: 'sat' });

    const settings = db.prepare(
        'SELECT * FROM assignment_settings WHERE teacher_key = ?'
    ).get(classRow.teacher_key);

    // No requirements configured yet — signal the client to show nothing
    if (!settings) return res.json({ settings: null });

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
