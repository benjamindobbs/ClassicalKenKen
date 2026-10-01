const { Router } = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const Projection = require('../projection');

const router = Router();
router.use(requireAuth);

// Validates active enrollment in class_id; null when absent/invalid so a stale
// tab never loses a submission over a bad class_id (stored as "not for a class").
function enrolledClassId(userKey, raw) {
    const n = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(n)) return null;
    const row = db.prepare(
        'SELECT 1 FROM class_students WHERE user_key = ? AND class_id = ? AND exited_on IS NULL'
    ).get(userKey, n);
    if (!row) { console.warn(`projection: user ${userKey} not enrolled in class ${n}, storing NULL`); return null; }
    return n;
}

// GET /api/projection/status — current tier and rolling-window stats
router.get('/status', (req, res) => {
    res.json(Projection.status(req.userKey));
});

// GET /api/projection/next — the open problem (or a new one) plus status
router.get('/next', (req, res) => {
    res.json(Projection.nextProblem(req.userKey));
});

// POST /api/projection/attempt  { problem_id, answer, class_id }
// answer: { front, right, top } drawn views for draw tasks, { cubes } for build tasks.
router.post('/attempt', (req, res) => {
    const { problem_id, answer, class_id } = req.body || {};
    if (problem_id == null || answer == null) return res.status(400).json({ error: 'problem_id and answer required' });
    const result = Projection.submit(req.userKey, {
        problem_id, answer, class_id: enrolledClassId(req.userKey, class_id),
    });
    if (!result.ok) return res.status(result.http || 400).json(result);
    res.json(result);
});

module.exports = router;
