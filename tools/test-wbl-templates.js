// Tests for Work Event kinds and templates (server/wbl/templates.js) and the
// credential rule over template-started Work Events, against a scratch database.
// Run: node tools/test-wbl-templates.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-templates-')), 'test.db');
process.env.DB_PATH = tmpDb;
const { db } = require('../server/db');
const L = require('../server/wbl/logic');
const T = require('../server/wbl/templates');
const { importCatalogRows } = require('../server/wbl/catalogImport');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const CGL = path.join(__dirname, '..', '.refs', 'cgl');
const TEMPLATES = JSON.parse(fs.readFileSync(path.join(CGL, 'cgl-work-event-templates.json'), 'utf8')).templates;
const catalogRows = fs.readFileSync(path.join(CGL, 'graphics-printing-catalog-v2.csv'), 'utf8').trim().split(/\r?\n/)
    .slice(1).map(line => {
        const cols = [];
        let field = '', inQ = false;
        for (const ch of line) {
            if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) { cols.push(field); field = ''; }
            else field += ch;
        }
        cols.push(field);
        const [credential, skill, description, criterion] = cols;
        return { credential, skill, description, criterion };
    });

// One program with the v2 catalog at 2 demonstrations, a class of three.
const now = Date.now();
const pid = Number(db.prepare(`INSERT INTO wbl_programs(teacher_key, name, created_at) VALUES('t', 'CGL', ?)`).run(now).lastInsertRowid);
importCatalogRows(pid, catalogRows, { requiredDemonstrations: 2 });
const classId = Number(db.prepare(`INSERT INTO classes(teacher_key, name, created_at) VALUES('t', 'P4', ?)`).run(now).lastInsertRowid);
for (const [id, name] of [['1001', 'Ada'], ['1002', 'Ben'], ['1003', 'Cy']]) {
    db.prepare('INSERT INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)').run(classId, id, name);
}

const tpl = code => db.prepare('SELECT * FROM wbl_work_event_templates WHERE program_id = ? AND code = ?').get(pid, code);
const skillName = id => db.prepare('SELECT name FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1').get(id).name;
const credId = name => db.prepare('SELECT id FROM wbl_credentials WHERE program_id = ? AND name = ?').get(pid, name).id;

// What PUT /participants/:id/skills and /holistic write.
function assess(participantId, skillId, result, tier) {
    const wp = db.prepare(`SELECT wp.*, we.program_id FROM wbl_work_event_participants wp
                           JOIN wbl_work_events we ON we.id = wp.work_event_id WHERE wp.id = ?`).get(participantId);
    const v = db.prepare('SELECT id FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1').get(skillId);
    db.prepare(`INSERT INTO wbl_skill_assessments(participant_id, work_event_id, program_id, class_id, student_id,
                skill_id, skill_version_id, result, assessed_by, assessed_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, 't', ?, ?)`)
        .run(wp.id, wp.work_event_id, wp.program_id, wp.class_id, wp.student_id, skillId, v.id, result, now, now);
    if (tier) {
        db.prepare(`INSERT INTO wbl_holistic_calls(participant_id, work_event_id, program_id, class_id, student_id,
                    tier, called_by, called_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 't', ?, ?)`)
            .run(wp.id, wp.work_event_id, wp.program_id, wp.class_id, wp.student_id, tier, now, now);
    }
}
const participantOf = (weId, sid) =>
    db.prepare('SELECT id FROM wbl_work_event_participants WHERE work_event_id = ? AND student_id = ?').get(weId, sid).id;
const progressFor = (sid, cred, skillId) =>
    L.credentialProgress(credId(cred), pid, sid).skills.find(s => s.skill_id === skillId);

test('evidence letters derive from kind', () => {
    assert.deepStrictEqual(
        L.WORK_EVENT_KINDS.map(L.evidenceLetter), ['J', 'P', 'D', 'B']);
    assert.strictEqual(L.evidenceLetter(undefined), 'J');
});

test('seeding: all 54 templates, every planned skill resolves', () => {
    const r = T.seedTemplates(pid, TEMPLATES);
    assert.strictEqual(r.created.length, 54);
    assert.deepStrictEqual(r.unresolved, []);
    const kinds = db.prepare('SELECT kind, COUNT(*) n FROM wbl_work_event_templates WHERE program_id = ? GROUP BY kind').all(pid);
    assert.deepStrictEqual(Object.fromEntries(kinds.map(k => [k.kind, k.n])), { module: 12, practical: 25, project: 17 });
    assert.strictEqual(tpl('SS-P3').gate_machine_code, 'x-vactor-exposure');
    assert.strictEqual(tpl('IL-01').onboarding, 1);
});

