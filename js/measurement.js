// Ruler Game page. Rules (tiers, snapping, scoring) come from
// js/measurement-core.js; the server re-checks every attempt and owns the
// student's tier. Local mode picks a practice tier and saves nothing.

const Core = MeasurementCore;

// ── Ruler geometry (SVG user units) ──────────────────────────────────────────
const RG = {
    PAD_X: 30,
    PX_PER_IN: 150,
    TOP: 10,
    BODY_H: 120,
    // Tick length by the mark's reduced denominator.
    TICK: { 1: 58, 2: 44, 4: 34, 8: 26, 16: 19, 32: 13 },
    FRAC_Y: 70,       // numerator baseline for fraction labels
    INCH_Y: 112,      // inch numeral baseline
    FLASH_MS: 450,    // red flash before the gold answer bar appears
    ADVANCE_MS: 650,  // pause on a correct answer before the next problem
};
RG.WIDTH = RG.PX_PER_IN * Core.RULER_INCHES;
const unitX = u => RG.PAD_X + u / Core.UNITS_PER_INCH * RG.PX_PER_IN;
const SVG_NS = 'http://www.w3.org/2000/svg';

const rg = {
    local: false,
    tier: 1,
    renderedTier: null,
    target: null,
    cursor: null,        // snapped position in 32nds, or null when hidden
    phase: 'idle',       // 'idle' | 'answer' | 'feedback'
    dragging: false,
    startedAt: 0,
    timerId: null,
    advanceId: null,
    pending: null,       // in-flight submission
    els: {},
};

// ── Sign-in / local mode ─────────────────────────────────────────────────────
async function onSignedIn() {
    rg.local = false;
    document.getElementById('rg-local-tier').style.display = 'none';
    try {
        const res = await authFetch('/api/measurement/status');
        if (res.ok) applyStatus(await res.json());
    } catch (_) {}

    await ClassPicker.init('measurement');
    const slot = document.getElementById('class-picker-slot');
    if (slot) ClassPicker.render(slot);
    ClassPicker.onChange(cid => initDailyProgress('measurement', cid));
    initDailyProgress('measurement', ClassPicker.activeClassId());
}

function onLocalMode() {
    rg.local = true;
    const sel = document.getElementById('rg-local-tier-select');
    sel.innerHTML = '';
    for (let t = 1; t <= Core.MAX_TIER; t++) {
        const o = document.createElement('option');
        o.value = String(t);
        o.textContent = `Tier ${t}`;
        sel.appendChild(o);
    }
    sel.value = String(rg.tier);
    document.getElementById('rg-local-tier').style.display = '';
    document.getElementById('rg-progress').style.display = 'none';
    renderTierLabel();
}

function setLocalTier(v) {
    rg.tier = Core.clampTier(v);
    document.getElementById('rg-local-tier-select').value = String(rg.tier);
    renderTierLabel();
    if (rg.phase !== 'idle') nextProblem();
}

function applyStatus(s) {
    if (!s || !s.tier) return;
    rg.tier = Core.clampTier(s.tier);
    renderTierLabel();
    const pd = document.getElementById('playerData');
    if (pd && !rg.local) pd.textContent = `Tier ${rg.tier}`;

    if (!rg.local) renderTierProgress(s);
}

// ── Tier progress bar (mirrors KenKen's rank progress bar) ───────────────────
// Promotion needs three things over the rolling window: enough answers, enough
// correct, enough points. Each is scored 0–1 against its target and the bar
// shows the weakest — it reaches 100% exactly when the student moves up.
function computeTierProgress(s) {
    const P = Core.CONFIG.PROGRESSION;
    const clamp = v => Math.max(0, Math.min(1, v));
    const n = s.attempts || 0;
    const reqs = [
        { label: 'Answers', have: `${n}/${s.window}`,                         pct: clamp(n / s.window) },
        { label: 'Correct', have: `${n ? Math.round(s.accuracy * 100) : 0}%`, need: `${Math.round(P.PROMOTE_ACCURACY * 100)}%`,
          pct: n ? clamp(s.accuracy / P.PROMOTE_ACCURACY) : 0 },
        { label: 'Points',  have: `${n ? Math.round(s.avg_pct * 100) : 0}%`,  need: `${Math.round(P.PROMOTE_SCORE_PCT * 100)}%`,
          pct: n ? clamp(s.avg_pct / P.PROMOTE_SCORE_PCT) : 0 },
    ];
    return {
        tier: s.tier,
        next: s.tier < Core.MAX_TIER ? s.tier + 1 : null,
        pct: Math.min(...reqs.map(r => r.pct)),
        reqs,
    };
}

