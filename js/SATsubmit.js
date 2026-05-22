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
