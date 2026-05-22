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

// POST /api/kenken/score  { score, size }
router.post('/score', (req, res) => {
    const { score, size } = req.body;
    if (score == null || size == null) return res.status(400).json({ error: 'score and size required' });

    db.prepare(
        'INSERT INTO kenken_scores(user_key, score, size, submitted_at) VALUES(?, ?, ?, ?)'
    ).run(req.userKey, Number(score), Number(size), Date.now());

    res.json(getRankDataForUser(req.userKey));
});

// GET /api/kenken/rank
router.get('/rank', (req, res) => {
    res.json(getRankDataForUser(req.userKey));
});

module.exports = router;