function renderTierProgress(s) {
    const el = document.getElementById('rg-progress');
    if (!el) return;
    const p = computeTierProgress(s);
    const P = Core.CONFIG.PROGRESSION;
    el.style.display = '';
    document.getElementById('rg-progress-from').textContent = `Tier ${p.tier}`;
    document.getElementById('rg-progress-to').textContent = p.next ? `Tier ${p.next}` : 'Max';

    const fill = document.getElementById('rg-progress-fill');
    const width = p.next ? Math.round(p.pct * 100) : 100;
    // Two frames so a first render animates up from 0, like KenKen's.
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = width + '%'; }));

    document.getElementById('rg-progress-reqs').innerHTML = p.reqs.map(r =>
        `<span class="rg-req${r.pct >= 1 ? ' rg-req--met' : ''}">${r.label} ${r.have}${r.need ? ` / ${r.need}` : ''}</span>`
    ).join('');
    document.getElementById('rg-progress-pct').textContent =
        p.next ? `${width}% to next tier` : 'Maximum tier reached';
    el.title = `Move up: over your last ${s.window} answers in this tier, get ${Math.round(P.PROMOTE_ACCURACY * 100)}% `
             + `correct and average ${Math.round(P.PROMOTE_SCORE_PCT * 100)}% of possible points. `
             + `Move down: average below ${Math.round(P.DEMOTE_SCORE_PCT * 100)}%.`;
}

function renderTierLabel() {
    const el = document.getElementById('rg-tier-label');
    if (el) el.textContent = `Tier ${rg.tier} of ${Core.MAX_TIER} · par ${Core.parMs(rg.tier) / 1000}s`;
}

// ── Game flow ────────────────────────────────────────────────────────────────
function launchRulerGame() {
    if (!rg.local && typeof ClassPicker !== 'undefined' && ClassPicker.needsChoice()) {
        ClassPicker.flash();
        return;
    }
    document.getElementById('rg-start-screen').style.display = 'none';
    document.getElementById('rg-game-area').style.display = '';
    initRuler();
    nextProblem();
}

async function nextProblem() {
    clearTimeout(rg.advanceId);
    rg.phase = 'loading';
    if (rg.pending) { try { await rg.pending; } catch (_) {} }

    if (rg.renderedTier !== rg.tier) drawRuler();
    rg.target = Core.pickTarget(rg.tier, rg.target);
    document.getElementById('rg-target').textContent = Core.formatLength(rg.target);
    document.getElementById('rg-feedback').textContent = '';
    document.getElementById('rg-feedback').className = 'rg-feedback';
    document.getElementById('rg-next').style.display = 'none';
    resetMarks();
    setCursor(null);

    rg.phase = 'answer';
    rg.startedAt = performance.now();
    clearInterval(rg.timerId);
    rg.timerId = setInterval(renderTimer, 100);
    renderTimer();
    rg.els.svg.focus({ preventScroll: true });
}

function renderTimer() {
    const s = (performance.now() - rg.startedAt) / 1000;
    document.getElementById('rg-time').textContent = s.toFixed(1);
}

