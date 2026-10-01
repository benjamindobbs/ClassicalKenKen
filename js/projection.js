// Projections page. Rules, geometry and grading come from
// js/projection-core.js. Signed in, the server serves, times and grades each
// problem and owns the student's tier (server/projection.js); the page uses
// the same core to draw the gold/red feedback. Local mode picks a practice
// tier and saves nothing.
//
// Draw problems (isometric → three views): click a square to shade it (its
// outline appears on its own), click a line to add or remove it, hover a line
// and press H (or use the Hidden lines button) to make it hidden. Submit
// checks all three views.
//
// Build problems (three views → cubes): the isometric panel becomes a
// builder. Click a face to add a cube against it (Shift/right-click or Remove
// mode takes one away), or use the keyboard cursor: arrows move it within a
// layer, +/- change layer, Space adds/removes, Q/E turn the drawing.

const PC = ProjectionCore;
const SVG_NS = 'http://www.w3.org/2000/svg';

const PJ = {
    PAD: 10,           // px around each grid
    HIT_PX: 8,         // how close to a line counts as clicking the line (mouse)
    HIT_PX_TOUCH: 14,
    ADVANCE_MS: 1400,  // pause on a correct answer before the next problem
    ISO_MAX_PX: 320,
    BUILD_MAX_PX: 380,
};

const pj = {
    local: true,
    tier: 1,
    task: 'draw',
    shape: null,          // target shape (build problems from the server: only after submitting)
    box: null,            // the problem's box [W, D, H]
    views: null,          // correct views (computed)
    answer: null,         // { front, right, top } answer state (draw)
    build: null,          // builder state (build) — see newBuild()
    buildViews: null,     // views of the submitted build (build feedback)
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
    problemId: null,      // server problem being answered (signed in)
    loading: false,
};

// ── Sign-in / local mode ─────────────────────────────────────────────────────
async function onSignedIn() {
    pj.local = false;
    document.getElementById('pj-local-tier').style.display = 'none';
    try {
        const res = await authFetch('/api/projection/status');
        if (res.ok) applyStatus(await res.json());
    } catch (_) {}

    await ClassPicker.init('projection');
    const slot = document.getElementById('class-picker-slot');
    if (slot) ClassPicker.render(slot);
    ClassPicker.onChange(cid => initDailyProgress('projection', cid));
    initDailyProgress('projection', ClassPicker.activeClassId());
}

// Tier label, header and progress bar from a server status object.
function applyStatus(s) {
    if (!s || !s.tier) return;
    pj.tier = PC.clampTier(s.tier);
    renderTierLabel();
    if (pj.local) return;
    const pd = document.getElementById('playerData');
    if (pd) pd.textContent = `Tier ${pj.tier}`;
    TierProgress.render(document.getElementById('pj-progress'), s,
        { progression: PC.CONFIG.PROGRESSION, maxTier: PC.MAX_TIER });
}

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
    if (!pj.helpMounted) { mountHelp(); pj.helpMounted = true; initGrids(); initBuilder(); }
    nextProblem();
}

function emptyAnswerView(size) {
    return { size, cells: new Set(), lines: new Map(), auto: new Set(), suppressed: new Set() };
}

async function nextProblem() {
    clearTimeout(pj.advanceId);
    if (pj.loading) return;
    if (pj.local) {
        const linked = takeLinkedShape();   // may switch the tier
        showProblem({ shape: linked || PC.generateShape(pj.tier), task: PC.pickTask(pj.tier), elapsedMs: 0 });
        return;
    }
    // Signed in: the server hands out (and times) the problem.
    pj.loading = true;
    setFeedback('Loading…', '');
    try {
        const res = await authFetch('/api/projection/next');
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        applyStatus(data);
        pj.problemId = data.problem_id;
        // Build problems come as views only — the shape would give the answer away.
        const views = data.views && Object.fromEntries(PC.VIEW_NAMES.map(n => [n, PC.viewFromJSON(data.views[n])]));
        showProblem({ shape: data.shape, views, box: data.box, code: data.code, task: data.task, elapsedMs: data.elapsed_ms });
    } catch (err) {
        console.error(err);
        setFeedback('Couldn\'t load a problem — check your connection and press Next.', 'wrong');
        document.getElementById('pj-next').style.display = '';
    } finally {
        pj.loading = false;
    }
}

