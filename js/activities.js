// Daily-assignment activities, shared by the browser and the server
// (server/routes/*.js require this file directly).
//
// classes.required_activity is stored as a comma-separated list of activity
// keys, e.g. "kenken,measurement". Rows saved before the list format carry one
// of the old named combos (LEGACY below) and are read through the same parser,
// so no data migration is needed.
//
// 'either' is the legacy default (never-saved class, or every box unchecked):
// KenKen OR SAT English, whichever is further along. It's kept as-is — the
// teacher UI shows it as both boxes checked and re-saving converts it.

(function (root) {
    // Order = display order everywhere (checkboxes, progress rows).
    const ACTIVITIES = [
        { key: 'kenken',      label: 'KenKen',      countField: 'required_kenken_count',      todayKey: 'kenken' },
        { key: 'sat-math',    label: 'SAT Math',    countField: 'required_sat_math_count',    todayKey: 'sat_math',
          accuracyMode: true },
        { key: 'sat',         label: 'SAT English', countField: 'required_sat_count',         todayKey: 'sat',
          accuracyMode: true },
        { key: 'measurement', label: 'Ruler Game',  countField: 'required_measurement_count', todayKey: 'measurement' },
        { key: 'projection',  label: 'Projections', countField: 'required_projection_count',  todayKey: 'projection' },
    ];
    const KEYS = ACTIVITIES.map(a => a.key);

    const LEGACY = {
        'both':        ['kenken', 'sat'],
        'sat-both':    ['sat', 'sat-math'],
        'kenken-math': ['kenken', 'sat-math'],
        'all':         ['kenken', 'sat', 'sat-math'],
        'either':      ['kenken', 'sat'],
    };

    // Set of activity keys a stored required_activity value covers.
    function parse(value) {
        const v = String(value == null || value === '' ? 'either' : value);
        if (LEGACY[v]) return new Set(LEGACY[v]);
        return new Set(v.split(',').map(s => s.trim()).filter(k => KEYS.includes(k)));
    }

    function isEither(value) {
        return value == null || value === '' || value === 'either';
    }

    function includes(value, key) {
        return parse(value).has(key);
    }

    // Canonical stored form for a set/array of keys. Empty → 'either' (the
    // historical "nothing checked" value).
    function serialize(keys) {
        const set = new Set(keys);
        const list = KEYS.filter(k => set.has(k));
        return list.length ? list.join(',') : 'either';
    }

    function isValid(value) {
        if (isEither(value) || LEGACY[value]) return true;
        const parts = String(value).split(',');
        return parts.length > 0 && parts.every(p => KEYS.includes(p));
    }

    // SAT accuracy mode (classes.sat_requirement_mode = 'accuracy'): activities
    // flagged accuracyMode must also reach sat_accuracy_pct over the last
    // sat_accuracy_window answers, not just the correct count (server/satAccuracy.js).
    function usesAccuracy(settings, key) {
        const a = ACTIVITIES.find(x => x.key === key);
        return !!(a && a.accuracyMode && settings && settings.sat_requirement_mode === 'accuracy');
    }

    // Student-facing sentence for the accuracy-mode rule, '' when it doesn't apply.
    function accuracyRule(settings, key) {
        if (!usesAccuracy(settings, key)) return '';
        const a    = ACTIVITIES.find(x => x.key === key);
        const need = settings[a.countField] ?? 1;
        const w    = settings.sat_accuracy_window ?? 3;
        return `${a.label}: get ${need} right, with at least ${settings.sat_accuracy_pct}% of your last ${w} answers correct.`;
    }

    // Today's status for one activity from a /api/student/daily-progress
    // response — what the pill, home badges and dashboard rows all render.
    // Returns { isDone, pct (0-100, for progress bars), text }.
    function todayStatus(data, key) {
        const a = ACTIVITIES.find(x => x.key === key);
        if (usesAccuracy(data.settings, key)) {
            const need = data.settings[a.countField] ?? 1;
            const acc  = data.accuracy && data.accuracy[a.todayKey];
            if (acc && acc.met)        return { isDone: true, pct: 100, text: `${need} / ${need} ✓` };
            if (!acc || !acc.attempts) return { isDone: false, pct: 0, text: `0 / ${need}` };
            const recentPct = Math.round(acc.recent_correct / acc.window * 100);
            return {
                isDone: false,
                pct:    Math.floor(acc.fraction * 100),
                text:   `${Math.min(acc.correct, need)} / ${need} · ${recentPct}% (need ${data.settings.sat_accuracy_pct}%)`,
            };
        }
        const required = data.settings[a.countField] ?? 1;
        const done     = Math.min((data.today && data.today[a.todayKey]) ?? 0, required);
        const isDone   = done >= required;
        return {
            isDone,
            pct:  required ? Math.round(done / required * 100) : 0,
            text: isDone ? `${done} / ${required} ✓` : `${done} / ${required}`,
        };
    }

    const api = { ACTIVITIES, KEYS, parse, includes, isEither, serialize, isValid, usesAccuracy, accuracyRule, todayStatus };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Activities = api;
})(typeof window !== 'undefined' ? window : globalThis);
