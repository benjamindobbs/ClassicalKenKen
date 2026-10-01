// Projections page. Rules, geometry and grading come from
// js/projection-core.js. Local mode picks a practice tier and saves nothing.
//
// Answer grids: click a square to shade it (its outline appears on its own),
// click a line to add or remove it, hover a line and press H (or use the
// Hidden lines button) to make it hidden. Submit checks all three views.

const PC = ProjectionCore;
const SVG_NS = 'http://www.w3.org/2000/svg';

const PJ = {
    PAD: 10,           // px around each grid
    HIT_PX: 8,         // how close to a line counts as clicking the line (mouse)
    HIT_PX_TOUCH: 14,
    ADVANCE_MS: 1400,  // pause on a correct answer before the next problem
    ISO_MAX_PX: 320,
};

const pj = {
    local: true,
    tier: 1,
    task: 'draw',
    shape: null,
    views: null,          // correct views (computed)
    answer: null,         // { front, right, top } answer state
    cell: 48,             // grid cell size in px for this problem
    phase: 'idle',        // 'idle' | 'answer' | 'feedback'
    hiddenMode: false,
    hover: null,          // { view, kind: 'cell'|'seg', key }
    diffs: null,          // per-view diff shown after a wrong answer
    perView: null,
    startedAt: 0,
    timerId: null,
    advanceId: null,
    helpMounted: false,
};

// ── Sign-in / local mode ─────────────────────────────────────────────────────
// Saving progress arrives with the server work; until then signed-in
// students practice like local mode.
function onSignedIn() { onLocalMode(); }

function onLocalMode() {
    pj.local = true;
    const sel = document.getElementById('pj-local-tier-select');
    sel.innerHTML = '';
    for (let t = 1; t <= PC.MAX_TIER; t++) {
        const o = document.createElement('option');
        o.value = String(t);
        o.textContent = `Tier ${t}`;
        sel.appendChild(o);
    }
    sel.value = String(pj.tier);
    document.getElementById('pj-local-tier').style.display = '';
    renderTierLabel();
}

function setLocalTier(v) {
    pj.tier = PC.clampTier(v);
    document.getElementById('pj-local-tier-select').value = String(pj.tier);
    renderTierLabel();
    if (pj.phase !== 'idle') nextProblem();
}

function renderTierLabel() {
    const el = document.getElementById('pj-tier-label');
    if (el) el.textContent = `Tier ${pj.tier} of ${PC.MAX_TIER} · par ${fmtTime(PC.parMs(pj.tier))}`;
}

function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Game flow ────────────────────────────────────────────────────────────────
function launchProjections() {
    if (!pj.local && typeof ClassPicker !== 'undefined' && ClassPicker.needsChoice()) {
        ClassPicker.flash();
        return;
    }
    document.getElementById('pj-start-screen').style.display = 'none';
    document.getElementById('pj-game-area').style.display = '';
    if (!pj.helpMounted) { mountHelp(); pj.helpMounted = true; initGrids(); }
    nextProblem();
}

function emptyAnswerView(size) {
    return { size, cells: new Set(), lines: new Map(), auto: new Set(), suppressed: new Set() };
}

