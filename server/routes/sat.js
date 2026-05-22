const { Router } = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = Router();
router.use(requireAuth);

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ACCURACY_THRESHOLD = 0.70;
const MIN_ATTEMPTS = 5; // require this many attempts before advancing difficulty

// POST /api/sat/score  { correct, domainIdx, skill, difficulty }
router.post('/score', (req, res) => {
    const { correct, domainIdx, skill = '', difficulty } = req.body;
    if (correct == null || domainIdx == null || !difficulty) {
        return res.status(400).json({ error: 'correct, domainIdx, and difficulty required' });
    }

    db.prepare(
        `INSERT INTO sat_scores(user_key, correct, domain_idx, skill, difficulty, submitted_at)
         VALUES(?, ?, ?, ?, ?, ?)`
    ).run(req.userKey, correct ? 1 : 0, Number(domainIdx), skill, difficulty, Date.now());

    res.json({ ok: true });
});

// GET /api/sat/next  → { domainIdx, skill, difficulty }
router.get('/next', (req, res) => {
    // Get all attempts grouped by (domain_idx, skill, difficulty)
    const rows = db.prepare(`
        SELECT domain_idx, skill, difficulty,
               COUNT(*) AS attempts,
               SUM(correct) AS correct_count
        FROM sat_scores
        WHERE user_key = ?
        GROUP BY domain_idx, skill, difficulty
    `).all(req.userKey);

    if (rows.length === 0) {
        // No history — return random domain at Easy, no skill constraint
        return res.json({ domainIdx: Math.floor(Math.random() * 4), skill: '', difficulty: 'Easy' });
    }

    // Build accuracy map: key = `${domainIdx}|${skill}|${difficulty}` → { attempts, accuracy }
    const accuracyMap = {};
    for (const row of rows) {
        const key = `${row.domain_idx}|${row.skill}|${row.difficulty}`;
        accuracyMap[key] = {
            attempts: row.attempts,
            accuracy: row.correct_count / row.attempts,
        };
    }

    // Determine the appropriate difficulty tier for each (domainIdx, skill) pair seen
    const seen = new Set(rows.map(r => `${r.domain_idx}|${r.skill}`));
    const candidates = [];

    for (const combo of seen) {
        const [domainIdx, skill] = combo.split('|');
        let targetDifficulty = 'Easy';

        for (let i = 0; i < DIFFICULTIES.length - 1; i++) {
            const tierKey = `${domainIdx}|${skill}|${DIFFICULTIES[i]}`;
            const tier = accuracyMap[tierKey];
            if (tier && tier.attempts >= MIN_ATTEMPTS && tier.accuracy > ACCURACY_THRESHOLD) {
                targetDifficulty = DIFFICULTIES[i + 1];
            } else {
                break;
            }
        }

        candidates.push({ domainIdx: Number(domainIdx), skill, difficulty: targetDifficulty });
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    res.json(pick);
});

module.exports = router;
