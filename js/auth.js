const CLIENT_ID = '245572615958-jg9jin9k68eh70pk659ifhjc8unbopta.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/userinfo.email';
const SESSION_KEY = 'classtech_session';

let tokenClient;
let sessionToken = localStorage.getItem(SESSION_KEY) || null;
let gisInited = false;
let localMode = false;
let sessionChecked = !sessionToken;

function playLocally() {
    localMode = true;
    document.getElementById('landing').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
    const pd = document.getElementById('playerData');
    if (pd) pd.innerHTML = 'Playing locally';
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '',
    });
    gisInited = true;
    if (sessionChecked) maybeEnableButtons();
}

function maybeEnableButtons() {
    document.getElementById('authorize_button').disabled = false;
    document.getElementById('landing_status').style.display = 'none';
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) { console.error('Auth error:', resp); return; }
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: resp.access_token }),
            });
            if (!res.ok) {
                const el = document.getElementById('landing_status');
                el.innerText = 'Sign-in failed. Please use a school account.';
                el.style.display = '';
                return;
            }
            const data = await res.json();
            sessionToken = data.sessionToken;
            localStorage.setItem(SESSION_KEY, sessionToken);
            completeSignIn();
        } catch (err) {
            console.error('Login error:', err);
        }
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignoutClick() {
    sessionToken = null;
    localStorage.removeItem(SESSION_KEY);
    document.getElementById('game-ui').style.display = 'none';
    document.getElementById('landing').style.display = 'flex';
    document.getElementById('signout_button').style.display = 'none';
    document.getElementById('authorize_button').innerText = 'Sign In with Google';
}

function completeSignIn() {
    document.getElementById('landing').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
    document.getElementById('signout_button').style.display = '';
    document.getElementById('authorize_button').innerText = 'Refresh';
    if (typeof onSignedIn === 'function') onSignedIn();
}

function authFetch(path, options = {}) {
    return fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + sessionToken,
            ...(options.headers || {}),
        },
    });
}

// Attempt to restore session immediately — no GIS needed
if (sessionToken) {
    fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + sessionToken } })
        .then(res => {
            if (res.ok) { completeSignIn(); return; }
            localStorage.removeItem(SESSION_KEY);
            sessionToken = null;
            sessionChecked = true;
            if (gisInited) maybeEnableButtons();
        })
        .catch(() => {
            localStorage.removeItem(SESSION_KEY);
            sessionToken = null;
            sessionChecked = true;
            if (gisInited) maybeEnableButtons();
        });
}