function nextProblem() {
    clearTimeout(pj.advanceId);
    const linked = takeLinkedShape();   // may switch the tier
    const def = PC.tierDef(pj.tier);
    // Builder tiers arrive with the build task; until then practice drawing.
    pj.task = 'draw';
    pj.shape = linked || PC.generateShape(pj.tier);
    document.getElementById('pj-code').textContent = PC.encodeShape(pj.shape);
    pj.views = PC.computeViews(pj.shape);
    pj.answer = Object.fromEntries(PC.VIEW_NAMES.map(n => [n, emptyAnswerView(pj.views[n].size)]));
    pj.diffs = null;
    pj.perView = null;
    pj.hover = null;

    const maxDim = Math.max(...def.box);
    pj.cell = Math.max(36, Math.min(56, Math.floor(220 / maxDim)));

    document.getElementById('pj-task-title').textContent = 'Draw the front, right side and top views';
    document.getElementById('pj-task-sub').textContent = subtitleFor(def);
    setFeedback('', '');
    document.getElementById('pj-legend').style.display = 'none';
    document.getElementById('pj-next').style.display = 'none';
    document.getElementById('pj-submit').style.display = '';
    document.getElementById('pj-clear-all').disabled = false;
    announceRules(def);

    drawIso();
    PC.VIEW_NAMES.forEach(renderGrid);
    renderLabels();

    pj.phase = 'answer';
    pj.startedAt = performance.now();
    clearInterval(pj.timerId);
    pj.timerId = setInterval(renderTimer, 500);
    renderTimer();
}

// A problem opened from a link (?shape=CODE[&tier=N]) is used once, for the
// first problem — for reporting and replaying a specific shape.
let _linkedShape = (() => {
    try {
        const q = new URLSearchParams(location.search);
        const shape = PC.decodeShape(q.get('shape'));
        if (!shape) return null;
        const byBox = PC.TIERS.find(t => t && t.box.join() === shape.box.join());
        const tier = PC.clampTier(q.get('tier') || (byBox ? byBox.tier : 1));
        return { shape, tier };
    } catch (_) { return null; }
})();

function takeLinkedShape() {
    if (!_linkedShape) return null;
    const { shape, tier } = _linkedShape;
    _linkedShape = null;
    if (tier !== pj.tier) {
        pj.tier = tier;
        const sel = document.getElementById('pj-local-tier-select');
        if (sel) sel.value = String(tier);
        renderTierLabel();
    }
    return shape;
}

function copyProblemCode() {
    const code = document.getElementById('pj-code').textContent;
    const done = () => setFeedback(`Copied problem code ${code}`, '');
    try { navigator.clipboard.writeText(code).then(done, done); } catch (_) { done(); }
}

function subtitleFor(def) {
    const parts = [];
    if (def.hiddenGraded) parts.push('hidden lines count');
    else if (!def.noHidden) parts.push('hidden lines are shown but not graded yet');
    if (def.align) parts.push('views must line up');
    return parts.length ? `This tier: ${parts.join(' · ')}.` : 'Shade the squares each view shows and add any lines inside them.';
}

function renderTimer() {
    document.getElementById('pj-time').textContent = fmtTime(performance.now() - pj.startedAt);
}

function setFeedback(text, kind) {
    const fb = document.getElementById('pj-feedback');
    fb.textContent = text;
    fb.className = 'pj-feedback' + (kind ? ` pj-feedback--${kind}` : '');
}

function clearAll() {
    if (pj.phase !== 'answer') return;
    PC.VIEW_NAMES.forEach(n => { pj.answer[n] = emptyAnswerView(pj.answer[n].size); renderGrid(n); });
}

function clearView(name) {
    if (pj.phase !== 'answer') return;
    pj.answer[name] = emptyAnswerView(pj.answer[name].size);
    renderGrid(name);
}

function toggleHiddenMode() {
    pj.hiddenMode = !pj.hiddenMode;
    document.getElementById('pj-hidden-mode').classList.toggle('active', pj.hiddenMode);
}

