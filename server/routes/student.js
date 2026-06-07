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

// GET /api/student/microcredentials — MC progress for the signed-in student across all classes
router.get('/microcredentials', (req, res) => {
    const memberships = db.prepare(`
        SELECT cs.student_id, cs.class_id, c.name AS class_name
        FROM class_students cs
        JOIN classes c ON c.id = cs.class_id
        WHERE cs.user_key = ?
    `).all(req.userKey);

    if (!memberships.length) return res.json([]);

    const results = [];
    for (const m of memberships) {
        const mcs = db.prepare(`
            SELECT mc.id, mc.name
            FROM microcredentials mc
            JOIN mc_class_assignments a ON a.mc_id = mc.id
            WHERE a.class_id = ?
            ORDER BY mc.name
        `).all(m.class_id);

        for (const mc of mcs) {
            const checkpoints = db.prepare(
                'SELECT id, name FROM mc_checkpoints WHERE mc_id = ? ORDER BY order_idx'
            ).all(mc.id);

            const completions = db.prepare(`
                SELECT mc_c.checkpoint_id FROM mc_completions mc_c
                JOIN mc_checkpoints cp ON cp.id = mc_c.checkpoint_id
                WHERE mc_c.class_id = ? AND mc_c.student_id = ? AND cp.mc_id = ?
            `).all(m.class_id, m.student_id, mc.id);

            const completedIds = new Set(completions.map(c => c.checkpoint_id));

            results.push({
                mc_id:       mc.id,
                mc_name:     mc.name,
                class_id:    m.class_id,
                class_name:  m.class_name,
                checkpoints: checkpoints.map(cp => ({
                    id:        cp.id,
                    name:      cp.name,
                    completed: completedIds.has(cp.id),
                })),
            });
        }
    }

    res.json(results);
});

// GET /api/student/rubrics?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/rubrics', (req, res) => {
    const memberships = db.prepare(`
        SELECT cs.student_id, cs.class_id, c.name AS class_name
        FROM class_students cs
        JOIN classes c ON c.id = cs.class_id
        WHERE cs.user_key = ?
    `).all(req.userKey);

    if (!memberships.length) return res.json({ entries: [], averages: null });

    const { from, to } = req.query;
    const entries = [];

    for (const m of memberships) {
        let q = 'SELECT date, timeliness, problem_solving, task_completion, total FROM daily_rubric WHERE class_id = ? AND student_id = ?';
        const p = [m.class_id, m.student_id];
        if (from) { q += ' AND date >= ?'; p.push(from); }
        if (to)   { q += ' AND date <= ?'; p.push(to); }
        q += ' ORDER BY date DESC';
        entries.push(...db.prepare(q).all(...p).map(r => ({ ...r, class_name: m.class_name })));
    }

    entries.sort((a, b) => b.date.localeCompare(a.date));

    const averages = entries.length ? {
        timeliness:      Math.round(entries.reduce((s, e) => s + e.timeliness,      0) / entries.length * 10) / 10,
        problem_solving: Math.round(entries.reduce((s, e) => s + e.problem_solving, 0) / entries.length * 10) / 10,
        task_completion: Math.round(entries.reduce((s, e) => s + e.task_completion, 0) / entries.length * 10) / 10,
        total:           Math.round(entries.reduce((s, e) => s + e.total,            0) / entries.length * 10) / 10,
    } : null;

    res.json({ entries, averages });
});

module.exports = router;
