const { Router } = require('express');
const { db } = require('../db');
const { lookupRank } = require('../rankTable');
const { requireAuth } = require('../auth');

const router = Router();
router.use(requireAuth);

function getRankDataForUser(userKey) {
    const row = db.prepare(
        'SELECT AVG(score) AS avg FROM kenken_scores WHERE user_key = ?'
    ).get(userKey);
    const avg = row && row.avg != null ? row.avg : 0;
    return { rank: lookupRank(avg), avg };
}

// Validates active enrollment in class_id; null when absent/invalid so a stale
// tab never loses a submission over a bad class_id (stored as "not for a class").
function enrolledClassId(userKey, raw) {
    const n = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(n)) return null;
    const row = db.prepare(
        'SELECT 1 FROM class_students WHERE user_key = ? AND class_id = ? AND exited_on IS NULL'
    ).get(userKey, n);
    if (!row) { console.warn(`kenken: user ${userKey} not enrolled in class ${n}, storing NULL`); return null; }
    return n;
}

// POST /api/kenken/score  { score, size, class_id }
router.post('/score', (req, res) => {
    const { score, size, class_id } = req.body;
    if (score == null || size == null) return res.status(400).json({ error: 'score and size required' });
    const scoreNum = Number(score);
    const sizeNum = Number(size);
    if (!Number.isFinite(scoreNum) || !Number.isFinite(sizeNum)) {
        return res.status(400).json({ error: 'score and size must be finite numbers' });
    }
    const classId = enrolledClassId(req.userKey, class_id);

    db.prepare(
        'INSERT INTO kenken_scores(user_key, score, size, class_id, submitted_at) VALUES(?, ?, ?, ?, ?)'
    ).run(req.userKey, scoreNum, sizeNum, classId, Date.now());

    res.json(getRankDataForUser(req.userKey));
});

// GET /api/kenken/rank
router.get('/rank', (req, res) => {
    res.json(getRankDataForUser(req.userKey));
});

module.exports = router;
