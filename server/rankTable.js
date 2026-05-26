// Rank is a float: integer part = grid size tier (1–7), fractional part = sub-rank (controls hints).
// Thresholds must stay in sync with LEVEL_STARTS in js/kenken.js.
const LEVEL_STARTS = [0, 25, 42, 58, 72, 84, 94];

function lookupRank(avgScore) {
    let level = 1;
    for (let i = LEVEL_STARTS.length - 1; i >= 0; i--) {
        if (avgScore >= LEVEL_STARTS[i]) { level = i + 1; break; }
    }
    if (level >= LEVEL_STARTS.length) return LEVEL_STARTS.length;
    const start = LEVEL_STARTS[level - 1];
    const end   = LEVEL_STARTS[level];
    const pct   = Math.max(0, Math.min(1, (avgScore - start) / (end - start)));
    return level + pct;
}

module.exports = { lookupRank };
