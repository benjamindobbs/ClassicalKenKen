const { db } = require('./db');
const Core = require('../js/measurement-core');

// Ruler Game persistence: current tier per student and tier movement after
// each attempt. The rules themselves (tiers, scoring, thresholds) are in
// js/measurement-core.js so the game page uses the exact same ones.

function getProgress(userKey) {
    const row = db.prepare('SELECT tier, tier_started_at FROM measurement_progress WHERE user_key = ?').get(userKey);
    return row ? { tier: Core.clampTier(row.tier), tier_started_at: row.tier_started_at }
               : { tier: 1, tier_started_at: 0 };
}

function setTier(userKey, tier, now) {
    db.prepare(`
        INSERT INTO measurement_progress(user_key, tier, tier_started_at) VALUES(?, ?, ?)
        ON CONFLICT(user_key) DO UPDATE SET tier = excluded.tier, tier_started_at = excluded.tier_started_at
    `).run(userKey, tier, now);
}

// Attempts made in the current tier since entering it, newest first.
function recentInTier(userKey, progress) {
    return db.prepare(`
        SELECT correct, score FROM measurement_scores
        WHERE user_key = ? AND tier = ? AND submitted_at >= ?
        ORDER BY id DESC LIMIT ?
    `).all(userKey, progress.tier, progress.tier_started_at, Core.CONFIG.PROGRESSION.WINDOW);
}

// Summary the game page shows: tier plus how the current window is going.
function status(userKey) {
    const progress = getProgress(userKey);
    const recent = recentInTier(userKey, progress);
    const n = recent.length;
    return {
        tier:      progress.tier,
        max_tier:  Core.MAX_TIER,
        window:    Core.CONFIG.PROGRESSION.WINDOW,
        attempts:  n,
        accuracy:  n ? recent.filter(r => r.correct).length / n : null,
        avg_score: n ? recent.reduce((a, r) => a + Number(r.score), 0) / n : null,
        max_score: Core.maxScore(progress.tier),
    };
}

// Records one attempt at the student's current server-side tier and applies
// any promotion/demotion. Returns { ok, error?, correct, score, previous_tier, ...status }.
function recordAttempt(userKey, { target_32, guess_32, time_ms, class_id }) {
    const progress = getProgress(userKey);
    const tier = progress.tier;
    if (!Core.isValidTarget(tier, target_32)) return { ok: false, error: 'target not valid for current tier', ...status(userKey) };
    if (!Core.isValidGuess(tier, guess_32))   return { ok: false, error: 'guess not on a tier graduation', ...status(userKey) };

    const ms = Math.max(0, Math.min(10 * 60 * 1000, Math.round(Number(time_ms) || 0)));
    const correct = Number(target_32) === Number(guess_32);
    const score = Core.scoreAttempt(tier, correct, ms);
    const now = Date.now();

    db.exec('BEGIN');
    try {
        db.prepare(`
            INSERT INTO measurement_scores
                (user_key, class_id, tier, target_32, guess_32, correct, time_ms, score, score_version, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userKey, class_id, tier, Number(target_32), Number(guess_32), correct ? 1 : 0, ms, score,
               Core.CONFIG.SCORE_VERSION, now);

        if (!progress.tier_started_at) setTier(userKey, tier, now);
        const next = Core.nextTier(tier, recentInTier(userKey, { tier, tier_started_at: progress.tier_started_at || now }));
        if (next !== tier) setTier(userKey, next, now);
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }

    return { ok: true, correct, score, previous_tier: tier, ...status(userKey) };
}

// Re-applies the current scoring formula to attempts stored under an older
// one. Tier history is left alone — only scores (and so charts/averages) move.
function rescoreAll() {
    const v = Core.CONFIG.SCORE_VERSION;
    const stale = db.prepare('SELECT id, tier, correct, time_ms FROM measurement_scores WHERE score_version != ?').all(v);
    if (!stale.length) return 0;
    const upd = db.prepare('UPDATE measurement_scores SET score = ?, score_version = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
        for (const r of stale) upd.run(Core.scoreAttempt(r.tier, !!r.correct, r.time_ms), v, r.id);
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
    return stale.length;
}

module.exports = { status, recordAttempt, rescoreAll, getProgress };
