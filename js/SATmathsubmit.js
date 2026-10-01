async function onSignedIn() {
    await ClassPicker.init('sat-math');
    const slot = document.getElementById('class-picker-slot');
    if (slot) ClassPicker.render(slot);
    ClassPicker.onChange(cid => {
        if (typeof onActiveClassChange === 'function') onActiveClassChange(cid);
        initDailyProgress('sat-math', cid);
    });
    initDailyProgress('sat-math', ClassPicker.activeClassId());
}

// Resolves to the server's reply ({ ok } or { ok, flagged, min_ms } when the
// answer came too fast and was discarded — server/satPace.js), or undefined.
async function writeScore(correct, domainIdx, skill, difficulty, assessment) {
    if (localMode) {
        document.getElementById('submitMessage').innerHTML = 'Local mode — score not saved';
        return;
    }
    try {
        const res = await authFetch('/api/sat-math/score', {
            method: 'POST',
            body: JSON.stringify({
                correct: correct ? 1 : 0, domainIdx, skill, difficulty, assessment,
                class_id: ClassPicker.activeClassId(),
            }),
        });
        const data = await res.json().catch(() => undefined);
        // Every answer can move SAT accuracy-mode progress, not just correct ones.
        if (!data?.flagged) refreshDailyProgress('sat-math', ClassPicker.activeClassId());
        return data;
    } catch (err) {
        console.error(err);
        document.getElementById('submitMessage').innerHTML = 'Error submitting score';
    }
}

async function getQuestionData() {
    if (localMode) return { domainIdx: Math.floor(Math.random() * 4), skill: '', difficulty: 'Easy' };
    try {
        const cid = ClassPicker.activeClassId();
        const res = await authFetch('/api/sat-math/next' + (cid != null ? '?class_id=' + cid : ''));
        return await res.json();
    } catch (err) {
        console.error(err);
        return { domainIdx: Math.floor(Math.random() * 4), skill: '', difficulty: 'Easy' };
    }
}
