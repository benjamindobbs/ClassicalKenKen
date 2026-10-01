// Anti-spam pacing for SAT English / SAT Math (both pages share these IDs).
// The server discards any answer submitted under 10s after the question was
// served and replies { flagged: true } (server/satPace.js). Here that becomes
// a yellow clock pop, a "too fast" result card, and a 15s countdown on the
// next question with its answers greyed out until it ends.
//
// The lockout survives a page reload (sessionStorage), so refreshing doesn't
// skip it.

const SatPace = (function () {
    const LOCK_MS = 15000;
    const KEY     = 'satPaceLock';   // 'pending' | <unlock time in ms>
    let tick = null;

    const CLOCK_SVG =
        '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 7v5l3 2"/></svg>';

    function load()     { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } }
    function save(v)    { try { sessionStorage.setItem(KEY, v); } catch (_) {} }
    function clear()    { try { sessionStorage.removeItem(KEY); } catch (_) {} }

    // Server flagged the last answer: pop the clock, show why on the result
    // card (without revealing the answer), and arm the next question's lockout.
    function showTooFast(minMs) {
        save('pending');

        const pop = document.createElement('div');
        pop.className = 'result-pop result-pop--slow';
        pop.innerHTML = CLOCK_SVG;
        document.body.appendChild(pop);
        setTimeout(function () { pop.remove(); }, 1000);

        const secs  = Math.round((minMs || 10000) / 1000);
        const badge = document.getElementById('rationale-badge');
        badge.innerHTML = CLOCK_SVG + ' Too fast &mdash; this answer wasn&rsquo;t counted';
        badge.className = 'rationale-result-badge rationale-result-badge--slow';
        const r = document.getElementById('Rationale');
        r.innerHTML = '<p>You answered less than ' + secs + ' seconds after the question appeared, so it wasn&rsquo;t saved. ' +
                      'Read the next question carefully. Its answers unlock after ' + (LOCK_MS / 1000) + ' seconds.</p>';
        r.style.background  = '#fefce8';
        r.style.borderColor = '#fde68a';
        document.getElementById('nextquestion').disabled = false;
        document.getElementById('rationale-overlay').style.display = '';
    }

    function options() { return document.querySelectorAll('#questionDiv .answer-option'); }

    function setLocked(locked) {
        options().forEach(function (opt) {
            opt.classList.toggle('answer-option--locked', locked);
            const input = opt.querySelector('input[type="radio"]');
            if (input) input.disabled = locked;
        });
    }

    function timerEl() {
        let el = document.getElementById('sat-pace-timer');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sat-pace-timer';
            el.className = 'sat-pace-timer';
            el.setAttribute('role', 'timer');
            const q = document.getElementById('Question');
            q.parentNode.insertBefore(el, q);
        }
        return el;
    }

    function render(until) {
        const left = Math.ceil((until - Date.now()) / 1000);
        if (left <= 0) {
            clearInterval(tick); tick = null;
            clear();
            timerEl().style.display = 'none';
            setLocked(false);
            return;
        }
        const el = timerEl();
        el.innerHTML = CLOCK_SVG + ' <span>Read carefully. Answers unlock in <strong>' + left + 's</strong></span>';
        el.style.display = '';
    }

    // Call after every new question is on screen (and its radios re-enabled).
    // Starts an armed lockout, or re-applies one still running (e.g. after a
    // Report skipped to another question, or a reload mid-countdown).
    function onQuestionShown() {
        let v = load();
        if (v === 'pending') { v = String(Date.now() + LOCK_MS); save(v); }
        const until = Number(v);
        if (!until || until <= Date.now()) {
            if (v) clear();
            if (document.getElementById('sat-pace-timer')) timerEl().style.display = 'none';
            return;
        }
        setLocked(true);
        render(until);
        clearInterval(tick);
        tick = setInterval(function () { render(until); }, 250);
    }

    return { showTooFast, onQuestionShown };
})();
