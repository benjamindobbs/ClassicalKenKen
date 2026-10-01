const { db } = require('./db');
const PC = require('../js/projection-core');
const { createTieredGame } = require('./tieredGame');

// Projections persistence. Problems are generated, timed and graded here so
// a student can't pick easy shapes or fake a fast time; the rules themselves
// live in js/projection-core.js. Tier tracking is the shared engine.
//
// Each student has at most one open problem (projection_problems). Asking
// for the next problem returns that same one until it's answered — reloading
// the page doesn't skip a hard shape, and its timer keeps running from when it
// was first served. A problem left open longer than STALE_MS, or one from a
// tier the student has since left, is replaced.

const STALE_MS = 2 * 60 * 60 * 1000;
const MAX_TIME_MS = 60 * 60 * 1000;

const game = createTieredGame({
    core:          PC,
    scoresTable:   'projection_scores',
    progressTable: 'projection_progress',
    rescore:       r => PC.scoreAttempt(r.tier, !!r.correct, r.time_ms),
});

// Build problems send only the three views — the shape is the answer. (The
// code is still sent for bug reports; it's not meant to be secret, just not
// handed over as cubes.)
function payload(row) {
    const def = PC.tierDef(row.tier);
    const shape = PC.decodeShape(row.shape_code);
    const given = row.task === 'build'
        ? { box: shape.box, views: viewsJSON(shape) }
        : { shape };
    return {
        problem_id:    row.id,
        tier:          row.tier,
        task:          row.task,
        ...given,
        code:          row.shape_code,
        elapsed_ms:    Math.max(0, Date.now() - row.issued_at),
        hidden_graded: def.hiddenGraded,
        align:         def.align,
    };
}

function viewsJSON(shape) {
    const v = PC.computeViews(shape);
    return Object.fromEntries(PC.VIEW_NAMES.map(n => [n, PC.viewToJSON(v[n])]));
}

// The student's open problem, or a new one at their current tier.
function nextProblem(userKey) {
    const tier = game.getProgress(userKey).tier;
    const open = db.prepare('SELECT * FROM projection_problems WHERE user_key = ?').get(userKey);
    if (open && open.tier === tier && Date.now() - open.issued_at < STALE_MS
        && (open.task === 'draw' || PC.CONFIG.BUILD_ENABLED)) {
        return { ...payload(open), ...game.status(userKey) };
    }
    const shape = PC.generateShape(tier);
    const task = PC.pickTask(tier);
    db.prepare('DELETE FROM projection_problems WHERE user_key = ?').run(userKey);
    const r = db.prepare(`
        INSERT INTO projection_problems(user_key, tier, task, shape_code, issued_at) VALUES(?, ?, ?, ?, ?)
    `).run(userKey, tier, task, PC.encodeShape(shape), Date.now());
    const row = db.prepare('SELECT * FROM projection_problems WHERE id = ?').get(r.lastInsertRowid);
    return { ...payload(row), ...game.status(userKey) };
}

// ── Answer validation ────────────────────────────────────────────────────────
// A drawn view arrives as { cells: [[u, v]…], lines: [[u1, v1, u2, v2, 'v'|'h']…] }.
// Anything outside the view's grid or not a unit segment is rejected.
function parseView(j, [U, V]) {
    if (!j || !Array.isArray(j.cells) || !Array.isArray(j.lines)) return null;
    if (j.cells.length > U * V || j.lines.length > 2 * (U + 1) * (V + 1)) return null;
    const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
    for (const c of j.cells) if (!Array.isArray(c) || !int(c[0], 0, U - 1) || !int(c[1], 0, V - 1)) return null;
    for (const l of j.lines) {
        if (!Array.isArray(l) || l.length !== 5 || !['v', 'h'].includes(l[4])) return null;
        const [u1, v1, u2, v2] = l;
        if (![u1, u2].every(n => int(n, 0, U)) || ![v1, v2].every(n => int(n, 0, V))) return null;
        if (Math.abs(u1 - u2) + Math.abs(v1 - v2) !== 1) return null;
    }
    return PC.viewFromJSON({ size: [U, V], cells: j.cells, lines: j.lines });
}

function parseDrawing(answer, box) {
    if (!answer || typeof answer !== 'object') return null;
    const sizes = { front: [box[0], box[2]], right: [box[1], box[2]], top: [box[0], box[1]] };
    const out = {};
    for (const n of PC.VIEW_NAMES) {
        out[n] = parseView(answer[n], sizes[n]);
        if (!out[n]) return null;
    }
    return out;
}

function parseBuild(answer, box) {
    if (!answer || !Array.isArray(answer.cubes) || answer.cubes.length > box[0] * box[1] * box[2]) return null;
    const ok = answer.cubes.every(c => Array.isArray(c) && c.length === 3 && c.every(Number.isInteger)
        && c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < box[0] && c[1] < box[1] && c[2] < box[2]);
    if (!ok || PC.cubeSet(answer.cubes).size !== answer.cubes.length) return null;
    return { cubes: answer.cubes };
}

// Grades the student's open problem. Returns { ok, status?, error?, … }:
//   409 — no such open problem, or the tier moved since it was served
//   400 — malformed answer
function submit(userKey, { problem_id, answer, class_id }) {
    const open = db.prepare('SELECT * FROM projection_problems WHERE user_key = ?').get(userKey);
    if (!open || open.id !== Number(problem_id)) {
        return { ok: false, http: 409, error: 'problem is not open', ...game.status(userKey) };
    }
    const tier = game.getProgress(userKey).tier;
    if (open.tier !== tier) {
        db.prepare('DELETE FROM projection_problems WHERE id = ?').run(open.id);
        return { ok: false, http: 409, error: 'tier changed', ...game.status(userKey) };
    }

    const shape = PC.decodeShape(open.shape_code);
    let result;
    if (open.task === 'build') {
        const build = parseBuild(answer, shape.box);
        if (!build) return { ok: false, http: 400, error: 'malformed build' };
        result = PC.gradeBuild(shape, build);
    } else {
        const drawing = parseDrawing(answer, shape.box);
        if (!drawing) return { ok: false, http: 400, error: 'malformed drawing' };
        result = PC.gradeDrawing(shape, drawing, tier);
    }

    const time_ms = Math.min(MAX_TIME_MS, Math.max(0, Date.now() - open.issued_at));
    const score = PC.scoreAttempt(tier, result.correct, time_ms);
    db.prepare('DELETE FROM projection_problems WHERE id = ?').run(open.id);
    const rec = game.record(userKey, {
        tier, class_id, correct: result.correct, time_ms, score,
        columns: {
            task:          open.task,
            shape_code:    open.shape_code,
            answer:        JSON.stringify(answer),
            hidden_graded: PC.tierDef(tier).hiddenGraded ? 1 : 0,
        },
    });
    return {
        ok: true,
        per_view: result.perView,
        aligned:  result.aligned !== false,
        floating: result.floating || 0,
        // Once answered, a build problem's shape can be shown ("a correct build").
        ...(open.task === 'build' ? { shape } : {}),
        time_ms,
        ...rec,
    };
}

module.exports = {
    status:      game.status,
    getProgress: game.getProgress,
    rescoreAll:  game.rescoreAll,
    nextProblem,
    submit,
};