function submitAnswer() {
    if (pj.phase !== 'answer') return;
    const def = PC.tierDef(pj.tier);
    if (!PC.VIEW_NAMES.every(n => pj.answer[n].cells.size)) {
        setFeedback('Shade at least one square in each view first.', 'wrong');
        return;
    }

    pj.phase = 'feedback';
    clearInterval(pj.timerId);
    const timeMs = Math.round(performance.now() - pj.startedAt);
    const result = PC.gradeDrawing(pj.shape, pj.answer, pj.tier);
    pj.perView = result.perView;
    pj.hover = null;
    document.getElementById('pj-submit').style.display = 'none';
    document.getElementById('pj-clear-all').disabled = true;

    if (result.correct) {
        setFeedback(`Correct! +${PC.scoreAttempt(pj.tier, true, timeMs)}`, 'correct');
        PC.VIEW_NAMES.forEach(renderGrid);
        renderLabels();
        pj.advanceId = setTimeout(nextProblem, PJ.ADVANCE_MS);
        return;
    }

    pj.diffs = Object.fromEntries(PC.VIEW_NAMES
        .filter(n => !result.perView[n])
        .map(n => [n, PC.diffView(pj.views[n], pj.answer[n], def.hiddenGraded)]));
    const wrong = PC.VIEW_NAMES.filter(n => !result.perView[n]);
    const names = { front: 'front', right: 'right side', top: 'top' };
    let msg;
    if (!wrong.length && !result.aligned) {
        msg = 'Each view is right, but they don\'t line up: the top view must sit directly above the front, and the right side level with it.';
    } else {
        msg = `Not quite — check the ${wrong.map(n => names[n]).join(', ')} view${wrong.length > 1 ? 's' : ''}. The correct marks are shown in gold.`;
    }
    setFeedback(msg, 'wrong');
    document.getElementById('pj-legend').style.display = wrong.length ? '' : 'none';
    PC.VIEW_NAMES.forEach(renderGrid);
    renderLabels();
    const next = document.getElementById('pj-next');
    next.style.display = '';
    next.focus({ preventScroll: true });
}

function renderLabels() {
    document.querySelectorAll('[data-label]').forEach(el => {
        const n = el.dataset.label;
        const base = { front: 'Front', right: 'Right side', top: 'Top' }[n];
        const mark = pj.perView ? (pj.perView[n] ? '<span class="pj-ok">✓</span>' : '<span class="pj-bad">✗</span>') : '';
        el.innerHTML = base + mark;
    });
}

// ── Answer grids ─────────────────────────────────────────────────────────────
function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
}

function initGrids() {
    for (const name of PC.VIEW_NAMES) {
        const svg = document.getElementById(`pj-grid-${name}`);
        svg.addEventListener('pointermove', e => {
            if (pj.phase !== 'answer') return;
            setHover(name, targetFromEvent(name, e));
        });
        svg.addEventListener('pointerleave', () => { if (pj.hover && pj.hover.view === name) setHover(null); });
        svg.addEventListener('pointerdown', e => {
            if (pj.phase !== 'answer' || (e.pointerType === 'mouse' && e.button !== 0)) return;
            e.preventDefault();
            const t = targetFromEvent(name, e);
            if (!t) return;
            applyClick(name, t);
            // Keep the hover on what was just clicked (touch has no hover).
            setHover(e.pointerType === 'mouse' ? name : null, t);
        });
    }
    document.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => clearView(b.dataset.clear)));
    document.addEventListener('keydown', e => {
        if (pj.phase !== 'answer' || !pj.hover || pj.hover.kind !== 'seg') return;
        if (e.key === 'h' || e.key === 'H') { e.preventDefault(); toggleHidden(pj.hover.view, pj.hover.key); }
    });
}

function gridGeom(name) {
    const [U, V] = pj.answer[name].size;
    const s = pj.cell, p = PJ.PAD;
    return { U, V, s, p, X: u => p + u * s, Y: v => p + (V - v) * s };
}

