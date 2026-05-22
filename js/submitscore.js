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
    document.getElementById('playerData').innerHTML = 'Playing locally';
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

        // Display player email in header
        const identity = await getIdentity();
        document.getElementById('playerData').innerHTML = identity;

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

async function getIdentity() {
    const res = await fetch(
        'https://www.googleapis.com/oauth2/v1/userinfo?access_token=' + accessToken
    );
    const data = await res.json();
    return data.email;
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

async function writeScore(score, size) {
    if (localMode) {
        document.getElementById('submitMessage').innerHTML = 'Local mode — score not saved';
        return 1;
    }
    try {
        const res = await authFetch('/api/kenken/score', {
            method: 'POST',
            body: JSON.stringify({ score, size }),
        });
        const data = await res.json();
        document.getElementById('submitMessage').innerHTML = 'Score submitted';
        return data.rank;
    } catch (err) {
        console.error(err);
        document.getElementById('submitMessage').innerHTML = 'Error submitting score';
        return 1;
    }
}

async function getRank() {
    if (localMode) return 1;
    try {
        const res = await authFetch('/api/kenken/rank');
        const data = await res.json();
        return data.rank;
    } catch (err) {
        console.error(err);
        return 1;
    }
}