function showProblem({ shape, views, box, code, task, elapsedMs }) {
    const def = PC.tierDef(pj.tier);
    const build = task === 'build';
    pj.task = build ? 'build' : 'draw';
    pj.shape = shape || null;
    pj.box = shape ? shape.box : box;
    pj.views = shape ? PC.computeViews(shape) : views;
    document.getElementById('pj-code').textContent = shape ? PC.encodeShape(shape) : (code || '');
    pj.answer = build ? null : Object.fromEntries(PC.VIEW_NAMES.map(n => [n, emptyAnswerView(pj.views[n].size)]));
    pj.build = build ? newBuild() : null;
    pj.buildViews = null;
    pj.diffs = null;
    pj.perView = null;
    pj.hover = null;

    const maxDim = Math.max(...def.box);
    pj.cell = Math.max(36, Math.min(56, Math.floor(220 / maxDim)));

    document.getElementById('pj-task-title').textContent = build
        ? 'Build the object these views show' : 'Draw the front, right side and top views';
    document.getElementById('pj-task-sub').textContent = subtitleFor(def);
    setFeedback('', '');
    document.getElementById('pj-legend').style.display = 'none';
    document.getElementById('pj-next').style.display = 'none';
    document.getElementById('pj-submit').style.display = '';
    document.getElementById('pj-clear-all').disabled = false;
    // Controls that belong to one task only.
    document.getElementById('pj-sheet').classList.toggle('pj-sheet--build', build);
    document.querySelectorAll('[data-clear]').forEach(b => { b.style.display = build ? 'none' : ''; });
    document.getElementById('pj-hidden-mode').style.display = build ? 'none' : '';
    document.getElementById('pj-build-controls').style.display = build ? '' : 'none';
    document.getElementById('pj-show-answer').style.display = 'none';
    document.getElementById('pj-iso-label').textContent = build ? 'Your build' : 'Isometric';
    setRemoveMode(false);
    HowToPlay.show(pj.task);
    announceRules(def);

    pj.phase = 'answer';
    setBuildControlsEnabled(true);
    if (build) drawBuilder(); else drawIso();
    PC.VIEW_NAMES.forEach(renderGrid);
    renderLabels();

    // A problem resumed from the server keeps the time it's already been open.
    pj.startedAt = performance.now() - (elapsedMs || 0);
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
    if (pj.task === 'build') {
        return PC.hasHiddenLines(pj.views)
            ? 'Any build with exactly these views counts — dashed hidden lines included.'
            : 'Any build with exactly these views counts. The front of the object is marked.';
    }
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
    if (pj.task === 'build') { pj.build.cubes.clear(); afterBuildChange(); return; }
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

async function submitAnswer() {
    if (pj.phase !== 'answer') return;
    const build = pj.task === 'build';
    if (build) {
        if (!pj.build.cubes.size) { setFeedback('Add some cubes first.', 'wrong'); return; }
        if (buildFloating().length) {
            setFeedback('The red cubes aren\'t connected to the floor — connect or remove them first.', 'wrong');
            return;
        }
    } else if (!PC.VIEW_NAMES.every(n => pj.answer[n].cells.size)) {
        setFeedback('Shade at least one square in each view first.', 'wrong');
        return;
    }

    pj.phase = 'feedback';
    clearInterval(pj.timerId);
    pj.hover = null;
    if (build) { pj.build.hover = null; drawBuilder(); }
    document.getElementById('pj-submit').style.display = 'none';
    document.getElementById('pj-clear-all').disabled = true;
    setBuildControlsEnabled(false);

    if (pj.local) {
        const timeMs = Math.round(performance.now() - pj.startedAt);
        const result = build
            ? PC.gradeBuild(pj.shape, { cubes: buildCubes() })
            : PC.gradeDrawing(pj.shape, pj.answer, pj.tier);
        showResult(result, PC.scoreAttempt(pj.tier, result.correct, timeMs));
        return;
    }

    // Signed in: the server's grade and score are the ones that count.
    const msg = document.getElementById('submitMessage');
    const classId = ClassPicker.activeClassId();
    const tierBefore = pj.tier;
    setFeedback('Checking…', '');
    try {
        const res = await authFetch('/api/projection/attempt', {
            method: 'POST',
            body: JSON.stringify({
                problem_id: pj.problemId,
                answer: build
                    ? { cubes: buildCubes() }
                    : Object.fromEntries(PC.VIEW_NAMES.map(n => [n, PC.viewToJSON(pj.answer[n])])),
                class_id: classId,
            }),
        });
        const data = await res.json();
        if (res.status === 409) {
            // Answered in another tab, or the tier moved — this one didn't count.
            applyStatus(data);
            setFeedback('That problem was already closed (another tab?) — it wasn\'t recorded. Here\'s a new one.', 'wrong');
            pj.phase = 'idle';
            setTimeout(nextProblem, PJ.ADVANCE_MS);
            return;
        }
        if (!res.ok) throw new Error(data.error || res.status);
        if (data.shape) pj.shape = data.shape;   // build target, revealed once answered
        showResult({ correct: data.correct, perView: data.per_view, aligned: data.aligned }, data.score);
        applyStatus(data);
        if (data.tier > tierBefore)      msg.textContent = `Moved up to Tier ${data.tier}!`;
        else if (data.tier < tierBefore) msg.textContent = `Moved back to Tier ${data.tier} — keep practicing.`;
        else                             msg.textContent = '';
        if (data.correct) refreshDailyProgress('projection', classId);
    } catch (err) {
        console.error(err);
        // Let them try submitting again — nothing was recorded.
        pj.phase = 'answer';
        document.getElementById('pj-submit').style.display = '';
        document.getElementById('pj-clear-all').disabled = false;
        setBuildControlsEnabled(true);
        if (build) drawBuilder();
        setFeedback('Couldn\'t reach the server — your answer wasn\'t saved. Try Submit again.', 'wrong');
    }
}

// Feedback for a graded drawing: ✓/✗ per view, and on a wrong answer the
// correct marks in gold and extra ones in red (held until Next).
function showResult(result, score) {
    const def = PC.tierDef(pj.tier);
    pj.perView = result.perView;

    if (result.correct) {
        setFeedback(`Correct! +${score}`, 'correct');
        PC.VIEW_NAMES.forEach(renderGrid);
        renderLabels();
        pj.advanceId = setTimeout(nextProblem, PJ.ADVANCE_MS);
        return;
    }

    const build = pj.task === 'build';
    // Build: the grids switch to the build's own views, marked against the target's.
    if (build) pj.buildViews = PC.computeViews({ box: pj.box, cubes: buildCubes() });
    const mine = build ? pj.buildViews : pj.answer;
    pj.diffs = Object.fromEntries(PC.VIEW_NAMES
        .filter(n => !result.perView[n])
        .map(n => [n, PC.diffView(pj.views[n], mine[n], build || def.hiddenGraded)]));
    const wrong = PC.VIEW_NAMES.filter(n => !result.perView[n]);
    const names = { front: 'front', right: 'right side', top: 'top' };
    const list = wrong.map(n => names[n]).join(', ').replace(/, ([^,]*)$/, ' and $1');
    let msg;
    if (build) {
        msg = `Not quite — your build's ${list} view${wrong.length > 1 ? 's don\'t' : ' doesn\'t'} match. The grids now show your build's views, with what's missing in gold.`;
        if (pj.shape) {
            const btn = document.getElementById('pj-show-answer');
            btn.style.display = '';
            btn.textContent = 'Show a correct build';
        }
    } else if (!wrong.length && !result.aligned) {
        msg = 'Each view is right, but they don\'t line up: the top view must sit directly above the front, and the right side level with it.';
    } else {
        msg = `Not quite — check the ${list} view${wrong.length > 1 ? 's' : ''}. The correct marks are shown in gold.`;
    }
    setFeedback(msg, 'wrong');
    document.getElementById('pj-legend').style.display = wrong.length ? '' : 'none';
    PC.VIEW_NAMES.forEach(renderGrid);
    renderLabels();
    const next = document.getElementById('pj-next');
    next.style.display = '';
    next.focus({ preventScroll: true });
}

// Build feedback: swap the builder between the student's build and the target.
function toggleShowAnswer() {
    if (pj.task !== 'build' || pj.phase !== 'feedback' || !pj.shape) return;
    pj.build.showAnswer = !pj.build.showAnswer;
    document.getElementById('pj-show-answer').textContent = pj.build.showAnswer ? 'Show my build' : 'Show a correct build';
    document.getElementById('pj-iso-label').textContent = pj.build.showAnswer ? 'A correct build' : 'Your build';
    drawBuilder();
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
            if (pj.phase !== 'answer' || pj.task !== 'draw') return;
            setHover(name, targetFromEvent(name, e));
        });
        svg.addEventListener('pointerleave', () => { if (pj.hover && pj.hover.view === name) setHover(null); });
        svg.addEventListener('pointerdown', e => {
            if (pj.phase !== 'answer' || pj.task !== 'draw' || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
        if (pj.phase !== 'answer' || pj.task !== 'draw' || !pj.hover || pj.hover.kind !== 'seg') return;
        if (e.key === 'h' || e.key === 'H') { e.preventDefault(); toggleHidden(pj.hover.view, pj.hover.key); }
    });
}