function commit(units) {
    if (rg.phase !== 'answer' || units == null) return;
    rg.phase = 'feedback';
    clearInterval(rg.timerId);
    const timeMs = Math.round(performance.now() - rg.startedAt);
    const target = rg.target;
    const correct = units === target;
    const fb = document.getElementById('rg-feedback');

    submitAttempt(target, units, timeMs);

    if (correct) {
        rg.els.bar.setAttribute('class', 'rg-bar rg-bar--correct');
        const score = Core.scoreAttempt(rg.tier, target, true, timeMs);
        fb.textContent = `Correct! +${score}`;
        fb.className = 'rg-feedback rg-feedback--correct';
        rg.advanceId = setTimeout(nextProblem, RG.ADVANCE_MS);
        return;
    }

    rg.els.bar.setAttribute('class', 'rg-bar rg-bar--wrong');
    fb.textContent = `Not quite — you marked ${Core.formatLength(units)}″`;
    fb.className = 'rg-feedback rg-feedback--wrong';
    setTimeout(() => {
        // Gold bar shows the right length; a red tick keeps their guess visible.
        setBarWidth(target);
        rg.els.bar.setAttribute('class', 'rg-bar rg-bar--answer');
        rg.els.barEdge.style.display = 'none';
        rg.els.guessMark.setAttribute('x1', unitX(units));
        rg.els.guessMark.setAttribute('x2', unitX(units));
        rg.els.guessMark.style.display = '';
        fb.textContent = `You marked ${Core.formatLength(units)}″ — ${Core.formatLength(target)}″ is shown in gold.`;
        const next = document.getElementById('rg-next');
        next.style.display = '';
        next.focus({ preventScroll: true });
    }, RG.FLASH_MS);
}

function submitAttempt(target, guess, timeMs) {
    if (rg.local) return;
    const msg = document.getElementById('submitMessage');
    const classId = ClassPicker.activeClassId();
    rg.pending = (async () => {
        try {
            const res = await authFetch('/api/measurement/attempt', {
                method: 'POST',
                body: JSON.stringify({ target_32: target, guess_32: guess, time_ms: timeMs, class_id: classId }),
            });
            const data = await res.json();
            if (res.status === 409) {
                // Tier moved under us (another tab) — this one didn't count.
                applyStatus(data);
                msg.textContent = `Your tier changed to ${rg.tier} — that answer wasn't recorded.`;
                return;
            }
            if (!res.ok) throw new Error(data.error || res.status);
            const prev = data.previous_tier;
            applyStatus(data);
            if (data.tier > prev)      msg.textContent = `Moved up to Tier ${data.tier}!`;
            else if (data.tier < prev) msg.textContent = `Moved back to Tier ${data.tier} — keep practicing.`;
            else                       msg.textContent = '';
            if (data.correct) refreshDailyProgress('measurement', classId);
        } catch (err) {
            console.error(err);
            msg.textContent = 'Error saving answer — not recorded';
        } finally {
            rg.pending = null;
        }
    })();
}

// ── Ruler drawing ────────────────────────────────────────────────────────────
function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
}

