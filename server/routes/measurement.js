const { Router } = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const M = require('../measurement');

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
    if (!row) { console.warn(`measurement: user ${userKey} not enrolled in class ${n}, storing NULL`); return null; }
    return n;
}

// GET /api/measurement/status — current tier and rolling-window stats
router.get('/status', (req, res) => {
    res.json(M.status(req.userKey));
});

// POST /api/measurement/attempt  { target_32, guess_32, time_ms, class_id }
// The server decides tier and correctness; a target the student's current
// tier can't serve (e.g. a second tab on an old tier) is rejected with 409
// and the current status, so the page can pick a fresh problem.
router.post('/attempt', (req, res) => {
    const { target_32, guess_32, time_ms, class_id } = req.body;
    if (target_32 == null || guess_32 == null || time_ms == null)
        return res.status(400).json({ error: 'target_32, guess_32 and time_ms required' });
    const result = M.recordAttempt(req.userKey, {
        target_32, guess_32, time_ms, class_id: enrolledClassId(req.userKey, class_id),
    });
    if (!result.ok) return res.status(409).json(result);
    res.json(result);
});

module.exports = router;