function gridGeom(name) {
    const [U, V] = pj.views[name].size;
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

// What a grid shows: the student's drawing (draw), the given view (build),
// or the build's own view once a wrong build is marked.
function gridContent(name) {
    if (pj.task === 'draw') return pj.answer[name];
    return pj.buildViews ? pj.buildViews[name] : pj.views[name];
}

function renderGrid(name) {
    const svg = document.getElementById(`pj-grid-${name}`);
    const a = gridContent(name);
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

// ── Builder (build problems) ─────────────────────────────────────────────────
// The build is kept in the problem's own coordinates ('x,y,z' keys); Q/E only
// turn the drawing. "Display" coordinates are the build turned rot quarter
// turns (counter-clockwise seen from above), which is what gets drawn and
// what the arrow keys move through.
function newBuild() {
    return { cubes: new Set(), cursor: [0, 0, 0], rot: 0, removeMode: false, hover: null, showAnswer: false };
}

// A point (lattice corner, or anything in between) turned r quarter turns in a W×D box.
function turnPt([x, y, z], r, [W, D]) {
    for (let i = 0; i < ((r % 4) + 4) % 4; i++) { [x, y] = [D - y, x]; [W, D] = [D, W]; }
    return [x, y, z];
}
// A cube turned: its centre turned, then back to its corner.
function turnCube([x, y, z], r, box) {
    const [cx, cy] = turnPt([x + 0.5, y + 0.5, z], r, box);
    return [Math.round(cx - 0.5), Math.round(cy - 0.5), z];
}
function dispBox() {
    const [W, D, H] = pj.box;
    return pj.build.rot % 2 ? [D, W, H] : [W, D, H];
}
const toDisp = c => turnCube(c, pj.build.rot, pj.box);
const fromDisp = c => turnCube(c, 4 - pj.build.rot, dispBox());
const inBox = ([x, y, z], [W, D, H]) => x >= 0 && y >= 0 && z >= 0 && x < W && y < D && z < H;

function buildCubes() { return [...pj.build.cubes].map(k => k.split(',').map(Number)); }
function buildFloating() { return PC.floatingCubes(buildCubes()); }
function buildEditing() { return pj.task === 'build' && pj.phase === 'answer' && !!pj.build; }

function initBuilder() {
    const svg = document.getElementById('pj-iso');
    svg.addEventListener('contextmenu', e => { if (pj.task === 'build') e.preventDefault(); });
    svg.addEventListener('pointermove', e => {
        if (buildEditing() && e.pointerType === 'mouse') setBuildHover(builderTarget(e, e.shiftKey));
    });
    svg.addEventListener('pointerleave', () => { if (buildEditing()) setBuildHover(null); });
    svg.addEventListener('pointerdown', e => {
        if (!buildEditing()) return;
        const t = builderTarget(e, e.shiftKey || e.button === 2);
        if (!t) return;
        e.preventDefault();
        pj.build.hover = null;
        if (t.remove) setCube(fromDisp(t.remove), false);
        else setCube(fromDisp(t.place), true);
    });
    document.addEventListener('keydown', onBuildKey);
    document.querySelectorAll('#pj-build-controls [data-move]').forEach(b => b.addEventListener('click', () => {
        if (buildEditing()) moveCursor(b.dataset.move.split(',').map(Number));
    }));
    document.querySelectorAll('#pj-build-controls [data-act]').forEach(b => b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'rot-left') return turnBuild(1);
        if (act === 'rot-right') return turnBuild(-1);
        if (!buildEditing()) return;
        if (act === 'toggle') toggleAtCursor();
        if (act === 'remove-mode') setRemoveMode(!pj.build.removeMode);
    }));
}

