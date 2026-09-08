// Shared class picker for the practice apps (KenKen / SAT English / SAT Math).
//
// A student on more than one roster needs to complete each class's Do Now
// separately — served that class's domains, with the submission attributed to
// that class. This module fetches the student's classes, renders a <select>,
// remembers the choice, and exposes the active class_id to the page.
//
// Public API:
//   await ClassPicker.init(activity)   'kenken' | 'sat' | 'sat-math'
//   ClassPicker.render(slotEl)         draw/refresh a <select> in slotEl (repeatable)
//   ClassPicker.activeClassId()        number, or null for "not for a class" / unset
//   ClassPicker.activeClass()          the full class row, or null
//   ClassPicker.needsChoice()          true when >1 relevant class and none chosen yet
//   ClassPicker.onChange(cb)           cb(classId) whenever the user changes it
//   ClassPicker.flash()                briefly highlight the picker (prompt a choice)
//   ClassPicker.classes                relevant classes (after init)

const ClassPicker = (function () {
    const LS_KEY = 'classtech_active_class';
    const RELEVANT = {
        'kenken':   ['kenken', 'both', 'either', 'kenken-math', 'all'],
        'sat':      ['sat', 'both', 'either', 'sat-both', 'all'],
        'sat-math': ['sat-math', 'sat-both', 'kenken-math', 'all'],
    };

    let _all = [];             // relevant classes only
    let _choice = undefined;   // number | null (not for a class) | undefined (unchosen)
    const _cbs = [];
    const _slots = [];
    let _readyResolve;
    const _ready = new Promise(r => { _readyResolve = r; });

    function _isLocal() { return typeof localMode !== 'undefined' && localMode; }

    function _loadStored() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw === 'none') return null;
            if (raw == null || raw === '') return undefined;
            const n = Number(raw);
            return Number.isInteger(n) ? n : undefined;
        } catch (_) { return undefined; }
    }
    function _store(v) {
        try {
            if (v === null) localStorage.setItem(LS_KEY, 'none');
            else if (v === undefined) localStorage.removeItem(LS_KEY);
            else localStorage.setItem(LS_KEY, String(v));
        } catch (_) {}
    }

    async function init(activity) {
        if (_isLocal()) { _all = []; return; }
        try {
            const res = await authFetch('/api/student/classes');
            if (res.ok) {
                const data = await res.json();
                const ok = RELEVANT[activity] || [];
                _all = (data.classes || []).filter(c => ok.includes(c.required_activity));
            }
        } catch (_) { _all = []; }

        const stored = _loadStored();
        if (stored === null)                              _choice = null;
        else if (_all.some(c => c.class_id === stored))   _choice = stored;
        else if (_all.length === 1)                       _choice = _all[0].class_id;
        else                                             _choice = undefined;
        _redraw();
        _readyResolve();
    }

    // Resolves once init() has finished (or immediately for callers that don't
    // gate on it). Lets the SAT pages avoid loading the wrong question bank in
    // the gap between sign-in and the class list arriving.
    function ready() { return _ready; }

    function activeClassId() { return _choice == null ? null : _choice; }
    function activeClass()   { return _all.find(c => c.class_id === _choice) || null; }
    function needsChoice()   { return _all.length > 1 && _choice === undefined; }
    function onChange(cb)    { if (typeof cb === 'function') _cbs.push(cb); }

    function _set(v) {
        _choice = v;
        _store(v);
        _redraw();
        _cbs.forEach(cb => { try { cb(activeClassId()); } catch (_) {} });
    }

    function render(slotEl) {
        if (slotEl && !_slots.includes(slotEl)) _slots.push(slotEl);
        _redraw();
    }

    function flash() {
        for (const slot of _slots) {
            const sel = slot.querySelector('select');
            if (!sel) continue;
            sel.classList.add('class-picker-select--needed');
            setTimeout(() => sel.classList.remove('class-picker-select--needed'), 1200);
        }
    }

    function _redraw() {
        for (const slot of _slots) {
            slot.innerHTML = '';
            if (_isLocal() || _all.length === 0) { slot.style.display = 'none'; continue; }
            slot.style.display = '';

            const sel = document.createElement('select');
            sel.className = 'class-picker-select';
            sel.setAttribute('aria-label', 'Class this Do Now is for');

            if (needsChoice()) {
                const o = document.createElement('option');
                o.value = ''; o.textContent = 'Which class is this for?';
                o.disabled = true; o.selected = true;
                sel.appendChild(o);
            }
            for (const c of _all) {
                const o = document.createElement('option');
                o.value = String(c.class_id);
                o.textContent = c.name;
                if (c.class_id === _choice) o.selected = true;
                sel.appendChild(o);
            }
            const free = document.createElement('option');
            free.value = 'none';
            free.textContent = 'Not for a class';
            if (_choice === null) free.selected = true;
            sel.appendChild(free);

            sel.addEventListener('change', () => {
                _set(sel.value === 'none' ? null : Number(sel.value));
            });
            slot.appendChild(sel);
        }
    }

    return {
        init, render, ready, activeClassId, activeClass, needsChoice, onChange, flash,
        get classes() { return _all; },
    };
})();
