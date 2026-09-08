async function onSignedIn() {
    try {
        const data = await getRank();
        const pd = document.getElementById('playerData');
        if (pd) pd.innerHTML = 'Current Rank ' + Math.floor(data.rank);
    } catch (e) {}

    await ClassPicker.init('kenken');
    const slot = document.getElementById('class-picker-slot');
    if (slot) ClassPicker.render(slot);
    ClassPicker.onChange(cid => initDailyProgress('kenken', cid));
    initDailyProgress('kenken', ClassPicker.activeClassId());
}

// Returns the player's new avg score after submitting, or null in local/error cases.
async function writeScore(score, size) {
    if (localMode) {
        document.getElementById('submitMessage').innerHTML = 'Local mode — score not saved';
        return null;
    }
    try {
        const res = await authFetch('/api/kenken/score', {
            method: 'POST',
            body: JSON.stringify({ score, size, class_id: ClassPicker.activeClassId() }),
        });
        const data = await res.json();
        document.getElementById('submitMessage').innerHTML = 'Score submitted';
        refreshDailyProgress('kenken');
        return data.avg;
    } catch (err) {
        console.error(err);
        document.getElementById('submitMessage').innerHTML = 'Error submitting score';
        return null;
    }
}

// Returns { rank, avg } for the current player.
async function getRank() {
    if (localMode) return { rank: 1, avg: 0 };
    try {
        const res = await authFetch('/api/kenken/rank');
        return await res.json();
    } catch (err) {
        console.error(err);
        return { rank: 1, avg: 0 };
    }
}
