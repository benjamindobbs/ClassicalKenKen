// Projections core — shapes made of unit cubes, their orthographic views
// (US third-angle: front, right side, top) and isometric drawing, answer
// grading, shape generation, tiers and scoring. Shared by the browser
// (js/projection.js) and the server (server/projection.js).
//
// Coordinates: x = right, y = depth (0 = front, growing away from the
// viewer), z = up. A shape is { box: [W, D, H], cubes: [[x, y, z], …] }.
//
// Views are grids of unit cells in paper coordinates (u right, v up):
//   front  u = x, v = z   seen from the front (−y)
//   right  u = y, v = z   seen from the right (+x); the object's front is on
//                         the left, next to the front view
//   top    u = x, v = y   seen from above (+z); the object's front is at the
//                         bottom, next to the front view
// A view is { size: [U, V], cells: Set('u,v'), lines: Map(segKey → 'visible'|'hidden') }
// where segKey is a unit segment 'u1,v1,u2,v2' (u1,v1 the lower-left end).
//
// Lines come from the shape's true edges: a grid edge is an edge of the
// object when the four cube positions around it aren't a flat surface.
// Whether an edge shows as visible or hidden is one test for every drawing:
// step just beside the edge (on each side) and look toward the viewer — if
// either side has a clear line of sight the edge is visible. Where a visible
// and a hidden line land on the same spot, visible wins.

