// Tests for machines and gate clearances (server/wbl/gates.js): seeding,
// clear / revoke / re-clear with the safety history, and the warn + override
// rule for machines on a job, against a scratch database.
// Run: node tools/test-wbl-gates.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-gates-')), 'test.db');
process.env.DB_PATH = tmpDb;
const { db } = require('../server/db');
const L = require('../server/wbl/logic');
const G = require('../server/wbl/gates');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.refs', 'cgl', 'cgl-work-event-templates.json'), 'utf8'));
const now = Date.now();
const pid = Number(db.prepare(`INSERT INTO wbl_programs(teacher_key, name, created_at) VALUES('t', 'CGL', ?)`).run(now).lastInsertRowid);
const classId = Number(db.prepare(`INSERT INTO classes(teacher_key, name, created_at) VALUES('t', 'P4', ?)`).run(now).lastInsertRowid);
for (const sid of ['3001', '3002']) {
    db.prepare('INSERT INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)').run(classId, sid, 'S' + sid);
}
const event = (kind) => Number(db.prepare(`INSERT INTO wbl_work_events(program_id, title, kind, opened_on, created_at, updated_at)
    VALUES(?, ?, ?, '2026-10-28', ?, ?)`).run(pid, kind + ' event', kind, now, now).lastInsertRowid);
const participant = (weId, sid) => {
    L.addParticipants(pid, weId, classId, [sid]);
    return { ...db.prepare('SELECT * FROM wbl_work_event_participants WHERE work_event_id = ? AND student_id = ?').get(weId, sid), program_id: pid };
};
const rows = (pId) => db.prepare('SELECT machine_code, cleared, override_note FROM wbl_participant_machines WHERE participant_id = ? ORDER BY machine_code').all(pId)
    .map(r => ({ ...r }));

test('seeding the 10 machines, 7 of them gated; a re-seed keeps status and note', () => {
    const r = G.seedMachines(pid, FILE.machines);
    assert.strictEqual(r.created.length, 10);
    assert.strictEqual(G.listMachines(pid).filter(m => m.gate_template_code).length, 7);
    assert.strictEqual(G.listMachines(pid).find(m => m.code === 'ricoma-mt1501').gate_template_code, 'EMB-P2');
    db.prepare(`UPDATE wbl_machines SET status = 'down', note = 'needle broken' WHERE program_id = ? AND code = 'ricoma-mt1501'`).run(pid);
    const again = G.seedMachines(pid, FILE.machines);
    assert.strictEqual(again.unchanged.length, 10);
    const m = G.listMachines(pid).find(x => x.code === 'ricoma-mt1501');
    assert.deepStrictEqual([m.status, m.note], ['down', 'needle broken']);
});

test('clear, double clear, revoke (reason required), re-clear: one row, full history', () => {
    const first = G.clearGate(pid, '3001', 'screen-press', { by: 't', note: 'SS-P5 clean' });
    assert.strictEqual(first.already, false);
    const dup = G.clearGate(pid, '3001', 'screen-press', { by: 'other' });
    assert.strictEqual(dup.already, true);
    assert.strictEqual(dup.clearance.cleared_by, 't');
    assert.ok(G.isCleared(pid, '3001', 'screen-press'));
    assert.throws(() => G.revokeGate(pid, '3001', 'screen-press', { by: 't', note: '' }), /note_required/);
    assert.strictEqual(G.revokeGate(pid, '3001', 'screen-press', { by: 't', note: 'unsafe squeegee handling' }), true);
    assert.strictEqual(G.isCleared(pid, '3001', 'screen-press'), false);
    assert.strictEqual(G.revokeGate(pid, '3001', 'screen-press', { by: 't', note: 'again' }), false);
    const row = db.prepare('SELECT * FROM wbl_gate_clearances WHERE program_id = ? AND student_id = ?').get(pid, '3001');
    assert.strictEqual(row.revoke_note, 'unsafe squeegee handling');
    G.clearGate(pid, '3001', 'screen-press', { by: 't', note: 'retrained' });
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM wbl_gate_clearances WHERE program_id = ?').get(pid).n, 1);
    assert.deepStrictEqual(G.history(pid, '3001').map(h => h.action), ['cleared', 'revoked', 'cleared']);
    assert.throws(() => G.clearGate(pid, '3001', 'no-such-machine', { by: 't' }), /unknown_machine/);
});

test('the read API view: live clearances only', () => {
    G.clearGate(pid, '3002', 'heat-press', { by: 't' });
    G.revokeGate(pid, '3002', 'heat-press', { by: 't', note: 'x' });
    assert.deepStrictEqual(G.clearances(pid, '3001').map(g => g.machine_code), ['screen-press']);
    assert.deepStrictEqual(G.clearances(pid, '3002'), []);
    assert.deepStrictEqual(G.unclearedFor(pid, ['3001', '3002'], ['screen-press']), [{ student_id: '3002', machines: ['screen-press'] }]);
});

test('job: an uncleared machine needs an override note; cleared ones do not', () => {
    const p = participant(event('job'), '3002');
    const r = G.setParticipantMachines(p, ['screen-press', 'ryocure-dryer'], { kind: 'job', by: 't' });
    assert.deepStrictEqual(r.needs_override, ['screen-press', 'ryocure-dryer']);
    assert.deepStrictEqual(rows(p.id), [], 'nothing written without the note');
    G.setParticipantMachines(p, ['screen-press', 'ryocure-dryer'], { kind: 'job', overrideNote: 'supervised first run', by: 't' });
    assert.deepStrictEqual(rows(p.id).map(r => [r.machine_code, r.cleared, r.override_note]),
        [['ryocure-dryer', 0, 'supervised first run'], ['screen-press', 0, 'supervised first run']]);
    // Re-saving with one more cleared machine keeps the earlier override and asks for nothing.
    G.clearGate(pid, '3002', 'heat-press', { by: 't' });
    const again = G.setParticipantMachines(p, ['screen-press', 'ryocure-dryer', 'heat-press'], { kind: 'job', by: 't' });
    assert.ok(again.ok);
    assert.deepStrictEqual(rows(p.id).find(r => r.machine_code === 'heat-press'), { machine_code: 'heat-press', cleared: 1, override_note: '' });
    assert.strictEqual(rows(p.id).find(r => r.machine_code === 'screen-press').override_note, 'supervised first run');
    G.setParticipantMachines(p, ['heat-press'], { kind: 'job', by: 't' });
    assert.deepStrictEqual(rows(p.id).map(r => r.machine_code), ['heat-press']);
});

test('practical: no warning — the student is being taught the machine', () => {
    const p = participant(event('practical'), '3002');
    const r = G.setParticipantMachines(p, ['ricoma-mt1501'], { kind: 'practical', by: 't' });
    assert.ok(r.ok);
    assert.deepStrictEqual(r.overridden, []);
});

db.close();
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
