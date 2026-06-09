const { Router } = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = Router();
router.use(requireAuth);

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ACCURACY_THRESHOLD = 0.70;
const MIN_ATTEMPTS = 5;

const DOMAIN_NAMES = [
    'Algebra',
    'Advanced Math',
    'Problem-Solving and Data Analysis',
    'Geometry and Trigonometry',
];

// POST /api/sat-math/score  { correct, domainIdx, skill, difficulty }
router.post('/score', (req, res) => {
    const { correct, domainIdx, skill = '', difficulty } = req.body;
    if (correct == null || domainIdx == null || !difficulty) {
        return res.status(400).json({ error: 'correct, domainIdx, and difficulty required' });
    }

    db.prepare(
        `INSERT INTO sat_math_scores(user_key, correct, domain_idx, skill, difficulty, submitted_at)
         VALUES(?, ?, ?, ?, ?, ?)`
    ).run(req.userKey, correct ? 1 : 0, Number(domainIdx), skill, difficulty, Date.now());

    res.json({ ok: true });
});

// GET /api/sat-math/next  → { domainIdx, skill, difficulty }
router.get('/next', (req, res) => {
    // Resolve per-class domain restrictions for this student
    const classRows = db.prepare(`
        SELECT c.sat_math_domains
        FROM class_students cs
        JOIN classes c ON c.id = cs.class_id
        WHERE cs.user_key = ? AND c.sat_math_domains IS NOT NULL
    `).all(req.userKey);

    let allowedDomains = null;
    if (classRows.length > 0) {
        const allowed = new Set();
        for (const { sat_math_domains } of classRows) {
            sat_math_domains.split(',').map(Number).forEach(d => allowed.add(d));
        }
        allowedDomains = allowed;
    }
    const ALL_DOMAINS = [0, 1, 2, 3];
    const activeDomains = allowedDomains ? ALL_DOMAINS.filter(d => allowedDomains.has(d)) : ALL_DOMAINS;
    if (activeDomains.length === 0) return res.json({ domainIdx: ALL_DOMAINS[Math.floor(Math.random() * 4)], skill: '', difficulty: 'Easy' });

    // Last 25 attempts per (domain_idx, skill, difficulty) — recency window prevents old struggles
    // from permanently suppressing a student's difficulty level
    const rawRows = db.prepare(`
        SELECT domain_idx, skill, difficulty, correct
        FROM (
            SELECT domain_idx, skill, difficulty, correct,
                   ROW_NUMBER() OVER (
                       PARTITION BY domain_idx, skill, difficulty
                       ORDER BY submitted_at DESC
                   ) AS rn
            FROM sat_math_scores
            WHERE user_key = ?
        )
        WHERE rn <= 25
    `).all(req.userKey);

    // Aggregate windowed rows into accuracy map
    const accuracyMap = {};
    for (const row of rawRows) {
        const key = `${row.domain_idx}|${row.skill}|${row.difficulty}`;
        if (!accuracyMap[key]) accuracyMap[key] = { attempts: 0, correct: 0 };
        accuracyMap[key].attempts++;
        accuracyMap[key].correct += row.correct;
    }
    for (const e of Object.values(accuracyMap)) {
        e.accuracy = e.correct / e.attempts;
    }

    const seenCombos = new Set(rawRows.map(r => `${r.domain_idx}|${r.skill}`));
    const seenDomains = new Set(rawRows.map(r => r.domain_idx));
    const candidates = [];

    // Unseen allowed domains enter pool as 0% accuracy (weight 1.0)
    for (const d of activeDomains) {
        if (!seenDomains.has(d)) {
            candidates.push({ domainIdx: d, skill: '', difficulty: 'Easy', weight: 1.0 });
        }
    }

    // Seen (domain, skill) combos — advance difficulty tier, then weight by inverse accuracy
    for (const combo of seenCombos) {
        const pipeIdx = combo.indexOf('|');
        const domainIdx = Number(combo.slice(0, pipeIdx));
        const skill = combo.slice(pipeIdx + 1);
        if (!activeDomains.includes(domainIdx)) continue;

        let targetDifficulty = 'Easy';
        for (let i = 0; i < DIFFICULTIES.length - 1; i++) {
            const tier = accuracyMap[`${domainIdx}|${skill}|${DIFFICULTIES[i]}`];
            if (tier && tier.attempts >= MIN_ATTEMPTS && tier.accuracy > ACCURACY_THRESHOLD) {
                targetDifficulty = DIFFICULTIES[i + 1];
            } else {
                break;
            }
        }

        const stats = accuracyMap[`${domainIdx}|${skill}|${targetDifficulty}`];
        const accuracy = stats ? stats.accuracy : 0;
        // Floor at 0.05 so fully mastered areas still appear occasionally
        const weight = Math.max(0.05, 1 - accuracy);

        candidates.push({ domainIdx, skill, difficulty: targetDifficulty, weight });
    }

    if (candidates.length === 0) {
        return res.json({ domainIdx: activeDomains[Math.floor(Math.random() * activeDomains.length)], skill: '', difficulty: 'Easy' });
    }

    // Weighted random pick — lower accuracy = higher probability of selection
    const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
    let rand = Math.random() * totalWeight;
    let pick = candidates[candidates.length - 1];
    for (const c of candidates) {
        rand -= c.weight;
        if (rand <= 0) { pick = c; break; }
    }
    res.json({ domainIdx: pick.domainIdx, skill: pick.skill, difficulty: pick.difficulty });
});

// GET /api/sat-math/session?since=<ms>
router.get('/session', (req, res) => {
    const since = Number(req.query.since) || (() => {
        const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();

    const rows = db.prepare(`
        SELECT domain_idx, skill, difficulty, correct
        FROM sat_math_scores
        WHERE user_key = ? AND submitted_at >= ?
        ORDER BY submitted_at
    `).all(req.userKey, since);

    const domainMap = {};
    for (const row of rows) {
        const di = row.domain_idx;
        if (!domainMap[di]) domainMap[di] = {};
        const sk = row.skill || '';
        if (!domainMap[di][sk]) domainMap[di][sk] = {};
        const diff = row.difficulty;
        if (!domainMap[di][sk][diff]) domainMap[di][sk][diff] = { total: 0, correct: 0 };
        domainMap[di][sk][diff].total++;
        if (row.correct) domainMap[di][sk][diff].correct++;
    }

    const domains = Object.entries(domainMap)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([idx, skillMap]) => ({
            idx: Number(idx),
            name: DOMAIN_NAMES[Number(idx)] || `Domain ${idx}`,
            skills: Object.entries(skillMap).map(([skill, diffMap]) => {
                let total = 0, correct = 0;
                for (const d of Object.values(diffMap)) { total += d.total; correct += d.correct; }
                return { skill, total, correct, byDifficulty: diffMap };
            }),
        }));

    res.json({ domains });
});

// POST /api/sat-math/report  { questionId, domainIdx }
router.post('/report', (req, res) => {
    const { questionId } = req.body;
    if (!questionId) return res.status(400).json({ error: 'questionId required' });

    db.prepare(`
        INSERT OR IGNORE INTO question_reports(question_id, subject, user_key, reported_at)
        VALUES(?, 'math', ?, ?)
    `).run(questionId, req.userKey, Date.now());

    const { count } = db.prepare(
        `SELECT COUNT(DISTINCT user_key) AS count FROM question_reports WHERE question_id = ? AND subject = 'math'`
    ).get(questionId);

    res.json({ ok: true, reportCount: count });
});

module.exports = router;
