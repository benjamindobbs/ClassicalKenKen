// Tests for js/projection-core.js. Run: node tools/test-projection-core.js
const assert = require('assert');
const P = require('../js/projection-core');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const shape = (box, cubes) => ({ box, cubes });
const sorted = s => [...s].sort();
const linesOf = (view, kind) => [...view.lines].filter(([, k]) => k === kind).map(([s]) => s).sort();
// Deterministic PRNG so generator tests are repeatable.
function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ── Views ────────────────────────────────────────────────────────────────────
test('single cube: each view is one square with its outline', () => {
    const v = P.computeViews(shape([2, 2, 2], [[0, 0, 0]]));
    for (const n of P.VIEW_NAMES) {
        assert.deepStrictEqual(sorted(v[n].cells), ['0,0']);
        assert.deepStrictEqual(linesOf(v[n], 'visible'), ['0,0,0,1', '0,0,1,0', '0,1,1,1', '1,0,1,1']);
        assert.deepStrictEqual(linesOf(v[n], 'hidden'), []);
    }
});

test('two stacked cubes: no line between them (same face plane)', () => {
    const v = P.computeViews(shape([2, 2, 2], [[0, 0, 0], [0, 0, 1]]));
    assert.deepStrictEqual(sorted(v.front.cells), ['0,0', '0,1']);
    assert.ok(!v.front.lines.has('0,1,1,1'), 'no seam at z=1');
    assert.strictEqual(v.front.lines.size, 6);
});

test('view orientation: right view has the front on the left, top view has the front at the bottom', () => {
    // A front cube and a two-high stack behind it.
    const v = P.computeViews(shape([2, 2, 2], [[0, 0, 0], [0, 1, 0], [0, 1, 1]]));
    assert.deepStrictEqual(sorted(v.right.cells), ['0,0', '1,0', '1,1']);   // tall part at u=1 (back)
    assert.deepStrictEqual(sorted(v.top.cells), ['0,0', '0,1']);
    // Front view: the front cube's top edge is a visible line across the middle.
    assert.strictEqual(v.front.lines.get('0,1,1,1'), 'visible');
});

test('hidden line: a short cube behind a tall stack shows dashed in the front view', () => {
    const v = P.computeViews(shape([2, 2, 2], [[0, 0, 0], [0, 0, 1], [0, 1, 0]]));
    assert.strictEqual(v.front.lines.get('0,1,1,1'), 'hidden');
    assert.ok(P.hasHiddenLines(v));
    assert.deepStrictEqual(linesOf(v.right, 'hidden'), []);
});

test('visible wins where a visible and hidden line overlap', () => {
    // Stepped block: front row one high, back row two high; the back row's
    // top-front edge is visible at the same place as nothing hidden.
    const v = P.computeViews(shape([2, 2, 2], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]]));
    // Front view: middle line at z=1 comes from the front row's top edge (visible)
    // and the back row's (hidden, same spot) — visible wins.
    assert.strictEqual(v.front.lines.get('0,1,1,1'), 'visible');
    assert.strictEqual(v.front.lines.get('1,1,2,1'), 'visible');
    assert.deepStrictEqual(linesOf(v.front, 'hidden'), []);
});

test('depth step between side-by-side stacks is a visible line in the front view', () => {
    // Left cube at the front, right cube one row back, same height.
    const v = P.computeViews(shape([2, 2, 1], [[0, 0, 0], [1, 1, 0], [0, 1, 0]]));
    assert.strictEqual(v.front.lines.get('1,0,1,1'), 'visible');
});

// ── Isometric ────────────────────────────────────────────────────────────────
test('isometric single cube: 9 visible edges, 3 hidden, 3 faces', () => {
    const s = shape([1, 1, 1], [[0, 0, 0]]);
    const edges = P.isoEdges(s);
    assert.strictEqual(edges.length, 12);
    assert.strictEqual(edges.filter(e => e.hidden).length, 3);
    assert.strictEqual(P.isoFaces(s.cubes).length, 3);
});

