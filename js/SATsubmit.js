/* exported gapiLoaded */
/* exported gisLoaded */
/* exported handleAuthClick */
/* exported handleSignoutClick */

const CLIENT_ID = '245572615958-jg9jin9k68eh70pk659ifhjc8unbopta.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/userinfo.email';

let tokenClient;
let accessToken = null;
let gisInited = false;
let localMode = false;

function playLocally() {
    localMode = true;
    document.getElementById('landing').style.display = 'none';
    document.getElementById('game-ui').style.display = 'block';
}

function gapiLoaded() {
    // No Sheets API needed — kept as no-op for the script tag onload attribute
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '',
    });
    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gisInited) {
        document.getElementById('authorize_button').disabled = false;
        document.getElementById('landing_status').style.display = 'none';
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) throw resp;
        accessToken = resp.access_token;
        document.getElementById('landing').style.display = 'none';
        document.getElementById('game-ui').style.display = 'block';
        document.getElementById('signout_button').style.display = '';
        document.getElementById('authorize_button').innerText = 'Refresh';
    };

    if (!accessToken) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function handleSignoutClick() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken);
        accessToken = null;
        document.getElementById('game-ui').style.display = 'none';
        document.getElementById('landing').style.display = 'flex';
        document.getElementById('signout_button').style.display = 'none';
        document.getElementById('authorize_button').innerText = 'Sign In with Google';
    }
}

function authFetch(path, options = {}) {
    return fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
            ...(options.headers || {}),
        },
    });
}

async function writeScore(correct, domainIdx, skill, difficulty) {
    if (localMode) {
        document.getElementById('submitMessage').innerHTML = 'Local mode — score not saved';
        return;
    }
    try {
        await authFetch('/api/sat/score', {
            method: 'POST',
            body: JSON.stringify({ correct: correct ? 1 : 0, domainIdx, skill, difficulty }),
        });
    } catch (err) {
        console.error(err);
        document.getElementById('submitMessage').innerHTML = 'Error submitting score';
    }
}

async function getQuestionData() {
    if (localMode) return { domainIdx: Math.floor(Math.random() * 4), skill: '', difficulty: 'Easy' };
    try {
        const res = await authFetch('/api/sat/next');
        return await res.json();
    } catch (err) {
        console.error(err);
        return { domainIdx: Math.floor(Math.random() * 4), skill: '', difficulty: 'Easy' };
    }
}
