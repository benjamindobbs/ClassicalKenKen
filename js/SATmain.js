var questionTypes    = null;
var assessmentType   = 'sat';
var loadingPromise   = null;
var currentDomainIdx = 0;
var currentSkill     = '';
var currentDifficulty = 'Easy';
var json = [];
var roll = 0;

document.getElementById('Rationale').innerHTML = '';
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

const ENGLISH_QUESTION_FILES = {
    'sat':        '../SAT-Questions/SAT-English-Questions.json',
    'psat-nmsqt': '../SAT-Questions/PSAT-English-Questions.json',
    'psat89':     '../SAT-Questions/PSAT89-English-Questions.json',
};

async function _doLoadEnglishQuestions() {
    if (!localMode) {
        try {
            // Scope to the picked class so the right bank (SAT / PSAT 10 / PSAT 8/9) loads.
            if (typeof ClassPicker !== 'undefined') await ClassPicker.ready();
            const cid = (typeof ClassPicker !== 'undefined') ? ClassPicker.activeClassId() : null;
            const prog = await authFetch('/api/student/daily-progress' + (cid != null ? '?class_id=' + cid : ''))
                .then(r => r.json());
            if (prog && prog.assessment_type) assessmentType = prog.assessment_type;
        } catch {}
    }

    const url = ENGLISH_QUESTION_FILES[assessmentType] || ENGLISH_QUESTION_FILES['sat'];
    const all = await fetch(url).then(r => r.json());

    var suspended = new Set();
    if (!localMode) {
        try {
            const ids = await authFetch('/api/questions/suspended?subject=english').then(r => r.json());
            suspended = new Set(ids);
        } catch {}
    }

    // Order matches domain_idx on the server (sat_scores, /api/sat/next).
    const DOMAINS = ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions'];
    const valid = all.filter(q => {
        if (suspended.has(q.ID)) return false;
        return DOMAINS.includes(q.Domain) && q.Skill && q.Skill.trim();
    });
    questionTypes = DOMAINS.map(d => valid.filter(q => q.Domain === d));
}

async function ensureQuestionsLoaded() {
    if (questionTypes) return;
    if (!loadingPromise) loadingPromise = _doLoadEnglishQuestions();
    return loadingPromise;
}

// The class picker calls this when the student switches class. A different class
// may use a different question bank (SAT vs PSAT), so drop the cache; if a
// question is on screen, pull a fresh one for the new class.
async function onActiveClassChange() {
    questionTypes = null;
    loadingPromise = null;
    const quiz = document.getElementById('sat-quiz-area');
    if (quiz && quiz.style.display !== 'none') await nextQuestion();
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

    // The question and choices are shown as crops of the source PDF (see
    // SAT-Questions/extract_english.py), which keep tables, charts and
    // underlining. The text is the alt text, and the fallback when a question
    // has no crop.
    const questionEl = document.getElementById('Question');
    questionEl.innerHTML = '';
    if (question.image) {
        const img = document.createElement('img');
        img.className = 'question-crop';
        img.src = '../SAT-Questions/' + question.image;
        img.alt = question.Question;
        if (question.imageSize) {
            img.width = question.imageSize[0];
            img.height = question.imageSize[1];
            img.style.width = englishImageWidth(question.imageSize[0]);
        }
        questionEl.appendChild(img);
    } else {
        questionEl.textContent = question.Question;
    }

    ['A', 'B', 'C', 'D'].forEach(letter => {
        const btn = document.getElementById(letter + ' Button');
        btn.innerHTML = '';
        if (question.choiceSprite) {
            btn.appendChild(choiceSlice(question.choiceSprite, letter, englishImageWidth, question[letter]));
        } else {
            btn.textContent = question[letter];
        }
    });
    updateCropScale(question);
}

// Crops are rendered at 150 DPI; 0.8 CSS px per crop px shows the PDF's 9pt
// body text at about 15px. When the question's widest crop doesn't fit its
// column at that scale, every crop of the question (passage and choices alike)
// shrinks by the same factor so text sizes stay consistent. The scale lives in
// --crop-scale.
const ENGLISH_CROP_SCALE = 0.8;

function englishImageWidth(w) {
    return 'calc(' + w + 'px * var(--crop-scale, ' + ENGLISH_CROP_SCALE + '))';
}

function contentWidth(el) {
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

function updateCropScale(question = json[roll]) {
    if (!question || !question.image || !question.choiceSprite) return;
    const qWidth = contentWidth(document.getElementById('Question'));
    const cWidth = contentWidth(document.getElementById('A Button'));
    if (qWidth <= 0 || cWidth <= 0) return; // hidden; keep the last scale
    const widestChoice = Math.max(...['A', 'B', 'C', 'D'].map(L => question.choiceSprite[L][1]));
    const scale = Math.min(ENGLISH_CROP_SCALE, qWidth / question.imageSize[0], cWidth / widestChoice);
    document.documentElement.style.setProperty('--crop-scale', scale.toFixed(4));
}
window.addEventListener('resize', () => updateCropScale());

function renderRationale(el, text) {
    el.innerHTML = '';
    (text || '').split(/\n\n+/).forEach(para => {
        const p = document.createElement('p');
        p.textContent = para;
        el.appendChild(p);
    });
}

async function submit() {
    document.getElementById('A').disabled = true;
    document.getElementById('B').disabled = true;
    document.getElementById('C').disabled = true;
    document.getElementById('D').disabled = true;
    document.getElementById('submit').disabled = true;

    const question = json[roll];
    const correct = selectedAnswer === question.Answer;

    const result = await writeScore(
        correct ? 1 : 0,
        currentDomainIdx,
        question.Skill || '',
        question.Difficulty || currentDifficulty,
        assessmentType
    );
    // Answered too fast to have been read: the server discarded it, so
    // don't reveal the answer; SatPace locks the next question instead.
    if (result && result.flagged) { SatPace.showTooFast(result.min_ms); return; }

    if (!correct) {
        document.getElementById(selectedAnswer).closest('.answer-option').style.background = '#fecaca';
        document.getElementById(question.Answer).closest('.answer-option').style.background = '#dcfce7';
    }

    renderRationale(document.getElementById('Rationale'), question.Rationale);
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
    SatPace.onQuestionShown();
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

    const pop = document.createElement('div');
    pop.className = 'result-pop result-pop--' + (correct ? 'correct' : 'incorrect');
    pop.textContent = correct ? '✓' : '✗';
    document.body.appendChild(pop);
    setTimeout(function () { pop.remove(); }, 1000);
}

function closeRationaleOverlay() {
    const el = document.getElementById('rationale-overlay');
    if (el) el.style.display = 'none';
}
