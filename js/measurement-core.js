// Ruler Game core — tier table, target generation, snapping and scoring.
// Shared by the browser (js/measurement.js) and the server
// (server/measurement.js), so the rules can only ever live in one place.
//
// All lengths are integers in 1/32" ("32nds") to keep fractions exact:
// 1" = 32, 1/2" = 16, 1/4" = 8, 1/8" = 4, 1/16" = 2, 1/32" = 1.
//
// ── Tuning ──────────────────────────────────────────────────────────────────
// Every knob that's expected to change lives in CONFIG. Bump SCORE_VERSION
// whenever scoreAttempt() changes: the server re-scores every stored attempt
// with the new formula at startup (server/measurement.js:rescoreAll).

(function (root) {
    const RULER_INCHES = 6;
    const UNITS_PER_INCH = 32;

    const CONFIG = {
        SCORE_VERSION: 3,

        // points = (tier base + fraction bonus) × speed; incorrect = 0.
        //   tier base      — the ruler's difficulty: BASE + PER_TIER per tier above 1
        //   fraction bonus — the target's reduced denominator (1 = whole inch)
        //   speed          — par ÷ time, capped at 1, floored at MIN_TIME_FACTOR;
        //                    par grows with the tier since finer rulers take longer
        SCORE: {
            BASE: 25,
            PER_TIER: 25,
            FRACTION_BONUS: { 1: 0, 2: 0, 4: 10, 8: 20, 16: 35, 32: 50 },
            PAR_MS: [null, 3000, 3500, 4000, 5000, 5500, 6500, 7000, 8000],
            MIN_TIME_FACTOR: 0.25,
        },

        // Tier movement looks at the last WINDOW attempts made in the student's
        // current tier (attempts from before they entered it don't count).
        // Score thresholds compare the window's average "pct" — each attempt's
        // points as a fraction of what that attempt could have earned — so one
        // set of numbers works for every tier and any mix of targets.
        PROGRESSION: {
            WINDOW: 20,
            PROMOTE_ACCURACY: 0.9,     // ≥ 90% correct in the window …
            PROMOTE_SCORE_PCT: 0.6,    // … and avg pct ≥ 60%
            DEMOTE_SCORE_PCT: 0.3,     // avg pct < 30% → down one
        },

        // Targets from a newer denominator are weighted heavier; each step
        // further back gets this fraction of the previous one's weight.
        OLDER_DENOMINATOR_DECAY: 0.5,

        MIN_TARGET: 4,                                   // 1/8"
        MAX_TARGET: RULER_INCHES * UNITS_PER_INCH - 1,   // 5 31/32"
    };

    // denoms: target denominators in play (1 = whole inches), oldest → newest.
    // grad:   smallest graduation drawn on the ruler (and the snap step).
    // labels: denominator whose marks get fraction labels, or 0 for none.
    // Inch numerals are always drawn, like a real ruler.
    const TIERS = [
        null,
        { tier: 1, denoms: [1],                 grad: 4,  labels: 4 },
        { tier: 2, denoms: [1, 2],              grad: 4,  labels: 4 },
        { tier: 3, denoms: [1, 2, 4],           grad: 8,  labels: 8 },
        { tier: 4, denoms: [1, 2, 4, 8],        grad: 8,  labels: 8 },
        { tier: 5, denoms: [1, 2, 4, 8],        grad: 8,  labels: 0 },
        { tier: 6, denoms: [1, 2, 4, 8],        grad: 16, labels: 0 },
        { tier: 7, denoms: [1, 2, 4, 8, 16],    grad: 16, labels: 0 },
        { tier: 8, denoms: [1, 2, 4, 8, 16, 32], grad: 32, labels: 0 },
    ];
    const MAX_TIER = TIERS.length - 1;

    function clampTier(t) {
        const n = Math.round(Number(t));
        return Number.isFinite(n) ? Math.max(1, Math.min(MAX_TIER, n)) : 1;
    }
    function tierDef(t) { return TIERS[clampTier(t)]; }

    function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

    // Reduced denominator of a length in 32nds (1 for whole inches).
    function denominatorOf(units) {
        return UNITS_PER_INCH / gcd(units, UNITS_PER_INCH);
    }

    // Every valid target for one denominator: lengths whose reduced form has
    // exactly that denominator, within [MIN_TARGET, MAX_TARGET].
    function targetsFor(denom) {
        const out = [];
        for (let u = CONFIG.MIN_TARGET; u <= CONFIG.MAX_TARGET; u++) {
            if (denominatorOf(u) === denom) out.push(u);
        }
        return out;
    }

    function isValidTarget(tier, units) {
        const u = Number(units);
        return Number.isInteger(u) && u >= CONFIG.MIN_TARGET && u <= CONFIG.MAX_TARGET
            && tierDef(tier).denoms.includes(denominatorOf(u));
    }

    // Guesses land on the tier's visible graduations only.
    function isValidGuess(tier, units) {
        const u = Number(units);
        const step = UNITS_PER_INCH / tierDef(tier).grad;
        return Number.isInteger(u) && u >= 0 && u <= RULER_INCHES * UNITS_PER_INCH && u % step === 0;
    }

    // Weighted pick: newest denominator weight 1, then DECAY, DECAY², …
    // `avoid` (the previous target) is skipped when anything else is possible.
    function pickTarget(tier, avoid, rand) {
        rand = rand || Math.random;
        const denoms = tierDef(tier).denoms;
        const weights = denoms.map((_, i) => Math.pow(CONFIG.OLDER_DENOMINATOR_DECAY, denoms.length - 1 - i));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = rand() * total, denom = denoms[denoms.length - 1];
        for (let i = 0; i < denoms.length; i++) {
            if ((r -= weights[i]) < 0) { denom = denoms[i]; break; }
        }
        let pool = targetsFor(denom);
        if (pool.length > 1) pool = pool.filter(u => u !== avoid);
        return pool[Math.floor(rand() * pool.length)];
    }

    // Snap a position in inches to the nearest visible graduation (in 32nds).
    function snap(tier, inches) {
        const grad = tierDef(tier).grad;
        const clamped = Math.max(0, Math.min(RULER_INCHES, inches));
        return Math.round(clamped * grad) * (UNITS_PER_INCH / grad);
    }

    function tierBase(tier) {
        return CONFIG.SCORE.BASE + CONFIG.SCORE.PER_TIER * (clampTier(tier) - 1);
    }

    // Points a correct, at-par answer to this target earns at this tier.
    function maxScore(tier, target) {
        return tierBase(tier) + (CONFIG.SCORE.FRACTION_BONUS[denominatorOf(Number(target))] || 0);
    }

    function parMs(tier) {
        return CONFIG.SCORE.PAR_MS[clampTier(tier)];
    }

    function timeFactor(tier, ms) {
        const t = Math.max(1, Number(ms) || 0);
        return Math.max(CONFIG.SCORE.MIN_TIME_FACTOR, Math.min(1, parMs(tier) / t));
    }

    function scoreAttempt(tier, target, correct, timeMs) {
        if (!correct) return 0;
        return Math.round(maxScore(tier, target) * timeFactor(tier, timeMs));
    }

    // Fraction of the attempt's possible points it earned (0–1).
    function attemptPct(tier, r) {
        return Number(r.score) / maxScore(tier, r.target_32);
    }

    // Given the current tier and its recent attempts (newest first, each
    // { correct, score, target_32 }), returns the tier the student should be on next.
    function nextTier(tier, recent) {
        const P = CONFIG.PROGRESSION;
        const window = recent.slice(0, P.WINDOW);
        if (window.length < P.WINDOW) return tier;
        const acc = window.filter(r => r.correct).length / window.length;
        const avgPct = window.reduce((a, r) => a + attemptPct(tier, r), 0) / window.length;
        if (tier < MAX_TIER && acc >= P.PROMOTE_ACCURACY && avgPct >= P.PROMOTE_SCORE_PCT) return tier + 1;
        if (tier > 1 && avgPct < P.DEMOTE_SCORE_PCT) return tier - 1;
        return tier;
    }

    // "1 3/16", "5/8", "4" — reduced mixed number, no inch mark.
    function formatLength(units) {
        const whole = Math.floor(units / UNITS_PER_INCH);
        const rem = units % UNITS_PER_INCH;
        if (!rem) return String(whole);
        const g = gcd(rem, UNITS_PER_INCH);
        const frac = `${rem / g}/${UNITS_PER_INCH / g}`;
        return whole ? `${whole} ${frac}` : frac;
    }

    // Chart bucket for a target: 'Whole', '1/2', … '1/32'.
    function denominatorLabel(units) {
        const d = denominatorOf(units);
        return d === 1 ? 'Whole' : `1/${d}`;
    }
    const DENOMINATOR_LABELS = ['Whole', '1/2', '1/4', '1/8', '1/16', '1/32'];

    const api = {
        RULER_INCHES, UNITS_PER_INCH, CONFIG, TIERS, MAX_TIER, DENOMINATOR_LABELS,
        clampTier, tierDef, denominatorOf, targetsFor, isValidTarget, isValidGuess,
        pickTarget, snap, tierBase, maxScore, parMs, timeFactor, scoreAttempt, attemptPct, nextTier,
        formatLength, denominatorLabel,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MeasurementCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