// What a click would do: { place: displayCube } or { remove: displayCube }.
function builderTarget(e, wantRemove) {
    const el = e.target;
    if (!el || !el.dataset) return null;
    if (wantRemove || pj.build.removeMode) {
        return el.dataset.c ? { remove: el.dataset.c.split(',').map(Number) } : null;
    }
    if (!el.dataset.t) return null;
    const t = el.dataset.t.split(',').map(Number);
    if (!inBox(t, dispBox()) || pj.build.cubes.has(fromDisp(t).join(','))) return null;
    return { place: t };
}

function setBuildHover(t) {
    const b = pj.build, prev = JSON.stringify(b.hover);
    b.hover = t;
    if (JSON.stringify(t) !== prev) drawBuilder();
}

function setCube(c, on) {
    const k = c.join(',');
    if (on) pj.build.cubes.add(k); else pj.build.cubes.delete(k);
    pj.build.cursor = c;
    afterBuildChange();
}

function afterBuildChange() {
    drawBuilder();
    const floating = buildFloating().length;
    const fb = document.getElementById('pj-feedback');
    if (floating) setFeedback('Red cubes aren\'t connected to the floor — every cube must rest on the floor or join one that does.', 'wrong');
    else if (fb.dataset.floating) setFeedback('', '');
    fb.dataset.floating = floating ? '1' : '';
}

