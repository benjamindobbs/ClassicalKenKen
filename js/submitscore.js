async function onSignedIn() {
    try {
        const rank = await getRank();
        const pd = document.getElementById('playerData');
        if (pd) pd.innerHTML = 'Current Rank ' + Math.floor(rank);
    } catch (e) {}
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
