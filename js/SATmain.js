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
    questionTypes = DOMAINS.map(d => all.filter(q => q.Domain === d));
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
    rationaleEl.style.visibility = 'hidden';
    rationaleEl.style.backgroundColor = '';
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

    const rationaleEl = document.getElementById('Rationale');
    rationaleEl.style.visibility = 'visible';
    rationaleEl.style.backgroundColor = correct ? '#dcfce7' : '#fef9c3';
    rationaleEl.innerHTML = question.Rationale;
    document.getElementById('nextquestion').disabled = false;
}

async function nextQuestion() {
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