function onBuildKey(e) {
    if (pj.task !== 'build' || !pj.build || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = ((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const k = e.key;
    // Turning the drawing also works while looking over a marked answer.
    if (k === 'q' || k === 'Q') { e.preventDefault(); turnBuild(1); return; }
    if (k === 'e' || k === 'E') { e.preventDefault(); turnBuild(-1); return; }
    if (!buildEditing()) return;
    const moves = { ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0], ArrowRight: [1, 0, 0], ArrowLeft: [-1, 0, 0],
                    '+': [0, 0, 1], '=': [0, 0, 1], PageUp: [0, 0, 1], '-': [0, 0, -1], '_': [0, 0, -1], PageDown: [0, 0, -1] };
    if (moves[k]) moveCursor(moves[k]);
    else if (k === ' ' || k === 'Spacebar') toggleAtCursor();
    else if (k === 'Delete' || k === 'Backspace') {
        if (pj.build.cubes.has(pj.build.cursor.join(','))) setCube(pj.build.cursor, false);
    } else return;
    e.preventDefault();
}

// Moves the cursor in display directions, so the arrows follow the drawing.
function moveCursor(d) {
    const box = dispBox(), cur = toDisp(pj.build.cursor);
    const n = cur.map((v, i) => Math.max(0, Math.min(box[i] - 1, v + d[i])));
    pj.build.cursor = fromDisp(n);
    drawBuilder();
}

function toggleAtCursor() {
    const c = pj.build.cursor;
    setCube(c, !pj.build.cubes.has(c.join(',')));
}

function turnBuild(dr) {
    if (pj.task !== 'build' || !pj.build) return;
    pj.build.rot = (pj.build.rot + dr + 4) % 4;
    pj.build.hover = null;
    drawBuilder();
}

function setRemoveMode(on) {
    if (pj.build) pj.build.removeMode = on;
    document.getElementById('pj-remove-mode').classList.toggle('active', !!on);
    if (pj.build) { pj.build.hover = null; if (pj.task === 'build') drawBuilder(); }
}

// While an answer is being marked only turning stays available.
function setBuildControlsEnabled(on) {
    document.querySelectorAll('#pj-build-controls button').forEach(b => {
        if (!/^rot-/.test(b.dataset.act || '')) b.disabled = !on;
    });
}

function drawBuilder() {
    const svg = document.getElementById('pj-iso');
    svg.innerHTML = '';
    const b = pj.build;
    const [W, D, H] = dispBox();
    const editing = pj.phase === 'answer';
    const canon = b.showAnswer && pj.shape ? pj.shape.cubes : buildCubes();
    const cubes = canon.map(toDisp);
    const set = PC.cubeSet(cubes);
    const has = (x, y, z) => set.has(`${x},${y},${z}`);
    const floating = PC.cubeSet(b.showAnswer ? [] : PC.floatingCubes(cubes));
    const cur = toDisp(b.cursor);
    const layer = editing ? cur[2] : H;   // cubes above the cursor's layer are faded

    // Frame on the whole box (steady size while building) plus the FRONT label.
    const [W0, D0] = pj.box;
    const labelAt = turnPt([W0 / 2, -0.7, 0], b.rot, [W0, D0]);
    const pts = [];
    for (const x of [0, W]) for (const y of [0, D]) for (const z of [0, H]) pts.push(PC.isoXY([x, y, z]));
    pts.push(PC.isoXY(labelAt));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(PJ.BUILD_MAX_PX / (maxX - minX), PJ.BUILD_MAX_PX / (maxY - minY), pj.cell * 1.2);
    const pad = 14;
    const w = (maxX - minX) * scale + 2 * pad, h = (maxY - minY) * scale + 2 * pad;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    const P = ([x, y]) => [pad + (x - minX) * scale, pad + (maxY - y) * scale];
    const T = p => P(PC.isoXY(p));
    const poly = (corners, cls, attrs) => svgEl('polygon',
        { points: corners.map(T).map(p => p.join(',')).join(' '), class: cls, ...(attrs || {}) }, svg);
    const line2 = (p, q, cls) => svgEl('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: cls }, svg);
    const line = (a, c, cls) => line2(T(a), T(c), cls);
    const tile = (x, y, z) => [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]];
    // A cube's three drawn faces, each with the spot a cube placed against it would fill.
    const faces = (x, y, z) => ({
        top:   { pts: tile(x, y, z + 1), t: [x, y, z + 1] },
        front: { pts: [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], t: [x, y - 1, z] },
        right: { pts: [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], t: [x + 1, y, z] },
    });

    // Floor: clicking a square puts a cube on it.
    for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) {
        poly(tile(x, y, 0), 'pj-floor', editing ? { 'data-t': `${x},${y},0` } : null);
    }
    // The object's front edge, so a turned drawing still matches the views.
    line(turnPt([0, 0, 0], b.rot, [W0, D0]), turnPt([W0, 0, 0], b.rot, [W0, D0]), 'pj-bfront-edge');
    const [lx, ly] = T(labelAt);
    svgEl('text', { x: lx, y: ly, class: 'pj-bfront', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg)
        .textContent = 'FRONT';

    // Where the cursor would land: the top of whatever is under it.
    let shadowZ = 0;
    for (let z = cur[2] - 1; z >= 0; z--) if (has(cur[0], cur[1], z)) { shadowZ = z + 1; break; }

    // Bottom layer up, back to front within a layer — a valid paint order for
    // this view, and it lets the layer plane slot in between layers.
    const byZ = Array.from({ length: H }, () => []);
    for (const c of cubes) byZ[c[2]].push(c);
    for (let z = 0; z < H; z++) {
        if (editing && z === layer) {
            for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) poly(tile(x, y, z), 'pj-bplane');
        }
        if (editing && z === shadowZ) poly(tile(cur[0], cur[1], z), 'pj-bshadow');
        byZ[z].sort((p, q) => (p[0] - p[1]) - (q[0] - q[1]));
        for (const [x, y] of byZ[z]) {
            const k = `${x},${y},${z}`;
            const f = faces(x, y, z);
            const extra = (floating.has(k) ? ' pj-bface--float' : '') + (z > layer ? ' pj-bface--faded' : '');
            for (const name of ['top', 'front', 'right']) {
                if (has(...f[name].t)) continue;
                poly(f[name].pts, `pj-bface pj-bface--${name}${extra}`,
                    editing ? { 'data-c': k, 'data-t': f[name].t.join(',') } : null);
            }
        }
    }

    // Hidden lines for cubes the drawing hides completely, as in the problems.
    for (const e of PC.isoEdges({ box: [W, D, H], cubes }).filter(e => e.hidden)) {
        line2(P(e.a), P(e.b), 'pj-iso-line pj-iso-line--hidden pj-nohit');
    }

    if (!editing) return;
    const ghost = (c, cls) => { const f = faces(...c); for (const n of ['top', 'front', 'right']) poly(f[n].pts, cls); };
    if (b.hover && b.hover.place) ghost(b.hover.place, 'pj-bghost');
    if (b.hover && b.hover.remove) ghost(b.hover.remove, 'pj-bghost pj-bghost--remove');

    // Cursor: a wire cube with the edges at its hidden back corner dashed, and
    // a drop line down to its shadow when it's up in the air.
    const [x, y, z] = cur;
    const back = [x, y + 1, z].join();
    const corners = [];
    for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) corners.push([x + dx, y + dy, z + dz]);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const [p, q] = [corners[i], corners[j]];
        if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) !== 1) continue;
        line(p, q, 'pj-bcursor' + (p.join() === back || q.join() === back ? ' pj-bcursor--back' : ''));
    }
    if (shadowZ < z) line([x + 0.5, y + 0.5, shadowZ], [x + 0.5, y + 0.5, z], 'pj-bstem');
}

