// "How to play" panel for the practice games: a collapsible section below the
// game, open by default. Remembers on this device whether the student
// collapsed it, shows only the section for the current task, and can reopen
// once to flag a rule that just became relevant (e.g. on reaching a tier).
//
// Usage:
//   HowToPlay.mount(el, { id: 'ruler', sections: { play: '<p>…</p>', … }, show: 'play' })
//   HowToPlay.show('build')                      switch the visible section
//   HowToPlay.announce('hidden-lines', '<p>…</p>')  first time only: open the
//                                                panel with this note on top

const HowToPlay = (function () {
    let _el = null, _details = null, _note = null, _id = '';

    const key = k => `howtoplay:${_id}:${k}`;
    function load(k) { try { return localStorage.getItem(key(k)); } catch (_) { return null; } }
    function save(k, v) { try { localStorage.setItem(key(k), v); } catch (_) {} }

    function mount(el, { id, sections, show: first }) {
        _el = el; _id = id;
        el.innerHTML = '';
        _details = document.createElement('details');
        _details.className = 'htp';
        _details.open = load('collapsed') !== '1';
        _details.innerHTML = '<summary class="htp-summary">How to play</summary>';

        _note = document.createElement('div');
        _note.className = 'htp-note';
        _note.hidden = true;
        _details.appendChild(_note);

        for (const [name, html] of Object.entries(sections)) {
            const sec = document.createElement('div');
            sec.className = 'htp-section';
            sec.dataset.htp = name;
            sec.innerHTML = html;
            _details.appendChild(sec);
        }
        // 'toggle' also fires for programmatic opens, so announce() opening
        // the panel doesn't overwrite a student's saved choice until they act.
        _details.addEventListener('toggle', () => {
            if (!_details.dataset.auto) save('collapsed', _details.open ? '0' : '1');
            delete _details.dataset.auto;
        });
        el.appendChild(_details);
        show(first || Object.keys(sections)[0]);
    }

    function show(name) {
        if (!_details) return;
        _details.querySelectorAll('.htp-section').forEach(s => { s.hidden = s.dataset.htp !== name; });
    }

    function announce(ruleKey, html) {
        if (!_details) return false;
        let seen = [];
        try { seen = JSON.parse(load('seen') || '[]'); } catch (_) {}
        if (seen.includes(ruleKey)) return false;
        seen.push(ruleKey);
        save('seen', JSON.stringify(seen));

        // Several rules can switch on at once — stack them under one "Got it".
        if (_note.hidden) {
            _note.innerHTML = '<span class="htp-note-badge">New</span><div class="htp-note-body"></div>'
                + '<button type="button" class="btn btn-outline btn-sm htp-note-dismiss">Got it</button>';
            _note.querySelector('.htp-note-dismiss').addEventListener('click', () => { _note.hidden = true; });
        }
        _note.querySelector('.htp-note-body').insertAdjacentHTML('beforeend', html);
        _note.hidden = false;
        if (!_details.open) { _details.dataset.auto = '1'; _details.open = true; }
        return true;
    }

    return { mount, show, announce };
})();