// Which cell or line is under the pointer.
function targetFromEvent(name, e) {
    const svg = document.getElementById(`pj-grid-${name}`);
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const { U, V, s, p } = gridGeom(name);
    const u = (loc.x - p) / s, v = V - (loc.y - p) / s;
    const thr = (e.pointerType === 'mouse' ? PJ.HIT_PX : PJ.HIT_PX_TOUCH) / s;
    if (u < -thr || v < -thr || u > U + thr || v > V + thr) return null;

    const ru = Math.round(u), rv = Math.round(v);
    const du = Math.abs(u - ru), dv = Math.abs(v - rv);
    const clampU = x => Math.max(0, Math.min(U - 1, Math.floor(x)));
    const clampV = x => Math.max(0, Math.min(V - 1, Math.floor(x)));
    if (du <= thr && du <= dv && ru >= 0 && ru <= U) {
        const fv = clampV(v);
        return { kind: 'seg', key: PC.segKey(ru, fv, ru, fv + 1) };
    }
    if (dv <= thr && rv >= 0 && rv <= V) {
        const fu = clampU(u);
        return { kind: 'seg', key: PC.segKey(fu, rv, fu + 1, rv) };
    }
    if (u < 0 || v < 0 || u >= U || v >= V) return null;
    return { kind: 'cell', key: `${Math.floor(u)},${Math.floor(v)}` };
}

function setHover(name, t) {
    const prev = pj.hover && pj.hover.view;
    pj.hover = name && t ? { view: name, ...t } : null;
    if (prev && prev !== name) renderGrid(prev);
    if (name) renderGrid(name);
}

// Unit segments on the edge of the shaded region.
function outline(cells) {
    const segs = new Set();
    const has = (u, v) => cells.has(`${u},${v}`);
    for (const c of cells) {
        const [u, v] = c.split(',').map(Number);
        if (!has(u - 1, v)) segs.add(PC.segKey(u, v, u, v + 1));
        if (!has(u + 1, v)) segs.add(PC.segKey(u + 1, v, u + 1, v + 1));
        if (!has(u, v - 1)) segs.add(PC.segKey(u, v, u + 1, v));
        if (!has(u, v + 1)) segs.add(PC.segKey(u, v + 1, u + 1, v + 1));
    }
    return segs;
}

// Keeps the outline lines in step with the shading. Lines the student set or
// removed themselves are left alone.
function syncOutline(a) {
    const edge = outline(a.cells);
    for (const k of [...a.auto]) {
        if (!edge.has(k)) { a.auto.delete(k); a.lines.delete(k); }
    }
    for (const k of [...a.suppressed]) if (!edge.has(k)) a.suppressed.delete(k);
    for (const k of edge) {
        if (!a.lines.has(k) && !a.suppressed.has(k)) { a.lines.set(k, 'visible'); a.auto.add(k); }
    }
}

function applyClick(name, t) {
    const a = pj.answer[name];
    if (t.kind === 'cell') {
        if (a.cells.has(t.key)) a.cells.delete(t.key); else a.cells.add(t.key);
        syncOutline(a);
    } else if (pj.hiddenMode) {
        toggleHidden(name, t.key);
        return;
    } else {
        // Plain click: line on (visible) / off.
        a.auto.delete(t.key);
        if (a.lines.has(t.key)) {
            a.lines.delete(t.key);
            if (outline(a.cells).has(t.key)) a.suppressed.add(t.key);
        } else {
            a.lines.set(t.key, 'visible');
            a.suppressed.delete(t.key);
        }
    }
    renderGrid(name);
}

// H / Hidden mode: off → hidden, visible → hidden, hidden → off.
function toggleHidden(name, key) {
    const a = pj.answer[name];
    a.auto.delete(key);
    if (a.lines.get(key) === 'hidden') {
        a.lines.delete(key);
        if (outline(a.cells).has(key)) a.suppressed.add(key);
    } else {
        a.lines.set(key, 'hidden');
        a.suppressed.delete(key);
    }
    renderGrid(name);
}