// ── How to play ──────────────────────────────────────────────────────────────
function mountHelp() {
    const P = PC.CONFIG.PROGRESSION;
    const pct = v => `${Math.round(v * 100)}%`;
    const scoring = `
                <h3>Scoring and tiers</h3>
                <p>Correct answers at or under the tier's <strong>par</strong> time (shown next to the tier) earn full points; slower ones earn less. Move up by getting ${pct(P.PROMOTE_ACCURACY)} of your last ${P.WINDOW} right while averaging ${pct(P.PROMOTE_SCORE_PCT)} of the possible points — or by getting ${P.STREAK} right in a row. Averaging below ${pct(P.DEMOTE_SCORE_PCT)} moves you back a tier.</p>`;
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
                <p>Each view is checked for its shaded squares and its lines. Where you place a view on its grid doesn't matter — until the higher tiers, where the views must line up with each other. If something's wrong, the correct marks appear in gold and extra ones in red; press <strong>Next</strong> when you're ready.</p>` + scoring,
            build: `
                <h3>Your task</h3>
                <p>The <strong>top</strong>, <strong>front</strong> and <strong>right side</strong> views show an object made of cubes. Build it in the box on the right. The side marked <strong>FRONT</strong> is the side the front view looks at. Any build whose three views match exactly is correct.</p>
                <h3>With the mouse</h3>
                <ul>
                    <li><strong>Click a floor square</strong> to put a cube there, or <strong>click a cube's face</strong> to add a cube against that face. A see-through cube shows where it will go.</li>
                    <li><strong>Shift-click</strong> or <strong>right-click</strong> a cube to remove it. On a touchscreen, turn on <strong>Remove</strong> and tap.</li>
                </ul>
                <h3>With the keyboard</h3>
                <ul>
                    <li>The blue wire cube is your <strong>cursor</strong>. The arrow keys move it along the drawing's lines: <kbd>↑</kbd> goes back-right, <kbd>↓</kbd> front-left, <kbd>→</kbd> front-right, <kbd>←</kbd> back-left.</li>
                    <li><kbd>+</kbd> and <kbd>-</kbd> move it up and down a layer. The tinted plane shows the layer you're on; cubes above it fade, and the dark square below shows where the cursor sits over the cubes underneath.</li>
                    <li><kbd>Space</kbd> adds or removes the cube at the cursor.</li>
                    <li><kbd>Q</kbd> and <kbd>E</kbd> turn the drawing to see it from another corner. The buttons beside the box do all of this too.</li>
                </ul>
                <h3>Rules and checking</h3>
                <p>Every cube must rest on the floor or join one that does — cubes that aren't connected turn red and must be fixed before you can submit. Dashed hidden lines in the views count, so a hidden pocket must be built too. If your build is wrong, the grids switch to your build's views with what's missing in gold and what's extra in red; you can also look at one correct build.</p>` + scoring,
        },
    });
}

// Rules that switch on at a tier get a one-time note in the help panel.
function announceRules(def) {
    if (pj.task === 'build') {
        HowToPlay.announce('build', '<p><strong>New: build problems.</strong> Now you get the three views and build the object from cubes. The controls are explained below.</p>');
    }
    if (def.task === 'mixed') {
        HowToPlay.announce('mixed', '<p><strong>Mixed problems.</strong> From here on you\'ll get both kinds: drawing views from an object, and building an object from its views.</p>');
    }
    if (pj.task !== 'draw') return;   // the rest are about drawing views
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
