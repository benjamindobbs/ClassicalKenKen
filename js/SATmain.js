var questionTypes = null;
var currentDomainIdx = 0;
var currentSkill = '';
var currentDifficulty = 'Easy';
var json = [];
var roll = 0;

document.getElementById('Rationale').style.visibility = 'hidden';
document.getElementById('nextquestion').disabled = true;
document.getElementById('submit').disabled = true;

var selectedAnswer = '';
const radios = document.querySelectorAll('input[name="answer"]');
radios.forEach(radio => {
    radio.addEventListener('click', function () {
        document.getElementById('submit').disabled = false;
        selectedAnswer = radio.id;
    });
});

async function ensureQuestionsLoaded() {
    if (questionTypes) return;
    const all = await fetch('../SAT-Questions/2026-SAT-Questions.json').then(r => r.json());
    const DOMAINS = ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', ''];
    const valid = all.filter(q => DOMAINS.includes(q.Domain) && (q.Domain === '' || (q.Skill && q.Skill.trim())));
    questionTypes = DOMAINS.map(d => valid.filter(q => q.Domain === d));
}

function pickQuestion(pool, skill, difficulty) {
    // Try exact match on skill + difficulty
    if (skill) {
        let filtered = pool.filter(q => q.Skill === skill && q.Difficulty === difficulty);
        if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
        // Fallback: any difficulty for this skill
        filtered = pool.filter(q => q.Skill === skill);
        if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
    }
    // Fallback: match difficulty only
    let filtered = pool.filter(q => q.Difficulty === difficulty);
    if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
    // Last resort: any question in pool
    return pool[Math.floor(Math.random() * pool.length)];
}

function buildQuestion(question) {
    roll = json.indexOf(question);
    document.getElementById('questionDiv').style.display = 'block';
    document.getElementById('submissionButtons').style.visibility = 'visible';
    ['A', 'B', 'C', 'D'].forEach(id => {
        document.getElementById(id).closest('.answer-option').style.background = '';
    });
    const rationaleEl = document.getElementById('Rationale');
    rationaleEl.innerHTML = '';
    rationaleEl.style.background = '';
    rationaleEl.style.borderColor = '';
    document.getElementById('nextquestion').disabled = true;
    document.getElementById('Question').innerHTML = question.Question;
    document.getElementById('A Button').innerHTML = question.A;
    document.getElementById('B Button').innerHTML = question.B;
    document.getElementById('C Button').innerHTML = question.C;
    document.getElementById('D Button').innerHTML = question.D;
}

function submit() {
    document.getElementById('A').disabled = true;
    document.getElementById('B').disabled = true;
    document.getElementById('C').disabled = true;
    document.getElementById('D').disabled = true;
    document.getElementById('submit').disabled = true;

    const question = json[roll];
    const correct = selectedAnswer === question.Answer;

    writeScore(
        correct ? 1 : 0,
        currentDomainIdx,
        question.Skill || '',
        question.Difficulty || currentDifficulty
    );

    if (!correct) {
        document.getElementById(selectedAnswer).closest('.answer-option').style.background = '#fecaca';
        document.getElementById(question.Answer).closest('.answer-option').style.background = '#dcfce7';
    }

    document.getElementById('Rationale').innerHTML = question.Rationale;
    document.getElementById('nextquestion').disabled = false;
    showRationaleOverlay(correct, selectedAnswer, question.Answer);
}

async function nextQuestion() {
    closeRationaleOverlay();
    await ensureQuestionsLoaded();
    document.getElementById('create_button').style.display = 'none';
    document.getElementById('Rationale').innerHTML = '';

    const pulledData = await getQuestionData();
    currentDomainIdx = Number(pulledData.domainIdx);
    currentSkill = pulledData.skill || '';
    currentDifficulty = pulledData.difficulty || 'Easy';

    const pool = questionTypes[currentDomainIdx];
    const question = pickQuestion(pool, currentSkill, currentDifficulty);
    json = pool;

    buildQuestion(question);

    ['A', 'B', 'C', 'D'].forEach(id => {
        document.getElementById(id).disabled = false;
        document.getElementById(id).checked = false;
    });
    selectedAnswer = '';
    document.getElementById('submit').disabled = true;
}

// ── Session summary ──────────────────────────────────────────────────────────
const DOMAIN_DISPLAY = [
    'Information and Ideas',
    'Craft and Structure',
    'Expression of Ideas',
    'Standard English Conventions',
];
const DOMAIN_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f97316'];

async function completeSession() {
    closeRationaleOverlay();
    document.querySelector('.quiz-area').style.display = 'none';
    const view = document.getElementById('session-view');
    view.style.display = 'block';
    view.innerHTML = '<div class="session-loading">Loading session data…</div>';

    if (localMode) {
        view.innerHTML = '<div class="session-loading">Sign in to view your session summary.</div>';
        return;
    }
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const res = await authFetch('/api/sat/session?since=' + startOfDay.getTime());
        const data = await res.json();
        renderSession(data);
    } catch (err) {
        view.innerHTML = '<div class="session-loading" style="color:#ef4444">Error loading session data.</div>';
    }
}

