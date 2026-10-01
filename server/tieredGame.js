const { db } = require('./db');

// Shared engine for tiered practice games (Ruler Game, Projections): each
// student's current tier, rolling-window stats, tier movement after every
// attempt, and re-scoring when a game's formula changes.
//
// A game supplies its rules module (`core`) and table names. The core must
// provide clampTier, MAX_TIER, attemptPct(tier, row) and CONFIG with
// SCORE_VERSION and PROGRESSION:
//   WINDOW             attempts considered, all made in the current tier
//   PROMOTE_ACCURACY   fraction correct needed to move up (full window only)
//   PROMOTE_SCORE_PCT  average attemptPct needed to move up
//   DEMOTE_SCORE_PCT   average attemptPct below which the student moves down (full window only)
//   STREAK             optional: this many correct in a row replaces the
//                      accuracy check (and the full-window wait); the
//                      streak's own attempts must still meet PROMOTE_SCORE_PCT
// A streak resets on a wrong answer and on any tier change (attempts from
// before the student entered the tier never count).
//
// Tables: scoresTable needs user_key, class_id, tier, correct, time_ms,
// score, score_version, submitted_at plus the game's own columns;
// progressTable needs user_key PK, tier, tier_started_at.

function createTieredGame({ core, scoresTable, progressTable, pctColumns = [], rescoreColumns = [], rescore }) {
    const P = core.CONFIG.PROGRESSION;
    const recentCols = ['correct', 'score', ...pctColumns].join(', ');

    function getProgress(userKey) {
        const row = db.prepare(`SELECT tier, tier_started_at FROM ${progressTable} WHERE user_key = ?`).get(userKey);
        return row ? { tier: core.clampTier(row.tier), tier_started_at: row.tier_started_at }
                   : { tier: 1, tier_started_at: 0 };
    }

    function setTier(userKey, tier, now) {
        db.prepare(`
            INSERT INTO ${progressTable}(user_key, tier, tier_started_at) VALUES(?, ?, ?)
            ON CONFLICT(user_key) DO UPDATE SET tier = excluded.tier, tier_started_at = excluded.tier_started_at
        `).run(userKey, tier, now);
    }

    // Attempts made in the current tier since entering it, newest first.
    function recentInTier(userKey, progress) {
        return db.prepare(`
            SELECT ${recentCols} FROM ${scoresTable}
            WHERE user_key = ? AND tier = ? AND submitted_at >= ?
            ORDER BY id DESC LIMIT ?
        `).all(userKey, progress.tier, progress.tier_started_at, P.WINDOW);
    }

    function avgPct(tier, rows) {
        return rows.length ? rows.reduce((a, r) => a + core.attemptPct(tier, r), 0) / rows.length : null;
    }

    // Window stats for a tier's recent attempts (newest first).
    function stats(tier, recent) {
        const n = recent.length;
        let streak = 0;
        while (streak < n && recent[streak].correct) streak++;
        const streakRows = P.STREAK ? recent.slice(0, Math.min(streak, P.STREAK)) : [];
        return {
            attempts:   n,
            accuracy:   n ? recent.filter(r => r.correct).length / n : null,
            avg_score:  n ? recent.reduce((a, r) => a + Number(r.score), 0) / n : null,
            // avg of each attempt's points ÷ its possible points — what tier movement uses
            avg_pct:    avgPct(tier, recent),
            streak,
            streak_pct: avgPct(tier, streakRows),
        };
    }

    // Where the student should be after these attempts.
    function nextTier(tier, recent) {
        const s = stats(tier, recent);
        const full = s.attempts >= P.WINDOW;
        const pointsOk = s.avg_pct != null && s.avg_pct >= P.PROMOTE_SCORE_PCT;
        if (tier < core.MAX_TIER) {
            if (full && s.accuracy >= P.PROMOTE_ACCURACY && pointsOk) return tier + 1;
            if (P.STREAK && s.streak >= P.STREAK && s.streak_pct >= P.PROMOTE_SCORE_PCT) return tier + 1;
        }
        if (tier > 1 && full && s.avg_pct < P.DEMOTE_SCORE_PCT) return tier - 1;
        return tier;
    }

    // Summary the game page shows: tier plus how the current window is going.
    function status(userKey) {
        const progress = getProgress(userKey);
        return {
            tier:     progress.tier,
            max_tier: core.MAX_TIER,
            window:   P.WINDOW,
            ...stats(progress.tier, recentInTier(userKey, progress)),
        };
    }

    // Stores one attempt at the student's current tier and applies any tier
    // move. `columns` holds the game's own column values. Validation is the
    // caller's job — this assumes the attempt is legitimate for `tier`.
    // Returns { correct, score, previous_tier, ...status }.
    function record(userKey, { tier, class_id, correct, time_ms, score, columns = {} }) {
        const progress = getProgress(userKey);
        const now = Date.now();
        const names = ['user_key', 'class_id', 'tier', 'correct', 'time_ms', 'score', 'score_version', 'submitted_at',
                       ...Object.keys(columns)];
        const values = [userKey, class_id, tier, correct ? 1 : 0, time_ms, score, core.CONFIG.SCORE_VERSION, now,
                        ...Object.values(columns)];

        db.exec('BEGIN');
        try {
            db.prepare(`INSERT INTO ${scoresTable} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
              .run(...values);
            const started = progress.tier_started_at || now;
            if (!progress.tier_started_at) setTier(userKey, tier, now);
            const next = nextTier(tier, recentInTier(userKey, { tier, tier_started_at: started }));
            if (next !== tier) setTier(userKey, next, now);
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
        return { correct: !!correct, score, previous_tier: tier, ...status(userKey) };
    }

    // Re-applies the current scoring formula to attempts stored under an older
    // one. Tier history is left alone — only scores (and so charts/averages) move.
    function rescoreAll() {
        const v = core.CONFIG.SCORE_VERSION;
        const cols = ['id', 'tier', 'correct', 'time_ms', ...rescoreColumns].join(', ');
        const stale = db.prepare(`SELECT ${cols} FROM ${scoresTable} WHERE score_version != ?`).all(v);
        if (!stale.length) return 0;
        const upd = db.prepare(`UPDATE ${scoresTable} SET score = ?, score_version = ? WHERE id = ?`);
        db.exec('BEGIN');
        try {
            for (const r of stale) upd.run(rescore(r), v, r.id);
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
        return stale.length;
    }

    return { getProgress, status, record, rescoreAll, nextTier, stats };
}

module.exports = { createTieredGame };
