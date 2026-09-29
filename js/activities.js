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
        { key: 'sat-math',    label: 'SAT Math',    countField: 'required_sat_math_count',    todayKey: 'sat_math' },
        { key: 'sat',         label: 'SAT English', countField: 'required_sat_count',         todayKey: 'sat' },
        { key: 'measurement', label: 'Ruler Game',  countField: 'required_measurement_count', todayKey: 'measurement' },
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

    const api = { ACTIVITIES, KEYS, parse, includes, isEither, serialize, isValid };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Activities = api;
})(typeof window !== 'undefined' ? window : globalThis);