function initRuler() {
    if (rg.els.svg) return;
    const svg = document.getElementById('rg-ruler');
    svg.setAttribute('viewBox', `0 0 ${RG.WIDTH + RG.PAD_X * 2} ${RG.TOP + RG.BODY_H + 10}`);
    rg.els.svg = svg;

    svg.addEventListener('pointerdown', e => {
        if (rg.phase !== 'answer' || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        rg.dragging = true;
        try { svg.setPointerCapture(e.pointerId); } catch (_) {}
        setCursor(unitsFromEvent(e));
    });
    svg.addEventListener('pointermove', e => {
        if (rg.phase !== 'answer') return;
        if (e.pointerType === 'mouse' || rg.dragging) setCursor(unitsFromEvent(e));
    });
    svg.addEventListener('pointerup', e => {
        if (!rg.dragging) return;
        rg.dragging = false;
        commit(unitsFromEvent(e));
    });
    svg.addEventListener('pointercancel', () => { rg.dragging = false; });
    svg.addEventListener('pointerleave', e => {
        if (rg.phase === 'answer' && e.pointerType === 'mouse' && !rg.dragging) setCursor(null);
    });
    svg.addEventListener('keydown', e => {
        if (rg.phase !== 'answer') return;
        const step = Core.UNITS_PER_INCH / Core.tierDef(rg.tier).grad;
        const max = Core.RULER_INCHES * Core.UNITS_PER_INCH;
        const cur = rg.cursor ?? 0;
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   next = Math.min(max, cur + step);
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') next = Math.max(0, cur - step);
        if (e.key === 'PageUp')   next = Math.min(max, cur + Core.UNITS_PER_INCH);
        if (e.key === 'PageDown') next = Math.max(0, cur - Core.UNITS_PER_INCH);
        if (e.key === 'Home') next = 0;
        if (e.key === 'End')  next = max;
        if (next != null) { e.preventDefault(); setCursor(next); return; }
        if ((e.key === 'Enter' || e.key === ' ') && rg.cursor != null) { e.preventDefault(); commit(rg.cursor); }
    });
}

function unitsFromEvent(e) {
    const svg = rg.els.svg;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    return Core.snap(rg.tier, (loc.x - RG.PAD_X) / RG.PX_PER_IN);
}

// Redraws the whole ruler for the current tier: graduations at the tier's
// finest mark, fraction labels where the tier has them, inch numerals always.
function drawRuler() {
    const svg = rg.els.svg;
    svg.innerHTML = '';
    const def = Core.tierDef(rg.tier);
    const bottom = RG.TOP + RG.BODY_H;

    svgEl('rect', { class: 'rg-body', x: RG.PAD_X - 12, y: RG.TOP, width: RG.WIDTH + 24, height: RG.BODY_H, rx: 4 }, svg);
    rg.els.bar = svgEl('rect', { class: 'rg-bar', x: RG.PAD_X, y: RG.TOP, width: 0, height: RG.BODY_H }, svg);
    rg.els.barEdge = svgEl('line', { class: 'rg-bar-edge', y1: RG.TOP, y2: bottom }, svg);

    const ticks = svgEl('g', { class: 'rg-ticks' }, svg);
    const labels = svgEl('g', { class: 'rg-labels' + (def.labels === 8 ? ' rg-labels--small' : '') }, svg);
    const step = Core.UNITS_PER_INCH / def.grad;
    const labelStep = def.labels ? Core.UNITS_PER_INCH / def.labels : 0;
    const total = Core.RULER_INCHES * Core.UNITS_PER_INCH;

    for (let u = 0; u <= total; u += step) {
        const d = u === 0 ? 1 : Core.denominatorOf(u);
        const x = unitX(u);
        svgEl('line', { x1: x, x2: x, y1: RG.TOP, y2: RG.TOP + RG.TICK[d], class: d === 1 ? 'rg-tick rg-tick--inch' : 'rg-tick' }, ticks);

        const rem = u % Core.UNITS_PER_INCH;
        if (rem === 0) {
            const inch = u / Core.UNITS_PER_INCH;
            if (inch > 0 && inch < Core.RULER_INCHES) {
                const t = svgEl('text', { x, y: RG.INCH_Y, class: 'rg-inch-num' }, labels);
                t.textContent = String(inch);
            }
        } else if (labelStep && rem % labelStep === 0) {
            const [num, den] = Core.formatLength(rem).split('/');
            const n = svgEl('text', { x, y: RG.FRAC_Y, class: 'rg-frac' }, labels);
            n.textContent = num;
            svgEl('line', { x1: x - 5, x2: x + 5, y1: RG.FRAC_Y + 3, y2: RG.FRAC_Y + 3, class: 'rg-frac-bar' }, labels);
            const dd = svgEl('text', { x, y: RG.FRAC_Y + 14, class: 'rg-frac' }, labels);
            dd.textContent = den;
        }
    }

    rg.els.guessMark = svgEl('line', { class: 'rg-guess-mark', y1: RG.TOP - 6, y2: bottom + 6 }, svg);
    rg.els.guessMark.style.display = 'none';
    // Transparent hit area over the ruler (plus a little slop at each end).
    svgEl('rect', { class: 'rg-hit', x: 0, y: 0, width: RG.WIDTH + RG.PAD_X * 2, height: bottom + 10 }, svg);
    rg.renderedTier = rg.tier;
}

function setBarWidth(units) {
    const w = units == null ? 0 : unitX(units) - RG.PAD_X;
    rg.els.bar.setAttribute('width', Math.max(0, w));
    rg.els.barEdge.style.display = units == null ? 'none' : '';
    if (units != null) {
        rg.els.barEdge.setAttribute('x1', unitX(units));
        rg.els.barEdge.setAttribute('x2', unitX(units));
    }
}

function setCursor(units) {
    rg.cursor = units;
    setBarWidth(units);
}

function resetMarks() {
    rg.els.bar.setAttribute('class', 'rg-bar');
    rg.els.guessMark.style.display = 'none';
}