function renderGrid(name) {
    const svg = document.getElementById(`pj-grid-${name}`);
    const a = pj.answer[name];
    const { U, V, s, p, X, Y } = gridGeom(name);
    const w = U * s + 2 * p, h = V * s + 2 * p;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.innerHTML = '';

    const seg = (k, cls) => {
        const [u1, v1, u2, v2] = k.split(',').map(Number);
        return svgEl('line', { x1: X(u1), y1: Y(v1), x2: X(u2), y2: Y(v2), class: cls }, svg);
    };
    const cellRect = (k, cls) => {
        const [u, v] = k.split(',').map(Number);
        return svgEl('rect', { x: X(u), y: Y(v + 1), width: s, height: s, class: cls }, svg);
    };

    for (let u = 0; u <= U; u++) svgEl('line', { x1: X(u), x2: X(u), y1: Y(0), y2: Y(V), class: 'pj-gridline' }, svg);
    for (let v = 0; v <= V; v++) svgEl('line', { x1: X(0), x2: X(U), y1: Y(v), y2: Y(v), class: 'pj-gridline' }, svg);
    svgEl('rect', { x: X(0), y: Y(V), width: U * s, height: V * s, class: 'pj-gridframe' }, svg);

    for (const k of a.cells) cellRect(k, 'pj-cell');
    const d = pj.diffs && pj.diffs[name];
    if (d) {
        d.missingCells.forEach(k => cellRect(k, 'pj-miss-cell'));
        d.extraCells.forEach(k => cellRect(k, 'pj-extra-cell'));
    }
    if (pj.hover && pj.hover.view === name && pj.hover.kind === 'cell') cellRect(pj.hover.key, 'pj-hover-cell');

    // Hidden first so a visible line drawn over the same spot wins.
    const lines = [...a.lines].sort((x, y) => (x[1] === 'visible') - (y[1] === 'visible'));
    for (const [k, kind] of lines) seg(k, kind === 'hidden' ? 'pj-line pj-line--hidden' : 'pj-line');
    if (d) {
        d.extraLines.forEach(l => seg(l.seg, 'pj-extra-line' + (l.kind === 'hidden' ? ' pj-line--hidden' : '')));
        d.missingLines.forEach(l => seg(l.seg, 'pj-miss-line' + (l.kind === 'hidden' ? ' pj-line--hidden' : '')));
    }
    if (pj.hover && pj.hover.view === name && pj.hover.kind === 'seg') seg(pj.hover.key, 'pj-hover-line');
    svgEl('rect', { x: 0, y: 0, width: w, height: h, class: 'pj-hit' }, svg);
}

// ── Isometric drawing ────────────────────────────────────────────────────────
function drawIso() {
    const svg = document.getElementById('pj-iso');
    svg.innerHTML = '';
    const [W, D, H] = pj.shape.box;
    // Scale from the tier's whole box (so cube size is steady within a tier),
    // framed on this shape and its floor.
    const extent = pts => [Math.min(...pts.map(c => c[0])), Math.max(...pts.map(c => c[0])),
                           Math.min(...pts.map(c => c[1])), Math.max(...pts.map(c => c[1]))];
    const boxCorners = [];
    for (const x of [0, W]) for (const y of [0, D]) for (const z of [0, H]) boxCorners.push(PC.isoXY([x, y, z]));
    const [bx0, bx1, by0, by1] = extent(boxCorners);
    const scale = Math.min(PJ.ISO_MAX_PX / (bx1 - bx0), PJ.ISO_MAX_PX / (by1 - by0), pj.cell * 1.1);
    const shapeCorners = pj.shape.cubes.flatMap(([x, y, z]) =>
        [[x, y, z], [x + 1, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x, y, z + 1], [x + 1, y, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z + 1]]
            .map(PC.isoXY));
    // …plus the floor grid, which covers the whole box footprint.
    const floorCorners = [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]].map(PC.isoXY);
    const [minX, maxX, minY, maxY] = extent(shapeCorners.concat(floorCorners));
    const pad = 8;
    const w = (maxX - minX) * scale + 2 * pad, h = (maxY - minY) * scale + 2 * pad;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    const T = ([x, y]) => [pad + (x - minX) * scale, pad + (maxY - y) * scale];

    // Light floor grid on the empty bottom-layer squares, drawn first so cubes cover it.
    for (const tile of PC.isoFloorTiles(pj.shape)) {
        svgEl('polygon', { points: tile.map(T).map(p => p.join(',')).join(' '), class: 'pj-floor' }, svg);
    }
    for (const f of PC.isoFaces(pj.shape.cubes)) {
        svgEl('polygon', { points: f.pts.map(T).map(p => p.join(',')).join(' '), class: `pj-face-${f.face}` }, svg);
    }
    // Only hidden lines that matter: edges of cubes the drawing hides completely.
    const edges = PC.isoEdges(pj.shape);
    for (const e of edges.filter(e => e.hidden)) {
        const [a, b] = [T(e.a), T(e.b)];
        svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'pj-iso-line pj-iso-line--hidden' }, svg);
    }
    for (const e of edges.filter(e => !e.hidden)) {
        const [a, b] = [T(e.a), T(e.b)];
        svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'pj-iso-line' }, svg);
    }
}