test('same-named skills resolve through their own credential', () => {
    const planned = code => db.prepare('SELECT skill_id FROM wbl_work_event_template_skills WHERE template_id = ?')
        .all(tpl(code).id).map(r => r.skill_id);
    const [dtf] = planned('DTF-P1'), [emb] = planned('EMB-P2');
    assert.notStrictEqual(dtf, emb);
    assert.ok(db.prepare('SELECT 1 FROM wbl_credential_skills WHERE credential_id = ? AND skill_id = ?').get(credId('Direct to Film'), dtf));
    assert.ok(db.prepare('SELECT 1 FROM wbl_credential_skills WHERE credential_id = ? AND skill_id = ?').get(credId('Embroidery'), emb));
});

test('re-seeding changes nothing and keeps a pasted brief_url', () => {
    db.prepare(`UPDATE wbl_work_event_templates SET brief_url = 'https://drive.example/ss-p3' WHERE id = ?`).run(tpl('SS-P3').id);
    const r = T.seedTemplates(pid, TEMPLATES);
    assert.strictEqual(r.created.length + r.updated.length, 0);
    assert.strictEqual(r.unchanged.length, 54);
    assert.strictEqual(tpl('SS-P3').brief_url, 'https://drive.example/ss-p3');
});

let firstRun;
test('starting SS-P3: a practical, led by Expose and Wash Out Frames, with participants', () => {
    firstRun = T.createFromTemplate(pid, tpl('SS-P3').id, {
        students: [{ class_id: classId, student_id: '1001' }, { class_id: classId, student_id: '1002' }],
    });
    assert.strictEqual(firstRun.added, 2);
    const we = db.prepare('SELECT * FROM wbl_work_events WHERE id = ?').get(firstRun.id);
    assert.strictEqual(we.kind, 'practical');
    assert.strictEqual(L.evidenceLetter(we.kind), 'P');
    assert.strictEqual(we.template_code, 'SS-P3');
    assert.strictEqual(we.title, 'SS-P3 · Expose & wash out');
    const planned = db.prepare('SELECT skill_id FROM wbl_work_event_skills WHERE work_event_id = ?').all(we.id);
    assert.deepStrictEqual(planned.map(r => skillName(r.skill_id)), ['Expose and Wash Out Frames']);
    const parts = db.prepare('SELECT phase_at_start FROM wbl_work_event_participants WHERE work_event_id = ?').all(we.id);
    assert.deepStrictEqual(parts.map(p => p.phase_at_start), [1, 1]);
});

test('mastered + Meets spec on the practical counts as one of two demonstrations', () => {
    const skillId = db.prepare('SELECT skill_id FROM wbl_work_event_skills WHERE work_event_id = ?').get(firstRun.id).skill_id;
    assess(participantOf(firstRun.id, '1001'), skillId, 'mastered', 'meets');
    assess(participantOf(firstRun.id, '1002'), skillId, 'mastered', null);   // no Holistic Call
    const ada = progressFor('1001', 'Silk Screening', skillId);
    assert.strictEqual(ada.demos, 1);
    assert.strictEqual(ada.required, 2);
    assert.strictEqual(ada.satisfied, false);
    assert.strictEqual(progressFor('1002', 'Silk Screening', skillId).demos, 0, 'counted without a Holistic Call');
});

test('a repeat of the same template is a second, distinct demonstration', () => {
    const again = T.createFromTemplate(pid, tpl('SS-P3').id, { students: [{ class_id: classId, student_id: '1001' }] });
    const skillId = db.prepare('SELECT skill_id FROM wbl_work_event_skills WHERE work_event_id = ?').get(again.id).skill_id;
    assess(participantOf(again.id, '1001'), skillId, 'mastered', 'exceeds');
    const ada = progressFor('1001', 'Silk Screening', skillId);
    assert.strictEqual(ada.demos, 2);
    assert.strictEqual(ada.satisfied, true);
});

test('a title override, and an unknown template, are handled', () => {
    const r = T.createFromTemplate(pid, tpl('LOG-M1').id, { title: 'Intake for the band order', students: [] });
    const we = db.prepare('SELECT title, kind FROM wbl_work_events WHERE id = ?').get(r.id);
    assert.deepStrictEqual({ ...we }, { title: 'Intake for the band order', kind: 'module' });
    assert.throws(() => T.createFromTemplate(pid, 999999, {}), /template_not_found/);
});

db.close();
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