test('isometric: a cube hidden behind another has only hidden edges', () => {
    // (0,1,0) is directly behind-left-below along the view line of (1,0,1)? Use a
    // cube fully enclosed from the viewer's side by a 2×2×2 block's front.
    const block = [];
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) block.push([x, y, z]);
    const edges = P.isoEdges(shape([2, 2, 2], block));
    // A solid 2×2×2 cube draws like one big cube: 9 visible long edges (18 unit
    // segments) and 3 hidden long edges (6 unit segments).
    assert.strictEqual(edges.filter(e => !e.hidden).length, 18);
    assert.strictEqual(edges.filter(e => e.hidden).length, 6);
});

test('isometric concave corner edges are visible', () => {
    // L-shape on the floor: the inside corner edge faces the viewer.
    const edges = P.isoEdges(shape([2, 2, 1], [[0, 0, 0], [1, 0, 0], [1, 1, 0]]));
    const inner = P.isoXY([1, 1, 0]), innerTop = P.isoXY([1, 1, 1]);
    const e = edges.find(x => [x.a, x.b].every(pt => [inner, innerTop].some(q => Math.abs(q[0] - pt[0]) < 1e-9 && Math.abs(q[1] - pt[1]) < 1e-9)));
    assert.ok(e, 'inside corner edge exists');
});

// ── Grading ──────────────────────────────────────────────────────────────────
const L = shape([3, 3, 3], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]]);

test('exact views grade correct; translated views too (no alignment rule)', () => {
    const v = P.computeViews(L);
    assert.ok(P.gradeDrawing(L, v, 4).correct);
    const shifted = {};
    for (const n of P.VIEW_NAMES) {
        shifted[n] = P.viewFromJSON(P.viewToJSON(v[n]));
        shifted[n] = {
            cells: new Set([...shifted[n].cells].map(c => c.split(',').map(Number)).map(([u, w]) => `${u + 1},${w}`)),
            lines: new Map([...shifted[n].lines].map(([k, kind]) => {
                const [a, b, c, d] = k.split(',').map(Number);
                return [P.segKey(a + 1, b, c + 1, d), kind];
            })),
        };
    }
    assert.ok(P.gradeDrawing(L, shifted, 4).correct, 'position on grid does not matter');
    assert.ok(!P.gradeDrawing(L, shifted, 7).correct, 'alignment tier: front/top shifted but right not → misaligned');
});

test('missing a line, an extra cell, or wrong hidden marking fail as expected', () => {
    const s = shape([2, 2, 2], [[0, 0, 0], [0, 0, 1], [0, 1, 0]]);
    const v = P.computeViews(s);
    const clone = () => Object.fromEntries(P.VIEW_NAMES.map(n => [n, P.viewFromJSON(P.viewToJSON(v[n]))]));

    let a = clone(); a.top.lines.delete([...a.top.lines.keys()][0]);
    assert.ok(!P.gradeDrawing(s, a, 4).correct, 'missing line');

    a = clone(); a.front.cells.add('1,0');
    assert.ok(!P.gradeDrawing(s, a, 4).correct, 'extra cell');

    // Hidden line left off: fine while hidden lines aren't graded (tier 4), wrong at tier 6.
    a = clone(); a.front.lines.delete('0,1,1,1');
    assert.ok(P.gradeDrawing(s, a, 4).correct, 'hidden not graded at T4');
    assert.ok(!P.gradeDrawing(s, a, 6).correct, 'hidden graded at T6');

    // Marking the hidden line as visible is wrong at any tier.
    a = clone(); a.front.lines.set('0,1,1,1', 'visible');
    assert.ok(!P.gradeDrawing(s, a, 4).correct);
});

