// Tests for the Shop Ready → Phase 2 rule (L.phase2Status / L.recomputePhase):
// template prereqs, the safety sign-off flag, credential prereqs, never-demote
// and the instructor override, against a scratch database.
// Run: node tools/test-wbl-phase2.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-phase2-')), 'test.db');
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
const ONBOARDING = TEMPLATES.filter(t => t.onboarding).map(t => t.code);

const now = Date.now();
const pid = Number(db.prepare(`INSERT INTO wbl_programs(teacher_key, name, created_at) VALUES('t', 'CGL', ?)`).run(now).lastInsertRowid);
importCatalogRows(pid, [
    { credential: 'Adobe Illustrator', skill: 'Pen Tool', description: '', criterion: 'Closed paths' },
], { requiredDemonstrations: 1 });
T.seedTemplates(pid, TEMPLATES.filter(t => t.onboarding).map(t => ({ ...t, skills: [] })));
const classId = Number(db.prepare(`INSERT INTO classes(teacher_key, name, created_at) VALUES('t', 'P4', ?)`).run(now).lastInsertRowid);
const STUDENTS = ['2001', '2002', '2003', '2004'];
for (const sid of STUDENTS) {
    db.prepare('INSERT INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)').run(classId, sid, 'S' + sid);
    db.prepare(`INSERT INTO wbl_program_enrollments(program_id, student_id, enrolled_on, updated_at) VALUES(?, ?, '2026-08-20', ?)`)
        .run(pid, sid, now);
}

const tplId = code => db.prepare('SELECT id FROM wbl_work_event_templates WHERE program_id = ? AND code = ?').get(pid, code).id;
const credId = db.prepare('SELECT id FROM wbl_credentials WHERE program_id = ?').get(pid).id;
const setTemplatePrereqs = codes => {
    db.prepare('DELETE FROM wbl_phase2_prereq_templates WHERE program_id = ?').run(pid);
    for (const c of codes) db.prepare('INSERT INTO wbl_phase2_prereq_templates(program_id, template_id) VALUES(?, ?)').run(pid, tplId(c));
};
const requireSafety = on => db.prepare('UPDATE wbl_programs SET phase2_requires_safety = ? WHERE id = ?').run(on ? 1 : 0, pid);
const signSafety = (sid, on) => db.prepare('UPDATE wbl_program_enrollments SET safety_signed_off_on = ? WHERE program_id = ? AND student_id = ?')
    .run(on, pid, sid);
// Starts the template for one student and records the call — what the sign-off route writes.
function finish(sid, code, tier) {
    const r = T.createFromTemplate(pid, tplId(code), { students: [{ class_id: classId, student_id: sid }] });
    const wp = db.prepare('SELECT id FROM wbl_work_event_participants WHERE work_event_id = ? AND student_id = ?').get(r.id, sid);
    db.prepare(`INSERT INTO wbl_holistic_calls(participant_id, work_event_id, program_id, class_id, student_id,
                tier, called_by, called_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 't', ?, ?)`)
        .run(wp.id, r.id, pid, classId, sid, tier, now, now);
}
const phase = sid => L.recomputePhase(pid, sid);

test('the onboarding set in the curriculum file is the Shop Ready six', () => {
    assert.deepStrictEqual([...ONBOARDING].sort(), ['IL-00', 'IL-01', 'IL-02', 'IL-03', 'IL-04', 'IL-15']);
});

test('no prereqs configured: nobody advances', () => {
    for (const code of ONBOARDING) finish('2001', code, 'meets');
    signSafety('2001', '2026-09-01');
    const s = L.phase2Status(pid, '2001');
    assert.strictEqual(s.configured, false);
    assert.strictEqual(s.ready, false);
    assert.strictEqual(phase('2001'), 1);
});

