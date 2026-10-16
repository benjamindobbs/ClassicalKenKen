// Shared shell for every Staff Hub page: header, nav, global search, demo
// controls, API helper. Pages call Hub.start(cap, async me => { ... }).

(function () {
    const API = '/api/staff';
    const store = {
        get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
        set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* storage blocked */ } },
    };

    // ?date= / ?time= on the page URL pin the demo clock for this tab.
    const params = new URLSearchParams(location.search);
    if (params.has('date')) store.set('staffhub.date', params.get('date'), sessionStorage);
    if (params.has('time')) store.set('staffhub.time', params.get('time'), sessionStorage);
    // ?as=<staff id> picks the demo persona (handy for links in a walkthrough). Ignored outside demo mode by the server.
    if (params.has('as')) store.set('staffhub.user', params.get('as'));

    const theme = store.get('staffhub.theme');
    if (theme) document.documentElement.dataset.theme = theme;

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clock = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`; };
    const range = (a, b) => `${clock(a)}–${clock(b)}`;
    const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
        d ? new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' }) : '';
    const periods = p => {
        if (!p || p === 'ALL') return 'all day';
        if (p === 'LUNCH') return 'lunch';
        if (p === 'AFTER') return 'after school';
        const n = p.split(',').map(Number).sort((a, b) => a - b);
        const contiguous = n.every((x, i) => !i || x === n[i - 1] + 1);
        return n.length > 1 && contiguous ? `P${n[0]}–${n[n.length - 1]}` : n.map(x => `P${x}`).join(', ');
    };

    async function api(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const user = store.get('staffhub.user');
        const date = store.get('staffhub.date', sessionStorage);
        const time = store.get('staffhub.time', sessionStorage);
        if (user) headers['X-Staff-User'] = user;
        if (date) headers['X-Staff-Date'] = date;
        if (time) headers['X-Staff-Time'] = time;
        let body = opts.body;
        if (body && typeof body !== 'string') { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
        const res = await fetch(API + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('json') ? await res.json() : await res.text();
        if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status, data });
        return data;
    }

    function toast(msg, ms = 3500) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), ms);
    }

    const NAV = [
        ['index.html', 'Today', 'view_today'],
        ['links.html', 'Links', 'view_links'],
        ['contacts.html', 'Who to contact', 'view_faq'],
        ['directory.html', 'Directory', 'view_directory'],
        ['students.html', 'Students', 'view_students'],
        ['lists.html', 'Student lists', 'view_flags'],
        ['discipline.html', 'Discipline', 'view_serves'],
        ['trips.html', 'Field trips', 'view_trips'],
        ['schedule.html', 'Schedule', 'view_schedule'],
        ['memo.html', 'Memo', 'view_memo'],
        ['admin-imports.html', 'Imports', 'import'],
        ['admin-users.html', 'Users', 'manage_users'],
        ['admin-audit.html', 'Audit log', 'view_audit'],
    ];

    function currentPage() {
        const f = location.pathname.split('/').pop();
        return f && f.endsWith('.html') ? f : 'index.html';
    }

    function renderHeader(config, me, personas) {
        const header = document.createElement('div');
        const navLinks = me ? NAV.filter(n => me.caps.includes(n[2])) : [];
        const date = store.get('staffhub.date', sessionStorage) || '';
        const time = store.get('staffhub.time', sessionStorage) || '';
        header.innerHTML = `
            ${config.demo ? '<div class="demo-banner">DEMO DATA — all names, IDs and records are fictional</div>' : ''}
            <div class="topbar"><div class="topbar-row">
                <a class="brand" href="index.html">${esc(config.school)} <span>· Staff Hub</span></a>
                ${me ? `<div class="search">
                    <input type="search" id="hub-search" placeholder="Search links, people, contacts${me.caps.includes('view_students') ? ', students' : ''}…" autocomplete="off" aria-label="Search">
                    <div class="search-results" id="hub-search-results" hidden></div>
                </div>` : '<div class="spacer"></div>'}
                ${config.demo ? `<div class="demo-controls">
                    <select id="hub-persona" aria-label="Demo role">
                        ${me ? '' : '<option value="">Choose a role…</option>'}
                        ${personas.map(p => `<option value="${p.id}" ${me && me.id === p.id ? 'selected' : ''}>${esc(p.label)} — ${esc(p.name)}</option>`).join('')}
                    </select>
                    <input type="date" id="hub-date" value="${esc(date || config.realToday)}" title="Demo date" aria-label="Demo date">
                    <input type="time" id="hub-time" value="${esc(time)}" title="Demo time (blank = real time)" aria-label="Demo time">
                    ${date || time ? '<button class="icon-btn" id="hub-reset" title="Back to real date and time">Reset</button>' : ''}
                </div>` : ''}
                <button class="icon-btn" id="hub-theme" title="Toggle light/dark">◐</button>
            </div></div>
            ${navLinks.length ? `<nav class="nav"><div class="nav-inner">
                ${navLinks.map(([href, label]) => `<a href="${href}" class="${currentPage() === href ? 'current' : ''}">${label}</a>`).join('')}
            </div></nav>` : ''}`;
        document.body.prepend(header);

        document.getElementById('hub-theme').onclick = () => {
            const dark = document.documentElement.dataset.theme
                ? document.documentElement.dataset.theme === 'dark'
                : matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.dataset.theme = dark ? 'light' : 'dark';
            store.set('staffhub.theme', document.documentElement.dataset.theme);
        };
        if (config.demo) {
            document.getElementById('hub-persona').onchange = e => { store.set('staffhub.user', e.target.value || null); location.reload(); };
            document.getElementById('hub-date').onchange = e => {
                store.set('staffhub.date', e.target.value && e.target.value !== config.realToday ? e.target.value : null, sessionStorage);
                reloadClean();
            };
            document.getElementById('hub-time').onchange = e => { store.set('staffhub.time', e.target.value || null, sessionStorage); reloadClean(); };
            const reset = document.getElementById('hub-reset');
            if (reset) reset.onclick = () => {
                store.set('staffhub.date', null, sessionStorage);
                store.set('staffhub.time', null, sessionStorage);
                reloadClean();
            };
        }
        if (me) wireSearch();
    }

    // Drop ?date=/?time= so the stored override wins after a change.
    function reloadClean() {
        const p = new URLSearchParams(location.search);
        p.delete('date'); p.delete('time');
        location.search = p.toString();
    }

    const KIND_LABEL = { link: 'Links', faq: 'Who to contact', staff: 'Staff', event: 'Events', student: 'Students' };

    function wireSearch() {
        const input = document.getElementById('hub-search');
        const box = document.getElementById('hub-search-results');
        let timer, seq = 0, active = -1;
        const close = () => { box.hidden = true; active = -1; };
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < 2) return close();
            timer = setTimeout(async () => {
                const mine = ++seq;
                const r = await api(`/search?q=${encodeURIComponent(q)}`).catch(() => null);
                if (mine !== seq || !r) return;
                const kinds = Object.keys(r.groups);
                box.innerHTML = kinds.length ? kinds.map(k => `<h4>${KIND_LABEL[k] || k}</h4>` + r.groups[k].map(hit =>
                    `<a href="${esc(hit.href)}" ${hit.external ? 'target="_blank" rel="noopener"' : ''}>${esc(hit.title)}<span class="sub">${esc(hit.sub || '')}</span></a>`
                ).join('')).join('') : '<div class="empty">No matches</div>';
                box.hidden = false;
                active = -1;
            }, 150);
        });
        input.addEventListener('keydown', e => {
            const items = [...box.querySelectorAll('a')];
            if (e.key === 'Escape') return close();
            if (!items.length || box.hidden) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items.forEach((a, i) => a.classList.toggle('active', i === active));
            } else if (e.key === 'Enter') {
                (items[active] || items[0]).click();
            }
        });
        document.addEventListener('click', e => { if (!e.target.closest('.search')) close(); });
        document.addEventListener('keydown', e => {
            if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
        });
    }

    let ME = null;

    async function start(cap, init) {
        const main = document.querySelector('main');
        const config = await api('/config');
        let personas = [];
        if (config.demo) {
            personas = await api('/demo/personas');
            // Default demo user: the demo teacher.
            if (!store.get('staffhub.user')) {
                const t = personas.find(p => p.role === 'teacher');
                if (t) store.set('staffhub.user', String(t.id));
            }
        }
        try {
            ME = await api('/me');
        } catch (e) {
            if (e.status !== 401) throw e;
            if (config.demo) store.set('staffhub.user', null);
        }
        renderHeader(config, ME, personas);
        if (!ME) {
            main.innerHTML = config.demo
                ? '<div class="card"><h2>Choose a demo role</h2><p class="muted">Pick a role from the menu at the top to sign in as a fictional staff member.</p></div>'
                : '<div class="card"><h2>Sign-in coming soon</h2><p class="muted">Staff Hub will use your school Google account. It isn\'t switched on yet.</p></div>';
            return;
        }
        if (cap && !ME.caps.includes(cap)) {
            main.innerHTML = `<div class="card"><h2>Not available</h2><p class="muted">This page isn't available for the ${esc(ME.roleLabel)} role.</p></div>`;
            return;
        }
        try {
            await init(ME, config);
        } catch (e) {
            console.error(e);
            main.insertAdjacentHTML('afterbegin', `<div class="card error">Something went wrong: ${esc(e.message)}</div>`);
        }
    }

    // Student picker: text input + suggestion list. onPick({dcid, ...}).
    function studentPicker(input, onPick) {
        const list = document.createElement('div');
        list.className = 'search-results';
        list.hidden = true;
        input.parentElement.style.position = 'relative';
        input.insertAdjacentElement('afterend', list);
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < 2) { list.hidden = true; return; }
            timer = setTimeout(async () => {
                const rows = await api(`/students?q=${encodeURIComponent(q)}`);
                list.innerHTML = rows.length ? rows.map(s =>
                    `<a href="#" data-dcid="${s.dcid}">${esc(s.first)} ${esc(s.last)}<span class="sub">#${esc(s.student_number)} · Grade ${s.grade}</span></a>`).join('')
                    : '<div class="empty">No students found</div>';
                list.hidden = false;
                list.querySelectorAll('a').forEach(a => a.onclick = ev => {
                    ev.preventDefault();
                    const s = rows.find(r => String(r.dcid) === a.dataset.dcid);
                    list.hidden = true;
                    onPick(s);
                });
            }, 150);
        });
        document.addEventListener('click', e => { if (e.target !== input && !list.contains(e.target)) list.hidden = true; });
    }

    // Same-day alert result from POST /flags or /serves, as HTML.
    function alertHtml(a) {
        if (!a) return '';
        const who = a.teachers.map(t => `<li>${esc(t.name)} — ${esc(t.period)} at ${clock(t.start)}</li>`).join('');
        return `<div class="alert-box"><strong>Alert queued for ${a.count} teacher${a.count === 1 ? '' : 's'}</strong>
            <span class="muted small">(who still see this student after ${clock(a.asOf)} today; ${a.seeingToday} see them today in total)</span>
            ${who ? `<ul style="margin:6px 0 0 18px">${who}</ul>` : ''}
            <div class="muted small" style="margin-top:4px">Demo: alerts are logged to the server console, not sent.</div></div>`;
    }

    const FLAG_TYPES = [
        ['pass_restriction', 'Pass restriction'], ['elevator_pass', 'Elevator pass'], ['tech_restriction', 'Tech restriction'],
        ['morning_search', 'Morning search'], ['accommodation', 'Accommodation'], ['has_safety_plan', 'Has safety plan'],
        ['has_iep', 'Has IEP'], ['has_504', 'Has 504'], ['student_senate', 'Student Senate'],
    ];

    window.Hub = {
        api, start, toast, esc, clock, range, fmtDate, periods, studentPicker, alertHtml, FLAG_TYPES,
        today: () => store.get('staffhub.date', sessionStorage) || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
        can: cap => !!ME && ME.caps.includes(cap),
        get me() { return ME; },
    };
})();
