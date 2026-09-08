const { Router }      = require('express');
const { db }          = require('../db');
const { requireAuth } = require('../auth');
const { firstNameLastInitial, kenkenLeaderboard } = require('../leaderboard');

const router = Router();
router.use(requireAuth);

// GET /api/student/classes
// Active enrollments for the signed-in student, with everything the client's
// class picker and daily-progress pill need. One row per class.
router.get('/classes', (req, res) => {
    const classes = db.prepare(`
        SELECT c.id AS class_id, c.name, c.assessment_type,
               c.required_activity, c.required_kenken_count,
               c.required_sat_count, c.required_sat_math_count,
               c.sat_english_domains, c.sat_math_domains
        FROM class_students cs
        JOIN classes c ON c.id = cs.class_id
        WHERE cs.user_key = ? AND cs.exited_on IS NULL
        ORDER BY c.name
    `).all(req.userKey);
    res.json({ classes });
});

// Resolves the class a daily-progress / session request is scoped to.
// Returns { classRow, scoped } — classRow null when the student has no class.
// Throws { status, error } for a class_id the student isn't actively enrolled in.
function resolveScopeClass(userKey, qClass) {
    const cols = `c.id AS class_id, c.assessment_type,
                  c.required_activity, c.required_kenken_count, c.required_sat_count, c.required_sat_math_count`;
    if (qClass != null && qClass !== '' && qClass !== 'none') {
        const row = db.prepare(`
            SELECT ${cols}
            FROM class_students cs JOIN classes c ON cs.class_id = c.id
            WHERE cs.user_key = ? AND cs.class_id = ? AND cs.exited_on IS NULL
        `).get(userKey, Number(qClass));
        if (!row) throw { status: 400, error: 'not enrolled in class_id' };
        return { classRow: row, scoped: true };
    }
    // Legacy / unscoped: keep the historical "pick one" behaviour.
    const row = db.prepare(`
        SELECT ${cols}
        FROM class_students cs JOIN classes c ON cs.class_id = c.id
        WHERE cs.user_key = ?
        LIMIT 1
    `).get(userKey);
    return { classRow: row || null, scoped: false };
}

// GET /api/student/daily-progress[?class_id=<id>|none]
// Returns today's submission counts, remaining requirements, and the activity mode.
// With class_id: scoped to that class (settings + counts). "none" => free
// practice, no assignment. Without it: legacy first-class behaviour.
// Returns 401 (via requireAuth) if the student is not signed in.
router.get('/daily-progress', (req, res) => {
    const qClass = req.query.class_id;
    if (qClass === 'none') return res.json({ settings: null, assessment_type: 'sat', class_id: null });

    let classRow, scoped;
    try {
        ({ classRow, scoped } = resolveScopeClass(req.userKey, qClass));
    } catch (e) {
        return res.status(e.status || 400).json({ error: e.error || 'bad request' });
    }

    if (!classRow) return res.json({ settings: null, assessment_type: 'sat', class_id: null });

    const settings = {
        required_activity: classRow.required_activity,
        required_kenken_count: classRow.required_kenken_count,
        required_sat_count: classRow.required_sat_count,
        required_sat_math_count: classRow.required_sat_math_count,
    };

    // Midnight UTC today
    const now        = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // When scoped to a class, only submissions attributed to it count toward
    // that class's Do Now (server/db.js: kenken_scores.class_id et al.).
    const cf   = scoped ? ' AND class_id = ?' : '';
    const cArg = scoped ? [classRow.class_id] : [];

    // KenKen: only count today's puzzles that score >= the student's all-time average
    const avgRow   = db.prepare('SELECT AVG(score) AS avg FROM kenken_scores WHERE user_key = ?').get(req.userKey);
    const avgScore = avgRow?.avg ?? 0;
    const kenkenToday = db.prepare(
        'SELECT COUNT(*) AS n FROM kenken_scores WHERE user_key = ? AND submitted_at >= ? AND score >= ?' + cf
    ).get(req.userKey, todayStart, avgScore, ...cArg).n;

    // SAT English: only count correct answers
    const satToday = db.prepare(
        'SELECT COUNT(*) AS n FROM sat_scores WHERE user_key = ? AND submitted_at >= ? AND correct = 1' + cf
    ).get(req.userKey, todayStart, ...cArg).n;

    // SAT Math: only count correct answers
    const satMathToday = db.prepare(
        'SELECT COUNT(*) AS n FROM sat_math_scores WHERE user_key = ? AND submitted_at >= ? AND correct = 1' + cf
    ).get(req.userKey, todayStart, ...cArg).n;

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
        class_id:        scoped ? classRow.class_id : null,
    });
});

// GET /api/student/kenken-leaderboard — top 10 average KenKen scores among
// students actively enrolled in a class. One row per student.
router.get('/kenken-leaderboard', (req, res) => {
    res.json(kenkenLeaderboard(10).map((r, i) => ({
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
