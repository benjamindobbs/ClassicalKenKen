const { Router } = require('express');
const { db }     = require('../db');

const router = Router();

// GET /api/questions/suspended?subject=math|english
// Returns array of question IDs suspended by >= 2 unique student reports OR
// permanently suppressed by a teacher. No auth required.
router.get('/suspended', (req, res) => {
    const { subject } = req.query;
    if (!subject || !['math', 'english'].includes(subject)) {
        return res.status(400).json({ error: 'subject must be math or english' });
    }

    const rows = db.prepare(`
        SELECT question_id FROM question_reports
        WHERE subject = ?
        GROUP BY question_id
        HAVING COUNT(DISTINCT user_key) >= 2
        UNION
        SELECT question_id FROM suppressed_questions WHERE subject = ?
    `).all(subject, subject);

    res.json(rows.map(r => r.question_id));
});

module.exports = router;