// ── How to play ──────────────────────────────────────────────────────────────
function mountHelp() {
    const P = PC.CONFIG.PROGRESSION;
    const pct = v => `${Math.round(v * 100)}%`;
    HowToPlay.mount(document.getElementById('pj-help'), {
        id: 'projections',
        sections: {
            draw: `
                <h3>Your task</h3>
                <p>The isometric drawing (top right) shows an object made of cubes. Draw what you'd see looking at it from the <strong>front</strong>, the <strong>right side</strong> and the <strong>top</strong>. The views are laid out the standard US way: top directly above front, right side to the right of front.</p>
                <h3>Controls</h3>
                <ul>
                    <li><strong>Click a square</strong> to shade it. The outline of the shaded area draws itself.</li>
                    <li><strong>Click a line</strong> to add or remove it — use this for lines <em>inside</em> the shape, where one surface steps in front of another.</li>
                    <li><strong>Hover a line and press <kbd>H</kbd></strong> to make it a hidden (dashed) line; press <kbd>H</kbd> again to remove it. On a touchscreen, turn on <strong>Hidden lines</strong> and tap.</li>
                    <li><strong>Clear</strong> resets one view; <strong>Submit</strong> checks all three at once.</li>
                </ul>
                <h3>Checking</h3>
                <p>Each view is checked for its shaded squares and its lines. Where you place a view on its grid doesn't matter — until the higher tiers, where the views must line up with each other. If something's wrong, the correct marks appear in gold and extra ones in red; press <strong>Next</strong> when you're ready.</p>
                <h3>Scoring and tiers</h3>
                <p>Correct answers at or under the tier's <strong>par</strong> time (shown next to the tier) earn full points; slower ones earn less. Move up by getting ${pct(P.PROMOTE_ACCURACY)} of your last ${P.WINDOW} right while averaging ${pct(P.PROMOTE_SCORE_PCT)} of the possible points — or by getting ${P.STREAK} right in a row. Averaging below ${pct(P.DEMOTE_SCORE_PCT)} moves you back a tier.</p>`,
        },
    });
}

// Rules that switch on at a tier get a one-time note in the help panel.
function announceRules(def) {
    if (!def.noHidden && !def.hiddenGraded) {
        HowToPlay.announce('hidden-shown', '<p><strong>Hidden lines now appear</strong> as dashed lines in the drawing — edges you can\'t see from where you\'re looking. You don\'t need to draw them yet.</p>');
    }
    if (def.hiddenGraded) {
        HowToPlay.announce('hidden-graded', '<p><strong>Hidden lines now count.</strong> Draw them as dashed lines: hover a line and press <kbd>H</kbd>, or use the Hidden lines button.</p>');
    }
    if (def.align) {
        HowToPlay.announce('alignment', '<p><strong>Views must now line up.</strong> Put the top view directly above the front view, and the right side view level with the front — the way they would be on a real drawing.</p>');
    }
}