test('all six onboarding templates at Meets+ plus safety: Phase 2', () => {
    setTemplatePrereqs(ONBOARDING);
    requireSafety(true);
    const s = L.phase2Status(pid, '2001');
    assert.strictEqual(s.templates.length, 6);
    assert.ok(s.templates.every(t => t.met));
    assert.strictEqual(s.ready, true);
    assert.strictEqual(phase('2001'), 2);
    assert.ok(db.prepare('SELECT transitioned_at FROM wbl_student_phase WHERE program_id = ? AND student_id = ?').get(pid, '2001').transitioned_at);
});

test('a missing template, or only a Rework / Not shippable call, keeps Phase 1', () => {
    for (const code of ONBOARDING.slice(0, 5)) finish('2002', code, 'exceeds');
    finish('2002', ONBOARDING[5], 'rework');
    signSafety('2002', '2026-09-01');
    let s = L.phase2Status(pid, '2002');
    assert.deepStrictEqual(s.templates.filter(t => !t.met).map(t => t.code), [ONBOARDING[5]]);
    assert.strictEqual(phase('2002'), 1);
    finish('2002', ONBOARDING[5], 'not_shippable');
    assert.strictEqual(phase('2002'), 1);
    finish('2002', ONBOARDING[5], 'meets');           // a repeat at Meets clears it
    assert.strictEqual(phase('2002'), 2);
});

test('templates done but no safety sign-off: Phase 1 until it is recorded', () => {
    for (const code of ONBOARDING) finish('2003', code, 'meets');
    assert.strictEqual(L.phase2Status(pid, '2003').safety.signed_off_on, null);
    assert.strictEqual(phase('2003'), 1);
    signSafety('2003', '2026-09-10');
    assert.strictEqual(phase('2003'), 2);
});

test('a credential prereq is ANDed with the templates', () => {
    db.prepare('INSERT INTO wbl_phase2_prereqs(program_id, credential_id) VALUES(?, ?)').run(pid, credId);
    for (const code of ONBOARDING) finish('2004', code, 'meets');
    signSafety('2004', '2026-09-10');
    const s = L.phase2Status(pid, '2004');
    assert.deepStrictEqual(s.credentials.map(c => c.met), [false]);
    assert.strictEqual(phase('2004'), 1);
    db.prepare(`INSERT INTO wbl_credential_awards(credential_id, program_id, student_id, awarded_at, source)
                VALUES(?, ?, '2004', ?, 'manual')`).run(credId, pid, now);
    assert.strictEqual(phase('2004'), 2);
    db.prepare('DELETE FROM wbl_phase2_prereqs WHERE program_id = ?').run(pid);
});

test('never demotes: clearing the safety flag leaves a Phase 2 student in Phase 2', () => {
    signSafety('2003', null);
    assert.strictEqual(L.phase2Status(pid, '2003').ready, false);
    assert.strictEqual(phase('2003'), 2);
});

test('an override pins the phase either way, and clearing it restores the computed phase', () => {
    const pin = (sid, p) => db.prepare('UPDATE wbl_student_phase SET override_phase = ? WHERE program_id = ? AND student_id = ?')
        .run(p, pid, sid);
    pin('2001', 1);
    assert.strictEqual(phase('2001'), 1);
    pin('2001', null);
    assert.strictEqual(phase('2001'), 2);
    L.ensurePhaseRow(pid, '9999');
    pin('9999', 2);
    assert.strictEqual(L.effectivePhase(pid, '9999'), 2);
});

test('a new participant is stamped with the phase they are in now', () => {
    const r = T.createFromTemplate(pid, tplId('IL-02'), {
        students: [{ class_id: classId, student_id: '2001' }, { class_id: classId, student_id: '2004' }],
    });
    const stamped = db.prepare('SELECT student_id, phase_at_start FROM wbl_work_event_participants WHERE work_event_id = ? ORDER BY student_id')
        .all(r.id).map(x => [x.student_id, x.phase_at_start]);
    assert.deepStrictEqual(stamped, [['2001', 2], ['2004', 2]]);
});

db.close();
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
