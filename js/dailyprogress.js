// Daily progress pill — tracks done/required for today's assignment.
// Call initDailyProgress(type) after sign-in. type: 'kenken' | 'sat' | 'sat-math'
// Renders into #daily-pill; triggers +1 float on qualifying submissions.

let _dpData = null;

async function initDailyProgress(type) {
    if (typeof localMode !== 'undefined' && localMode) return;
    try {
        const res = await authFetch('/api/student/daily-progress');
        if (!res.ok) return;
        _dpData = await res.json();
        _renderPill(type);
    } catch (_) {}
}

async function refreshDailyProgress(type) {
    if (typeof localMode !== 'undefined' && localMode) return;
    const todayKey = type === 'sat-math' ? 'sat_math' : type;
    const prevCount = _dpData?.today?.[todayKey] ?? 0;
    try {
        const res = await authFetch('/api/student/daily-progress');
        if (!res.ok) return;
        _dpData = await res.json();
        const newCount = _dpData?.today?.[todayKey] ?? 0;
        _renderPill(type);
        if (newCount > prevCount) _pillPlusOne();
    } catch (_) {}
}

function _renderPill(type) {
    const el = document.getElementById('daily-pill');
    if (!el || !_dpData?.settings) { if (el) el.style.display = 'none'; return; }
    const act      = _dpData.settings.required_activity;
    const relevant =
        (type === 'kenken'   && ['kenken',   'both', 'either', 'all'].includes(act)) ||
        (type === 'sat'      && ['sat',      'both', 'either', 'sat-both', 'all'].includes(act)) ||
        (type === 'sat-math' && ['sat-math', 'sat-both', 'all'].includes(act));
    if (!relevant) { el.style.display = 'none'; return; }

    const todayKey = type === 'sat-math' ? 'sat_math' : type;
    const required = type === 'kenken'
        ? _dpData.settings.required_kenken_count
        : type === 'sat-math'
        ? _dpData.settings.required_sat_math_count
        : _dpData.settings.required_sat_count;
    const done  = Math.min(_dpData.today[todayKey] ?? 0, required);
    const isDone = done >= required;

    el.className = 'daily-pill ' + (isDone ? 'daily-pill--done' : 'daily-pill--active');
    el.style.display = '';
    const countEl = el.querySelector('.dp-count');
    if (countEl) countEl.textContent = isDone ? `${done} / ${required} ✓` : `${done} / ${required}`;
}

function _pillPlusOne() {
    const el = document.getElementById('daily-pill');
    if (!el) return;
    const floater = document.createElement('span');
    floater.className = 'daily-pill-floater';
    floater.textContent = '+1';
    el.appendChild(floater);
    floater.addEventListener('animationend', () => floater.remove(), { once: true });
}
