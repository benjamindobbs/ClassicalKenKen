(function () {
    const CLIENT_ID = '245572615958-jg9jin9k68eh70pk659ifhjc8unbopta.apps.googleusercontent.com';

    const slot = document.getElementById('nav-auth-slot');
    if (!slot) return;

    const teacherToken = localStorage.getItem('classtech_teacher_session');
    const studentToken  = localStorage.getItem('classtech_session');
    const path = window.location.pathname;

    if (teacherToken) {
        const a = document.createElement('a');
        a.href = '/teacher/';
        a.className = 'nav-teacher' + (path.includes('/teacher') ? ' active' : '');
        a.textContent = 'Teacher Portal';
        slot.appendChild(a);
        return;
    }

    if (studentToken) {
        const a = document.createElement('a');
        a.href = '/student/';
        a.className = 'nav-student' + (path.includes('/student') ? ' active' : '');
        a.textContent = 'My Progress';
        slot.appendChild(a);
        return;
    }

    // Unauthenticated — show Sign In button
    const btn = document.createElement('button');
    btn.className = 'nav-signin-btn';
    btn.textContent = 'Sign In';
    slot.appendChild(btn);

    btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        triggerSignIn();
    });

    function triggerSignIn() {
        function initAndRequest() {
            const tc = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/userinfo.email',
                callback: handleToken,
            });
            tc.requestAccessToken({ prompt: '' });
        }

        // GIS already loaded (e.g. on KenKen / SAT pages)
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
            initAndRequest();
            return;
        }

        // GIS script already in DOM but still loading
        const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
        if (existing) {
            existing.addEventListener('load', initAndRequest);
            return;
        }

        // Load GIS fresh (homepage, Skill Maps, ReadMe)
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = initAndRequest;
        s.onerror = function () { resetBtn(); };
        document.head.appendChild(s);
    }

    async function handleToken(resp) {
        if (resp.error) { resetBtn(); return; }
        try {
            const info = await fetch(
                'https://www.googleapis.com/oauth2/v3/userinfo',
                { headers: { Authorization: 'Bearer ' + resp.access_token } }
            ).then(function (r) { return r.json(); });

            const email  = (info.email || '').toLowerCase();
            const domain = email.split('@')[1] || '';
            const isStudent = domain === 'students.hartfordschools.org';
            const isTeacher = domain === 'hartfordschools.org';

            if (!isStudent && !isTeacher) {
                btn.textContent = 'School account required';
                btn.disabled = false;
                return;
            }

            const endpoint = isStudent ? '/api/auth/login' : '/api/teacher/login';
            const loginRes = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: resp.access_token }),
            });

            if (!loginRes.ok) { resetBtn(); return; }

            const data = await loginRes.json();
            const key   = isStudent ? 'classtech_session' : 'classtech_teacher_session';
            localStorage.setItem(key, data.sessionToken);
            location.reload();
        } catch (err) {
            console.error('Nav sign-in error:', err);
            resetBtn();
        }
    }

    function resetBtn() {
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
})();