test('diffView reports missing and extra marks in the student grid position', () => {
    const s = shape([2, 2, 2], [[0, 0, 0], [1, 0, 0]]);
    const v = P.computeViews(s);
    const student = { cells: new Set(['0,0']), lines: new Map([['0,0,1,0', 'visible']]) };
    const d = P.diffView(v.front, student, false);
    assert.deepStrictEqual(d.missingCells, ['1,0']);
    assert.ok(d.missingLines.length > 0);
    assert.deepStrictEqual(d.extraCells, []);
});

test('builds: matching views are accepted anywhere in the box; wrong or floating builds are not', () => {
    const target = shape([3, 3, 2], [[0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]]);
    assert.ok(P.gradeBuild(target, { cubes: target.cubes }).correct);
    const moved = target.cubes.map(([x, y, z]) => [x + 1, y + 1, z]);
    assert.ok(P.gradeBuild(target, { cubes: moved }).correct, 'same build one square over');
    assert.ok(!P.gradeBuild(target, { cubes: [[0, 0, 0]] }).correct);
    const floating = { cubes: [[0, 0, 0], [1, 1, 1]] };
    const g = P.gradeBuild(target, floating);
    assert.ok(!g.correct && g.floating === 1);
});

test('floatingCubes: overhang connected through a side counts as connected', () => {
    assert.deepStrictEqual(P.floatingCubes([[0, 0, 0], [0, 0, 1], [1, 0, 1]]), []);
    assert.deepStrictEqual(P.floatingCubes([[0, 0, 0], [1, 1, 1]]), [[1, 1, 1]]);
    // Edge contact only isn't a connection.
    assert.deepStrictEqual(P.floatingCubes([[0, 0, 0], [1, 0, 1]]), [[1, 0, 1]]);
});

test('rotateZ: four quarter turns come back to the start', () => {
    const r = P.rotateZ(P.rotateZ(L, 2), 2);
    assert.deepStrictEqual(r.cubes, L.cubes);
    const q = P.rotateZ(shape([3, 2, 1], [[2, 0, 0]]), 1);
    assert.deepStrictEqual(q.box, [2, 3, 1]);
    assert.deepStrictEqual(q.cubes, [[1, 2, 0]]);
});

// ── Generator ────────────────────────────────────────────────────────────────
test('generator meets each tier\'s rules', () => {
    const rand = mulberry32(12345);
    for (let tier = 1; tier <= P.MAX_TIER; tier++) {
        const def = P.tierDef(tier);
        let relaxed = 0;
        for (let i = 0; i < 40; i++) {
            const s = P.generateShape(tier, rand);
            assert.ok(P.isValidShape(tier, s), `T${tier} valid shape`);
            assert.ok(s.cubes.length >= def.cubes[0] && s.cubes.length <= def.cubes[1], `T${tier} cube count ${s.cubes.length}`);
            if (def.stacksOnly) {
                const set = P.cubeSet(s.cubes);
                assert.ok(s.cubes.every(([x, y, z]) => z === 0 || set.has(`${x},${y},${z - 1}`)), `T${tier} stacks only`);
            }
            const views = P.computeViews(s);
            assert.ok(P.VIEW_NAMES.filter(n => !P.plainView(views[n])).length >= 2, `T${tier} not trivial`);
            if (def.noHidden && P.hasHiddenLines(views)) relaxed++;
        }
        assert.strictEqual(relaxed, 0, `T${tier}: no-hidden rule had to be relaxed ${relaxed}/40 times`);
    }
});

// ── Scoring ──────────────────────────────────────────────────────────────────
test('scoring: par, slower, floor, wrong', () => {
    assert.strictEqual(P.scoreAttempt(1, true, 60000), 25);
    assert.strictEqual(P.scoreAttempt(1, true, 120000), 13);
    assert.strictEqual(P.scoreAttempt(8, true, 154000), 200);
    assert.strictEqual(P.scoreAttempt(8, true, 10 * 154000), 50);
    assert.strictEqual(P.scoreAttempt(8, false, 1000), 0);
});

console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
