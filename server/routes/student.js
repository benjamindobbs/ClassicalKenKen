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
        SELECT c.teacher_key FROM class_students cs
        JOIN classes c ON cs.class_id = c.id
        WHERE cs.user_key = ?
        LIMIT 1
    `).get(req.userKey);

    if (!classRow) return res.json({ settings: null });

    const settings = db.prepare(
        'SELECT * FROM assignment_settings WHERE teacher_key = ?'
    ).get(classRow.teacher_key);

    // No requirements configured yet — signal the client to show nothing
    if (!settings) return res.json({ settings: null });

    // Midnight UTC today
    const now       = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const kenkenToday = db.prepare(
        'SELECT COUNT(*) AS n FROM kenken_scores WHERE user_key = ? AND submitted_at >= ?'
    ).get(req.userKey, todayStart).n;

    const satToday = db.prepare(
        'SELECT COUNT(*) AS n FROM sat_scores WHERE user_key = ? AND submitted_at >= ?'
    ).get(req.userKey, todayStart).n;

    const act       = settings.required_activity;
    const remaining = { kenken: 0, sat: 0 };

    if (act === 'kenken') {
        remaining.kenken = Math.max(0, settings.required_kenken_count - kenkenToday);
    } else if (act === 'sat') {
        remaining.sat    = Math.max(0, settings.required_sat_count - satToday);
    } else if (act === 'both') {
        remaining.kenken = Math.max(0, settings.required_kenken_count - kenkenToday);
        remaining.sat    = Math.max(0, settings.required_sat_count    - satToday);
    } else if (act === 'either') {
        remaining.kenken = Math.max(0, settings.required_kenken_count - kenkenToday);
        remaining.sat    = Math.max(0, settings.required_sat_count    - satToday);
    }

    res.json({
        settings,
        today:     { kenken: kenkenToday, sat: satToday },
        remaining,
    });
});

module.exports = router;