function backToPractice() {
    document.getElementById('session-view').style.display = 'none';
    document.querySelector('.quiz-area').style.display = '';
}

function renderSession(data) {
    const view = document.getElementById('session-view');
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    let totalCorrect = 0, totalAttempts = 0;
    data.domains.forEach(d => d.skills.forEach(s => { totalCorrect += s.correct; totalAttempts += s.total; }));

    let html = '<div class="session-header">';
    html += '<div class="session-header-top">';
    html += '<div><p class="session-date">' + dateStr + '</p>';
    html += '<h2 class="session-title">Session Summary</h2></div>';
    if (totalAttempts > 0) {
        const pct = Math.round(totalCorrect / totalAttempts * 100);
        html += '<div class="session-total-block">';
        html += '<span class="session-total-num">' + totalCorrect + ' / ' + totalAttempts + '</span>';
        html += '<span class="session-total-label">' + pct + '% overall</span>';
        html += '</div>';
    }
    html += '</div>';
    html += '<button class="btn btn-outline session-back-btn" onclick="backToPractice()">&#8592; Back to Practice</button>';
    html += '</div>';

    if (data.domains.length === 0) {
        html += '<div class="session-empty">No questions answered today. Start practicing to see your session summary here.</div>';
        view.innerHTML = html;
        return;
    }

    html += '<div class="session-domains-grid">';
    data.domains.forEach(function(domain) {
        const color = DOMAIN_COLORS[domain.idx] || '#64748b';
        let dc = 0, dt = 0;
        domain.skills.forEach(s => { dc += s.correct; dt += s.total; });

        html += '<div class="session-domain-card">';

        // Domain header strip
        html += '<div class="session-domain-header" style="border-left:3px solid ' + color + '">';
        html += '<span class="session-domain-name" style="color:' + color + '">' + domain.name + '</span>';
        html += '<span class="session-domain-tally">' + dc + ' / ' + dt + '</span>';
        html += '</div>';

        // Skill rows
        html += '<div class="session-skills">';
        domain.skills.forEach(function(skill) {
            html += '<div class="session-skill">';
            html += '<div class="session-skill-row">';
            html += '<span class="session-skill-name">' + (skill.skill || 'General') + '</span>';
            html += '<span class="session-skill-count">' + skill.correct + ' / ' + skill.total + '</span>';
            html += '</div>';

            html += '<div class="session-pills">';
            ['Easy', 'Medium', 'Hard'].forEach(function(diff) {
                const d = skill.byDifficulty[diff];
                if (!d || d.total === 0) return;
                const pct = d.correct / d.total;
                const cls = pct >= 0.8 ? 'pill-good' : pct >= 0.5 ? 'pill-ok' : 'pill-bad';
                html += '<span class="session-pill ' + cls + '">' + diff + ' ' + d.correct + '/' + d.total + '</span>';
            });
            html += '</div>'; // pills

            html += '</div>'; // skill
        });
        html += '</div>'; // skills

        html += '</div>'; // card
    });
    html += '</div>'; // grid

    view.innerHTML = html;
}

async function reportQuestion() {
    if (localMode) { nextQuestion(); return; }
    const question = json[roll];
    try {
        await authFetch('/api/sat/report', {
            method: 'POST',
            body: JSON.stringify({
                questionId: question.ID,
                domainIdx: currentDomainIdx,
            }),
        });
        document.getElementById('submitMessage').innerHTML = 'Question reported';
    } catch (err) {
        console.error(err);
        document.getElementById('submitMessage').innerHTML = 'Error reporting question';
    }
    nextQuestion();
}

function showRationaleOverlay(correct, selected, answer) {
    const badge = document.getElementById('rationale-badge');
    const rationaleEl = document.getElementById('Rationale');
    if (correct) {
        badge.textContent = '✓ Correct!';
        badge.className = 'rationale-result-badge rationale-result-badge--correct';
        rationaleEl.style.background = '#f0fdf4';
        rationaleEl.style.borderColor = '#bbf7d0';
    } else {
        badge.innerHTML = '✗ Incorrect — correct answer was <strong>' + answer + '</strong>';
        badge.className = 'rationale-result-badge rationale-result-badge--incorrect';
        rationaleEl.style.background = '#fefce8';
        rationaleEl.style.borderColor = '#fde68a';
    }
    document.getElementById('rationale-overlay').style.display = '';
}

function closeRationaleOverlay() {
    const el = document.getElementById('rationale-overlay');
    if (el) el.style.display = 'none';
}