(function (root) {
    // ── Tiers, scoring, progression ──────────────────────────────────────────
    // task: 'draw' (isometric → three views), 'build' (three views → cubes),
    //       'mixed' (either, at random)
    // box: largest shape [W, D, H]; cubes: [min, max]
    // stacksOnly: every cube sits directly on the floor or another cube
    // noHidden: generated shapes have no hidden lines in any view, and no
    //           cube fully hidden in the isometric drawing
    // hiddenGraded: hidden lines must match in drawn answers
    // align: drawn views must line up with each other (drafting alignment)
    // hiddenBehind: false → no fully hidden cube sits exactly behind a visible
    //           one in the isometric drawing (its dashes would trace that
    //           cube's outline) — kept out of the tiers that introduce hidden lines
    const TIERS = [
        null,
        { tier: 1, task: 'draw',  box: [2, 2, 2], cubes: [3, 4],   stacksOnly: true,  noHidden: true,  hiddenGraded: false, align: false },
        { tier: 2, task: 'draw',  box: [3, 3, 2], cubes: [4, 8],   stacksOnly: true,  noHidden: true,  hiddenGraded: false, align: false },
        { tier: 3, task: 'build', box: [3, 3, 2], cubes: [4, 8],   stacksOnly: true,  noHidden: true,  hiddenGraded: false, align: false },
        { tier: 4, task: 'draw',  box: [3, 3, 3], cubes: [6, 12],  stacksOnly: false, noHidden: false, hiddenGraded: false, align: false, hiddenBehind: false },
        { tier: 5, task: 'build', box: [3, 3, 3], cubes: [6, 12],  stacksOnly: false, noHidden: false, hiddenGraded: false, align: false, hiddenBehind: false },
        { tier: 6, task: 'draw',  box: [4, 4, 3], cubes: [8, 16],  stacksOnly: false, noHidden: false, hiddenGraded: true,  align: false },
        { tier: 7, task: 'mixed', box: [4, 4, 4], cubes: [10, 20], stacksOnly: false, noHidden: false, hiddenGraded: true,  align: true  },
        { tier: 8, task: 'mixed', box: [5, 5, 4], cubes: [12, 28], stacksOnly: false, noHidden: false, hiddenGraded: true,  align: true  },
    ];
    const MAX_TIER = TIERS.length - 1;

    const CONFIG = {
        SCORE_VERSION: 1,
        // points = tier base × speed; incorrect = 0.
        //   tier base — BASE + PER_TIER per tier above 1
        //   speed     — par ÷ time, capped at 1, floored at MIN_TIME_FACTOR
        SCORE: {
            BASE: 25,
            PER_TIER: 25,
            PAR_MS: [null, 60000, 73000, 87000, 100000, 114000, 127000, 141000, 154000],
            MIN_TIME_FACTOR: 0.25,
        },
        // Applied by server/tieredGame.js — see there for the exact rules.
        PROGRESSION: {
            WINDOW: 10,
            PROMOTE_ACCURACY: 0.9,
            PROMOTE_SCORE_PCT: 0.6,
            DEMOTE_SCORE_PCT: 0.3,
            STREAK: 5,
        },
        GENERATE_TRIES: 2000,
        // Build problems (three views → cubes). Off → every tier serves
        // drawing problems.
        BUILD_ENABLED: true,
    };

    function clampTier(t) {
        const n = Math.round(Number(t));
        return Number.isFinite(n) ? Math.max(1, Math.min(MAX_TIER, n)) : 1;
    }
    function tierDef(t) { return TIERS[clampTier(t)]; }

    function tierBase(tier) { return CONFIG.SCORE.BASE + CONFIG.SCORE.PER_TIER * (clampTier(tier) - 1); }
    function maxScore(tier) { return tierBase(tier); }
    function parMs(tier) { return CONFIG.SCORE.PAR_MS[clampTier(tier)]; }
    function timeFactor(tier, ms) {
        const t = Math.max(1, Number(ms) || 0);
        return Math.max(CONFIG.SCORE.MIN_TIME_FACTOR, Math.min(1, parMs(tier) / t));
    }
    function scoreAttempt(tier, correct, timeMs) {
        return correct ? Math.round(maxScore(tier) * timeFactor(tier, timeMs)) : 0;
    }
    function attemptPct(tier, r) { return Number(r.score) / maxScore(tier); }

    // ── Shape helpers ────────────────────────────────────────────────────────
    const key3 = (x, y, z) => `${x},${y},${z}`;

    function cubeSet(cubes) {
        const s = new Set();
        for (const [x, y, z] of cubes) s.add(key3(x, y, z));
        return s;
    }

    function inBox([x, y, z], [W, D, H]) {
        return x >= 0 && y >= 0 && z >= 0 && x < W && y < D && z < H;
    }

    const NEIGHBORS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

    // Cubes not connected (through shared faces) to one on the floor.
    function floatingCubes(cubes) {
        const set = cubeSet(cubes);
        const seen = new Set();
        const queue = cubes.filter(c => c[2] === 0).map(c => key3(...c));
        queue.forEach(k => seen.add(k));
        while (queue.length) {
            const [x, y, z] = queue.pop().split(',').map(Number);
            for (const [dx, dy, dz] of NEIGHBORS) {
                const k = key3(x + dx, y + dy, z + dz);
                if (set.has(k) && !seen.has(k)) { seen.add(k); queue.push(k); }
            }
        }
        return cubes.filter(c => !seen.has(key3(...c)));
    }

    // Quarter turns (counter-clockwise seen from above) about the box's
    // vertical axis. Returns { box, cubes } — used by the builder's rotate.
    function rotateZ(shape, quarterTurns) {
        let { box: [W, D, H], cubes } = shape;
        const q = ((quarterTurns % 4) + 4) % 4;
        for (let i = 0; i < q; i++) {
            cubes = cubes.map(([x, y, z]) => [D - 1 - y, x, z]);
            [W, D] = [D, W];
        }
        return { box: [W, D, H], cubes };
    }

    // ── Edges and visibility ─────────────────────────────────────────────────
    // Every unit grid edge that is a true edge of the object. axis 0/1/2 =
    // parallel to x/y/z; p = its start corner (lattice point).
    function featureEdges(shape) {
        const set = cubeSet(shape.cubes);
        const has = (x, y, z) => set.has(key3(x, y, z));
        const [W, D, H] = shape.box;
        const dims = [W, D, H];
        const out = [];
        for (let axis = 0; axis < 3; axis++) {
            const [a, b] = [0, 1, 2].filter(i => i !== axis);
            const p = [0, 0, 0];
            for (let i = 0; i < dims[axis]; i++) {
                for (let j = 0; j <= dims[a]; j++) {
                    for (let k = 0; k <= dims[b]; k++) {
                        const q = (dj, dk) => { p[axis] = i; p[a] = j + dj; p[b] = k + dk; return has(p[0], p[1], p[2]); };
                        const c00 = q(-1, -1), c10 = q(0, -1), c01 = q(-1, 0), c11 = q(0, 0);
                        const n = c00 + c10 + c01 + c11;
                        const diagonal = n === 2 && (c00 === c11);
                        if (n === 1 || n === 3 || diagonal) {
                            const start = [0, 0, 0];
                            start[axis] = i; start[a] = j; start[b] = k;
                            out.push({ axis, p: start });
                        }
                    }
                }
            }
        }
        return out;
    }

    const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
    const EPS = 1e-4;   // how far beside the edge we look from
    const TAU = 1e-2;   // ignore cubes we only graze for a sliver right at the start

    // Is the line of sight from point p toward the viewer (direction v) blocked?
    function blocked(p, v, cubes) {
        for (const c of cubes) {
            let lo = TAU, hi = Infinity;
            for (let a = 0; a < 3 && lo < hi; a++) {
                if (v[a] === 0) {
                    if (!(p[a] > c[a] + 1e-9 && p[a] < c[a] + 1 - 1e-9)) { hi = -Infinity; }
                } else {
                    let t1 = (c[a] - p[a]) / v[a], t2 = (c[a] + 1 - p[a]) / v[a];
                    if (t1 > t2) [t1, t2] = [t2, t1];
                    lo = Math.max(lo, t1); hi = Math.min(hi, t2);
                }
            }
            if (lo < hi - 1e-9) return true;
        }
        return false;
    }

    function edgeHidden(edge, v, cubes) {
        const e = [0, 0, 0]; e[edge.axis] = 1;
        const w = cross(e, v);
        const len = Math.hypot(...w);
        const m = edge.p.slice(); m[edge.axis] += 0.5;
        for (const s of [1, -1]) {
            const pt = m.map((c, i) => c + s * EPS * w[i] / len);
            if (!blocked(pt, v, cubes)) return false;
        }
        return true;
    }

    // ── Orthographic views ───────────────────────────────────────────────────
    const VIEWS = {
        //        toward viewer   paper (u, v) of a 3D point   grid size from box
        front: { dir: [0, -1, 0], uv: ([x, , z]) => [x, z],     size: ([W, , H]) => [W, H] },
        right: { dir: [1, 0, 0],  uv: ([, y, z]) => [y, z],     size: ([, D, H]) => [D, H] },
        top:   { dir: [0, 0, 1],  uv: ([x, y]) => [x, y],       size: ([W, D]) => [W, D] },
    };
    const VIEW_NAMES = ['front', 'right', 'top'];

    const segKey = (u1, v1, u2, v2) =>
        (u1 < u2 || (u1 === u2 && v1 <= v2)) ? `${u1},${v1},${u2},${v2}` : `${u2},${v2},${u1},${v1}`;

    function computeView(shape, name, edges) {
        const V = VIEWS[name];
        const cells = new Set();
        for (const c of shape.cubes) cells.add(V.uv(c).join(','));
        const lines = new Map();
        for (const edge of edges || featureEdges(shape)) {
            const e = [0, 0, 0]; e[edge.axis] = 1;
            if (e[0] * V.dir[0] + e[1] * V.dir[1] + e[2] * V.dir[2] !== 0) continue;  // points at the viewer
            const end = edge.p.slice(); end[edge.axis] += 1;
            const k = segKey(...V.uv(edge.p), ...V.uv(end));
            const kind = edgeHidden(edge, V.dir, shape.cubes) ? 'hidden' : 'visible';
            if (lines.get(k) !== 'visible') lines.set(k, kind);
        }
        return { size: V.size(shape.box), cells, lines };
    }

    function computeViews(shape) {
        const edges = featureEdges(shape);
        return Object.fromEntries(VIEW_NAMES.map(n => [n, computeView(shape, n, edges)]));
    }

    function hasHiddenLines(views) {
        return VIEW_NAMES.some(n => [...views[n].lines.values()].includes('hidden'));
    }

    // ── Isometric drawing ────────────────────────────────────────────────────
    // Viewer toward (+x, −y, +z): the front (−y), right (+x) and top faces
    // show. isoXY gives drawing coordinates with y pointing up.
    const ISO_DIR = [1, -1, 1];
    function isoXY([x, y, z]) { return [(x + y) / Math.SQRT2, (-x + y + 2 * z) / Math.sqrt(6)]; }

    // Visible faces in paint order (far to near). Cubes with the same
    // x − y + z never overlap on screen, so sorting on it is enough.
    function isoFaces(cubes) {
        const set = cubeSet(cubes);
        const has = (x, y, z) => set.has(key3(x, y, z));
        const order = cubes.slice().sort((a, b) => (a[0] - a[1] + a[2]) - (b[0] - b[1] + b[2]));
        const faces = [];
        for (const [x, y, z] of order) {
            if (!has(x, y, z + 1)) faces.push({ cube: [x, y, z], face: 'top',
                pts: [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]].map(isoXY) });
            if (!has(x, y - 1, z)) faces.push({ cube: [x, y, z], face: 'front',
                pts: [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]].map(isoXY) });
            if (!has(x + 1, y, z)) faces.push({ cube: [x, y, z], face: 'right',
                pts: [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]].map(isoXY) });
        }
        return faces;
    }

    // Cubes with no part of any face showing in the isometric drawing — the
    // only cubes you couldn't know are there without hidden lines. On the
    // isometric grid every face is exactly two triangles, each either fully
    // seen or fully covered, so one point per triangle decides it.
    const FACE_SAMPLES = {
        //       which face             points on it (two triangle centres)
        top:   { open: [0, 0, 1],  pts: (x, y, z) => [[x + 1/3, y + 1/3, z + 1], [x + 2/3, y + 2/3, z + 1]] },
        front: { open: [0, -1, 0], pts: (x, y, z) => [[x + 2/3, y, z + 1/3], [x + 1/3, y, z + 2/3]] },
        right: { open: [1, 0, 0],  pts: (x, y, z) => [[x + 1, y + 1/3, z + 1/3], [x + 1, y + 2/3, z + 2/3]] },
    };
    function isoObscuredCubes(cubes) {
        const set = cubeSet(cubes);
        return cubes.filter(([x, y, z]) => Object.values(FACE_SAMPLES).every(f =>
            set.has(key3(x + f.open[0], y + f.open[1], z + f.open[2])) ||
            f.pts(x, y, z).every(p => blocked(p, ISO_DIR, cubes))));
    }

    // Fully hidden cubes that sit exactly behind another cube in the drawing —
    // a cube k steps along (+1, −1, +1) lands on the same spot on paper.
    function isoHiddenBehind(cubes) {
        const set = cubeSet(cubes);
        const [W, D, H] = cubes.reduce((m, c) => m.map((v, i) => Math.max(v, c[i] + 1)), [0, 0, 0]);
        const reach = Math.max(W, D, H);
        return isoObscuredCubes(cubes).filter(([x, y, z]) => {
            for (let k = 1; k <= reach; k++) if (set.has(key3(x + k, y - k, z + k))) return true;
            return false;
        });
    }

    // Floor squares with no cube on them, as isometric polygons — drawn first
    // as a light grid so the drawing shows where the box's floor is.
    function isoFloorTiles(shape) {
        const set = cubeSet(shape.cubes);
        const [W, D] = shape.box;
        const tiles = [];
        for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) {
            if (set.has(key3(x, y, 0))) continue;
            tiles.push([[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]].map(isoXY));
        }
        return tiles;
    }

    // Edges of the drawing: [{ a: [x, y], b: [x, y], hidden }], visible winning
    // over hidden where two land on the same spot. Hidden edges are only kept
    // when they belong to a fully obscured cube (isoObscuredCubes) — like a
    // drafter, show what the drawing couldn't tell you otherwise. Pass
    // { allHidden: true } to keep every hidden edge.
    function isoEdges(shape, opts) {
        const all = !!(opts && opts.allHidden);
        const obscured = cubeSet(isoObscuredCubes(shape.cubes));
        const byKey = new Map();
        // Lattice coordinates (x + y, −x + y + 2z) are integers — exact keys.
        const lat = ([x, y, z]) => `${x + y},${-x + y + 2 * z}`;
        for (const edge of featureEdges(shape)) {
            const end = edge.p.slice(); end[edge.axis] += 1;
            const hidden = edgeHidden(edge, ISO_DIR, shape.cubes);
            if (hidden && !all && !touchesCube(edge, obscured)) continue;
            const [ka, kb] = [lat(edge.p), lat(end)].sort();
            const k = ka + '|' + kb;
            const prev = byKey.get(k);
            if (!prev) byKey.set(k, { a: isoXY(edge.p), b: isoXY(end), hidden });
            else if (!hidden) prev.hidden = false;
        }
        return [...byKey.values()];
    }

    // Is any of the four cube positions around this edge in the set?
    function touchesCube(edge, set) {
        const [a, b] = [0, 1, 2].filter(i => i !== edge.axis);
        for (const da of [-1, 0]) for (const db of [-1, 0]) {
            const c = edge.p.slice(); c[a] += da; c[b] += db;
            if (set.has(key3(...c))) return true;
        }
        return false;
    }

    // ── Grading ──────────────────────────────────────────────────────────────
    // A student's answer view has the same shape as a computed one: { cells, lines }.
    // Views are compared after sliding both to their lowest shaded cell, so
    // position on the grid doesn't matter — unless the tier requires the
    // three views to line up (align), which is checked separately.
    function offsetOf(view) {
        let mu = Infinity, mv = Infinity;
        for (const c of view.cells) {
            const [u, v] = c.split(',').map(Number);
            mu = Math.min(mu, u); mv = Math.min(mv, v);
        }
        return Number.isFinite(mu) ? [mu, mv] : null;
    }

    function normalize(view, hiddenGraded) {
        const off = offsetOf(view) || [0, 0];
        const cells = new Set([...view.cells].map(c => {
            const [u, v] = c.split(',').map(Number);
            return `${u - off[0]},${v - off[1]}`;
        }));
        const visible = new Set(), hidden = new Set();
        for (const [k, kind] of view.lines) {
            const [u1, v1, u2, v2] = k.split(',').map(Number);
            const nk = segKey(u1 - off[0], v1 - off[1], u2 - off[0], v2 - off[1]);
            (kind === 'visible' ? visible : hidden).add(nk);
        }
        return { cells, visible, hidden: hiddenGraded ? hidden : new Set() };
    }

    const setDiff = (a, b) => [...a].filter(x => !b.has(x));

    function shiftView(view, [du, dv]) {
        return {
            cells: new Set([...view.cells].map(c => {
                const [u, v] = c.split(',').map(Number);
                return `${u + du},${v + dv}`;
            })),
            lines: new Map([...view.lines].map(([k, kind]) => {
                const [u1, v1, u2, v2] = k.split(',').map(Number);
                return [segKey(u1 + du, v1 + dv, u2 + du, v2 + dv), kind];
            })),
        };
    }

    // Where to draw the correct view on the student's grid: the in-bounds
    // position that overlaps the student's answer most, preferring the one
    // that lines up lowest-left corners when several tie.
    function feedbackShift(correct, student) {
        const pts = [...correct.cells].map(c => c.split(',').map(Number));
        if (!pts.length) return [0, 0];
        const minU = Math.min(...pts.map(p => p[0])), maxU = Math.max(...pts.map(p => p[0]));
        const minV = Math.min(...pts.map(p => p[1])), maxV = Math.max(...pts.map(p => p[1]));
        const off = offsetOf(student) || [minU, minV];
        const pref = [off[0] - minU, off[1] - minV];
        const [U, V] = correct.size;
        let best = [0, 0], bestScore = -1, bestDist = Infinity;
        for (let du = -minU; du <= U - 1 - maxU; du++) {
            for (let dv = -minV; dv <= V - 1 - maxV; dv++) {
                const m = shiftView(correct, [du, dv]);
                const score = [...m.cells].filter(c => student.cells.has(c)).length
                    + [...m.lines.keys()].filter(k => student.lines.has(k)).length;
                const dist = Math.abs(du - pref[0]) + Math.abs(dv - pref[1]);
                if (score > bestScore || (score === bestScore && dist < bestDist)) {
                    best = [du, dv]; bestScore = score; bestDist = dist;
                }
            }
        }
        return best;
    }

    // Differences between the correct view and the student's, drawn on the
    // student's grid where it best matches their answer (always in bounds).
    function diffView(correct, student, hiddenGraded) {
        const moved = shiftView(correct, feedbackShift(correct, student));
        const want = (kind) => new Set([...moved.lines].filter(([, k]) => k === kind).map(([k]) => k));
        const have = (kind) => new Set([...student.lines].filter(([, k]) => k === kind).map(([k]) => k));
        const kinds = hiddenGraded ? ['visible', 'hidden'] : ['visible'];
        return {
            correct: moved,
            missingCells: setDiff(moved.cells, student.cells),
            extraCells:   setDiff(student.cells, moved.cells),
            missingLines: kinds.flatMap(k => setDiff(want(k), have(k)).map(s => ({ seg: s, kind: k }))),
            extraLines:   kinds.flatMap(k => setDiff(have(k), want(k)).map(s => ({ seg: s, kind: k }))),
        };
    }

    function viewsMatch(correct, student, hiddenGraded) {
        const a = normalize(correct, hiddenGraded), b = normalize(student, hiddenGraded);
        const eq = (s, t) => s.size === t.size && [...s].every(x => t.has(x));
        return b.cells.size > 0 && eq(a.cells, b.cells) && eq(a.visible, b.visible) && eq(a.hidden, b.hidden);
    }

    // Drafting alignment: top sits directly over front (same x), right sits
    // level with front (same z), and top's depth matches right's.
    function viewsAligned(student) {
        const f = offsetOf(student.front), r = offsetOf(student.right), t = offsetOf(student.top);
        return !!(f && r && t) && f[0] === t[0] && f[1] === r[1] && t[1] === r[0];
    }

    // Draw task: correct views vs the student's three drawn views.
    function gradeDrawing(shape, answer, tier) {
        const def = tierDef(tier);
        const views = computeViews(shape);
        const perView = Object.fromEntries(VIEW_NAMES.map(n => [n, viewsMatch(views[n], answer[n], def.hiddenGraded)]));
        const aligned = def.align ? viewsAligned(answer) : true;
        return { correct: VIEW_NAMES.every(n => perView[n]) && aligned, perView, aligned };
    }

    // Build task: any connected build whose views match the target's is right
    // (built anywhere in the box). build: { cubes }, in the target's box.
    function gradeBuild(shape, build) {
        const floating = floatingCubes(build.cubes);
        if (!build.cubes.length || floating.length) return { correct: false, perView: null, floating: floating.length };
        const want = computeViews(shape), got = computeViews({ box: shape.box, cubes: build.cubes });
        const perView = Object.fromEntries(VIEW_NAMES.map(n => [n, viewsMatch(want[n], got[n], true)]));
        return { correct: VIEW_NAMES.every(n => perView[n]), perView, floating: 0 };
    }

    // ── Shape generation ─────────────────────────────────────────────────────
    function randInt(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

    function growShape(def, rand) {
        const box = def.box;
        const n = randInt(rand, def.cubes[0], Math.min(def.cubes[1], box[0] * box[1] * box[2]));
        const cubes = [[randInt(rand, 0, box[0] - 1), randInt(rand, 0, box[1] - 1), 0]];
        const set = cubeSet(cubes);
        while (cubes.length < n) {
            const cand = new Map();
            for (const [x, y, z] of cubes) {
                for (const [dx, dy, dz] of NEIGHBORS) {
                    const c = [x + dx, y + dy, z + dz];
                    const k = key3(...c);
                    if (set.has(k) || !inBox(c, box)) continue;
                    if (def.stacksOnly && c[2] > 0 && !set.has(key3(c[0], c[1], c[2] - 1))) continue;
                    cand.set(k, c);
                }
            }
            if (!cand.size) break;
            const pick = [...cand.values()][Math.floor(rand() * cand.size)];
            cubes.push(pick);
            set.add(key3(...pick));
        }
        return { box: box.slice(), cubes };
    }

    // A view is "plain" when it's a filled rectangle with only its outline.
    function plainView(view) {
        const off = offsetOf(view);
        let mu = 0, mv = 0;
        for (const c of view.cells) {
            const [u, v] = c.split(',').map(Number);
            mu = Math.max(mu, u); mv = Math.max(mv, v);
        }
        const w = mu - off[0] + 1, h = mv - off[1] + 1;
        return view.cells.size === w * h && view.lines.size === 2 * (w + h);
    }

    function meetsTier(shape, def, views, strict) {
        if (VIEW_NAMES.filter(n => !plainView(views[n])).length < 2) return false;
        if (strict && def.noHidden && (hasHiddenLines(views) || isoObscuredCubes(shape.cubes).length)) return false;
        if (strict && def.hiddenBehind === false && isoHiddenBehind(shape.cubes).length) return false;
        return true;
    }

    // Random shape for a tier. Tries hard to meet every rule; if a rule turns
    // out to be too tight for the box, drops noHidden rather than fail.
    function generateShape(tier, rand) {
        rand = rand || Math.random;
        const def = tierDef(tier);
        for (const strict of [true, false]) {
            for (let i = 0; i < CONFIG.GENERATE_TRIES; i++) {
                const shape = growShape(def, rand);
                if (shape.cubes.length < def.cubes[0]) continue;
                if (meetsTier(shape, def, computeViews(shape), strict)) return shape;
            }
        }
        return growShape(def, rand);
    }

    // Task for one problem at this tier.
    function pickTask(tier, rand) {
        const t = tierDef(tier).task;
        if (!CONFIG.BUILD_ENABLED) return 'draw';
        return t === 'mixed' ? ((rand || Math.random)() < 0.5 ? 'draw' : 'build') : t;
    }

    // Is this a shape the tier could have produced? (Server-side sanity check.)
    function isValidShape(tier, shape) {
        const def = tierDef(tier);
        if (!shape || !Array.isArray(shape.cubes) || !shape.cubes.length) return false;
        if (shape.cubes.length > def.cubes[1]) return false;
        if (shape.cubes.some(c => !Array.isArray(c) || c.length !== 3 || !c.every(Number.isInteger) || !inBox(c, def.box))) return false;
        if (cubeSet(shape.cubes).size !== shape.cubes.length) return false;
        return floatingCubes(shape.cubes).length === 0;
    }

    // ── Problem codes ────────────────────────────────────────────────────────
    // A short code for a shape, for reporting and reloading a problem:
    // 'WDH-<base36 bitmask>', bit index x + W·(y + D·z).
    function encodeShape(shape) {
        const [W, D] = shape.box;
        let bits = 0n;
        for (const [x, y, z] of shape.cubes) bits |= 1n << BigInt(x + W * (y + D * z));
        return `${shape.box.join('')}-${bits.toString(36)}`;
    }
    function decodeShape(code) {
        const m = /^(\d)(\d)(\d)-([0-9a-z]+)$/i.exec(String(code || '').trim());
        if (!m) return null;
        const [W, D, H] = [m[1], m[2], m[3]].map(Number);
        let bits = 0n;
        for (const ch of m[4].toLowerCase()) bits = bits * 36n + BigInt(parseInt(ch, 36));
        const cubes = [];
        for (let z = 0; z < H; z++) for (let y = 0; y < D; y++) for (let x = 0; x < W; x++)
            if ((bits >> BigInt(x + W * (y + D * z))) & 1n) cubes.push([x, y, z]);
        return cubes.length ? { box: [W, D, H], cubes } : null;
    }

    // ── JSON forms (for storage and the API) ─────────────────────────────────
    function viewToJSON(view) {
        return {
            size: view.size,
            cells: [...view.cells].map(c => c.split(',').map(Number)),
            lines: [...view.lines].map(([k, kind]) => [...k.split(',').map(Number), kind === 'hidden' ? 'h' : 'v']),
        };
    }
    function viewFromJSON(j) {
        return {
            size: j.size || [0, 0],
            cells: new Set((j.cells || []).map(c => `${c[0]},${c[1]}`)),
            lines: new Map((j.lines || []).map(l => [segKey(l[0], l[1], l[2], l[3]), l[4] === 'h' ? 'hidden' : 'visible'])),
        };
    }

    const api = {
        TIERS, MAX_TIER, CONFIG, VIEW_NAMES,
        clampTier, tierDef, tierBase, maxScore, parMs, timeFactor, scoreAttempt, attemptPct,
        cubeSet, floatingCubes, rotateZ, featureEdges,
        computeView, computeViews, hasHiddenLines, segKey,
        isoXY, isoFaces, isoEdges, isoObscuredCubes, isoHiddenBehind, isoFloorTiles,
        offsetOf, viewsMatch, viewsAligned, diffView, gradeDrawing, gradeBuild,
        generateShape, pickTask, isValidShape, plainView,
        encodeShape, decodeShape, viewToJSON, viewFromJSON,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProjectionCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
