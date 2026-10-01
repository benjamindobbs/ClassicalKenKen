const Core = require('../js/measurement-core');
const { createTieredGame } = require('./tieredGame');

// Ruler Game persistence. Tier tracking and movement come from the shared
// engine (server/tieredGame.js); the rules themselves (tiers, scoring,
// thresholds) are in js/measurement-core.js so the game page uses the exact
// same ones.

const game = createTieredGame({
    core:           Core,
    scoresTable:    'measurement_scores',
    progressTable:  'measurement_progress',
    pctColumns:     ['target_32'],
    rescoreColumns: ['target_32'],
    rescore:        r => Core.scoreAttempt(r.tier, r.target_32, !!r.correct, r.time_ms),
});

// Records one attempt at the student's current server-side tier and applies
// any promotion/demotion. Returns { ok, error?, correct, score, previous_tier, ...status }.
function recordAttempt(userKey, { target_32, guess_32, time_ms, class_id }) {
    const tier = game.getProgress(userKey).tier;
    if (!Core.isValidTarget(tier, target_32)) return { ok: false, error: 'target not valid for current tier', ...game.status(userKey) };
    if (!Core.isValidGuess(tier, guess_32))   return { ok: false, error: 'guess not on a tier graduation', ...game.status(userKey) };

    const ms = Math.max(0, Math.min(10 * 60 * 1000, Math.round(Number(time_ms) || 0)));
    const correct = Number(target_32) === Number(guess_32);
    return {
        ok: true,
        ...game.record(userKey, {
            tier, class_id, correct, time_ms: ms,
            score: Core.scoreAttempt(tier, target_32, correct, ms),
            columns: { target_32: Number(target_32), guess_32: Number(guess_32) },
        }),
    };
}

module.exports = {
    status:     game.status,
    getProgress: game.getProgress,
    rescoreAll: game.rescoreAll,
    recordAttempt,
};
