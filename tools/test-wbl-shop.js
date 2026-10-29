// Tests for the CGL §7 open-shop pieces: job packet import
// (server/wbl/packets.js), the Today screen's lanes, the pacing floor and
// credential coverage (server/wbl/shop.js), against a scratch database.
// Run: node tools/test-wbl-shop.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-shop-')), 'test.db');
process.env.DB_PATH = tmpDb;
const { db } = require('../server/db');
const L = require('../server/wbl/logic');
const T = require('../server/wbl/templates');
const G = require('../server/wbl/gates');
const R = require('../server/wbl/roles');
const P = require('../server/wbl/packets');
const S = require('../server/wbl/shop');
const { importCatalogRows } = require('../server/wbl/catalogImport');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const CGL = path.join(__dirname, '..', '.refs', 'cgl');
const FILE = JSON.parse(fs.readFileSync(path.join(CGL, 'cgl-work-event-templates.json'), 'utf8'));
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

const now = Date.now();
const newProgram = name => Number(db.prepare(`INSERT INTO wbl_programs(teacher_key, name, created_at) VALUES('t', ?, ?)`).run(name, now).lastInsertRowid);
const classId = Number(db.prepare(`INSERT INTO classes(teacher_key, name, created_at) VALUES('t', 'P4', ?)`).run(now).lastInsertRowid);
function enroll(pid, sid, name) {
    db.prepare('INSERT OR IGNORE INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)').run(classId, sid, name);
    db.prepare(`INSERT INTO wbl_program_enrollments(program_id, student_id, enrolled_on, updated_at) VALUES(?, ?, '2026-09-01', ?)`).run(pid, sid, now);
}
const pinPhase = (pid, sid, phase) => {
    L.ensurePhaseRow(pid, sid);
    db.prepare(`UPDATE wbl_student_phase SET override_phase = ?, override_note = 'test' WHERE program_id = ? AND student_id = ?`).run(phase, pid, sid);
};
// What a sign-off writes: a result per skill plus the Holistic Call.
function signOff(pid, weId, sid, skillIds, tier) {
    const wp = db.prepare('SELECT * FROM wbl_work_event_participants WHERE work_event_id = ? AND student_id = ?').get(weId, sid);
    for (const skillId of skillIds) {
        const v = db.prepare('SELECT id FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1').get(skillId);
        db.prepare(`INSERT INTO wbl_skill_assessments(participant_id, work_event_id, program_id, class_id, student_id,
                    skill_id, skill_version_id, result, assessed_by, assessed_at, updated_at)
                    VALUES(?, ?, ?, ?, ?, ?, ?, 'mastered', 't', ?, ?)`)
            .run(wp.id, weId, pid, wp.class_id, sid, skillId, v.id, now, now);
    }
    db.prepare(`INSERT INTO wbl_holistic_calls(participant_id, work_event_id, program_id, class_id, student_id,
                tier, called_by, called_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 't', ?, ?)`)
        .run(wp.id, weId, pid, wp.class_id, sid, tier, now, now);
}
const complete = weId => db.prepare(`UPDATE wbl_work_events SET status = 'complete' WHERE id = ?`).run(weId);

// The CGL program: v2 catalog, the file's templates, machines and roles.
const cgl = newProgram('CGL');
importCatalogRows(cgl, catalogRows, { requiredDemonstrations: 2 });
T.seedTemplates(cgl, FILE.templates);
G.seedMachines(cgl, FILE.machines);
R.seedRoles(cgl, FILE.roles);
enroll(cgl, '5001', 'Ada');

const PACKET = {
    job_number: 'CGL-26-014', is_house: false,
    order: { customer: 'Acme Band', contact: 'Jo', due_date: '2026-11-14', quantities: [{ size: 'M', qty: 12 }, { size: 'L', qty: 8 }] },
    product: { type: 'garment', brand_style: 'Gildan 5000', color: 'Navy', supplied_by: 'ordered' },
    process: { method: 'screen', colors: 2, ink_or_thread: ['PMS 286 C'] },
    placement: [{ location: 'full front', size: '11 in wide', from: '3 in below collar' }],
    files: { drive_folder_url: 'https://drive.example/acme' },
    assessment: {
        roles_needed: ['job_lead', 'production'], machines: ['screen-press', 'x-vactor-exposure'],
        suggested_skills: [{ credential: 'Silk Screening', skill: 'Expose and Wash Out Frames' }],
    },
};

let jobId;
test('packet: refused for a missing job_number, a bad due date or a non-web link', () => {
    assert.throws(() => P.importPacket(cgl, { ...PACKET, job_number: '' }), /job_number required/);
    assert.throws(() => P.importPacket(cgl, { ...PACKET, order: { due_date: '11/14/2026' } }), /due_date/);
    assert.throws(() => P.importPacket(cgl, { ...PACKET, files: { proof_url: 'javascript:alert(1)' } }), /proof_url/);
    assert.throws(() => P.importPacket(cgl, [1, 2]), /JSON object/);
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM wbl_work_events WHERE program_id = ?`).get(cgl).n, 0);
});

test('packet: creates the job with its title, ref, packet and planned skill', () => {
    const r = P.importPacket(cgl, PACKET);
    assert.strictEqual(r.created, true);
    assert.deepStrictEqual(r.warnings, []);
    assert.deepStrictEqual(r.unresolved, []);
    jobId = r.id;
    const we = db.prepare('SELECT * FROM wbl_work_events WHERE id = ?').get(jobId);
    assert.deepStrictEqual([we.kind, we.external_ref, we.title, we.status], ['job', 'CGL-26-014', 'Acme Band · 20 Navy Gildan 5000', 'active']);
    assert.strictEqual(P.parsePacket(we.packet_json).files.drive_folder_url, 'https://drive.example/acme');
    const planned = db.prepare('SELECT skill_id FROM wbl_work_event_skills WHERE work_event_id = ?').all(jobId);
    assert.strictEqual(planned.length, 1);
});

test('packet: unknown method, role, machine and skill import with warnings', () => {
    const r = P.importPacket(cgl, {
        job_number: 'CGL-26-015', is_house: true, process: { method: 'laser' },
        assessment: { roles_needed: ['astronaut'], machines: ['laser-1'], suggested_skills: [{ credential: 'Silk Screening', skill: 'Nope' }] },
    });
    assert.strictEqual(r.title, 'House job');
    assert.strictEqual(r.warnings.length, 3);
    assert.deepStrictEqual(r.unresolved, ['Silk Screening / Nope']);
});

test('packet: a re-import updates the same job, adds skills, keeps participants and status', () => {
    L.addParticipants(cgl, jobId, classId, ['5001'], 'job_lead');
    const extra = 'Single & Multi-Color Printing';
    assert.ok(T.resolveSkill(cgl, 'Silk Screening', extra));
    const r = P.importPacket(cgl, {
        ...PACKET, order: { ...PACKET.order, customer: 'Acme Band LLC' },
        assessment: { ...PACKET.assessment, suggested_skills: [{ credential: 'Silk Screening', skill: extra }] },
    });
    assert.deepStrictEqual([r.created, r.id], [false, jobId]);
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM wbl_work_events WHERE external_ref = 'CGL-26-014'`).get().n, 1);
    assert.strictEqual(db.prepare('SELECT title FROM wbl_work_events WHERE id = ?').get(jobId).title, 'Acme Band LLC · 20 Navy Gildan 5000');
    const planned = db.prepare('SELECT COUNT(*) n FROM wbl_work_event_skills WHERE work_event_id = ?').get(jobId).n;
    assert.strictEqual(planned, 2, 'the earlier planned skill was removed');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM wbl_work_event_participants WHERE work_event_id = ?').get(jobId).n, 1);
});

test('today, lane 1: the job, the role label, the due date and the packet link', () => {
    const t = S.today(cgl, '5001');
    assert.strictEqual(t.open_shop, true);
    assert.deepStrictEqual(
        [t.step.lane, t.step.type, t.step.role, t.step.due_date, t.step.packet_url],
        [1, 'job', 'Job Lead', '2026-11-14', 'https://drive.example/acme']);
    assert.strictEqual(t.credentials.length, 8);
    assert.strictEqual(t.stations.length, 10);
    complete(jobId);
    complete(db.prepare(`SELECT id FROM wbl_work_events WHERE external_ref = 'CGL-26-015'`).get().id);
});

test('today, Phase 1: onboarding templates first, in order, until each has a Meets call', () => {
    const onboarding = FILE.templates.filter(t => t.onboarding).map(t => t.code);
    let t = S.today(cgl, '5001');
    assert.deepStrictEqual([t.step.lane, t.step.code, t.step.onboarding], [3, onboarding[0], true]);
    const tpl = code => db.prepare('SELECT id FROM wbl_work_event_templates WHERE program_id = ? AND code = ?').get(cgl, code).id;
    const started = T.createFromTemplate(cgl, tpl(onboarding[0]), { students: [{ class_id: classId, student_id: '5001' }] });
    t = S.today(cgl, '5001');
    assert.deepStrictEqual([t.step.type, t.step.work_event_id], ['in_progress', started.id], 'a started template comes first');
    signOff(cgl, started.id, '5001', [], 'rework');
    complete(started.id);
    assert.strictEqual(S.today(cgl, '5001').step.code, onboarding[0], 'a Rework call does not finish onboarding');
});

// A small program to pin down the station lane: B is the gate practical for
// the press; A runs on the press too, so it needs the clearance B gives.
const mini = newProgram('Mini');
importCatalogRows(mini, catalogRows, { requiredDemonstrations: 2 });
const pick = (cred, n) => catalogRows.filter(r => r.credential === cred).map(r => r.skill).filter((s, i, a) => a.indexOf(s) === i)[n];
const sk = (cred, n) => ({ credential: cred, skill: pick(cred, n) });
T.seedTemplates(mini, [
    { code: 'A', title: 'Run the press', kind: 'practical', planned_skills: [sk('Silk Screening', 0)], uses_machines: ['press'] },
    { code: 'B', title: 'Press gate', kind: 'practical', planned_skills: [sk('Silk Screening', 1)], gate_for_machine: 'press', uses_machines: ['press'] },
    { code: 'P', title: 'Library project', kind: 'project', planned_skills: [sk('Adobe Illustrator', 0)] },
]);
G.seedMachines(mini, [{ code: 'press', label: 'Press', gate: 'B' }]);
enroll(mini, '6001', 'Bea');
pinPhase(mini, '6001', 2);
const setStatus = s => db.prepare(`UPDATE wbl_machines SET status = ? WHERE program_id = ? AND code = 'press'`).run(s, mini);

test('today, lane 2: a practical needing an uncleared gate is skipped; its own gate is not', () => {
    const t = S.today(mini, '6001');
    assert.deepStrictEqual([t.step.lane, t.step.code], [2, 'B']);
    assert.match(t.step.why, /Press is free/);
});

test('today, lane 3: with the machine down, the next library project', () => {
    setStatus('down');
    const t = S.today(mini, '6001');
    assert.deepStrictEqual([t.step.lane, t.step.code, t.step.kind], [3, 'P', 'project']);
    setStatus('available');
});

test('today: once cleared, the earlier practical comes first; satisfied ones drop out', () => {
    G.clearGate(mini, '6001', 'press', { by: 't' });
    assert.strictEqual(S.today(mini, '6001').step.code, 'A');
    const skillA = T.resolveSkill(mini, 'Silk Screening', pick('Silk Screening', 0));
    const tplA = db.prepare(`SELECT id FROM wbl_work_event_templates WHERE program_id = ? AND code = 'A'`).get(mini).id;
    for (let i = 0; i < 2; i++) {   // two Meets calls on distinct runs satisfy the skill
        const r = T.createFromTemplate(mini, tplA, { students: [{ class_id: classId, student_id: '6001' }] });
        signOff(mini, r.id, '6001', [skillA], 'meets');
        complete(r.id);
    }
    assert.strictEqual(S.today(mini, '6001').step.code, 'B');
});

test('pacing: week from the term start, milestones due by the end of their week', () => {
    assert.strictEqual(S.weekOf('2026-09-01', '2026-09-01'), 1);
    assert.strictEqual(S.weekOf('2026-09-01', '2026-09-07'), 1);
    assert.strictEqual(S.weekOf('2026-09-01', '2026-09-08'), 2);
    assert.strictEqual(S.weekOf('2026-09-01', '2026-08-30'), 0);
    db.prepare('UPDATE wbl_programs SET term_start = ?, pacing_floor_json = ? WHERE id = ?')
        .run('2026-09-01', JSON.stringify(FILE.pacing_floor), cgl);
    assert.strictEqual(S.pace(cgl, '5001', '2026-09-15').below, false, 'week 3: Shop Ready not due yet');
    const wk4 = S.pace(cgl, '5001', '2026-09-22');
    assert.deepStrictEqual([wk4.week, wk4.below, wk4.missing], [4, true, ['Shop Ready']]);
    pinPhase(cgl, '5001', 2);
    assert.strictEqual(S.pace(cgl, '5001', '2026-09-22').below, false);
});

test('pacing: week 8 needs Illustrator plus one equipment credential', () => {
    const award = name => db.prepare(`INSERT INTO wbl_credential_awards(credential_id, program_id, student_id, awarded_at)
        VALUES((SELECT id FROM wbl_credentials WHERE program_id = ? AND name = ?), ?, '5001', ?)`).run(cgl, name, cgl, now);
    const wk9 = '2026-10-27';
    award('Adobe Illustrator');
    award('Logistics & Operations');
    assert.deepStrictEqual(S.pace(cgl, '5001', wk9).missing, ['Adobe Illustrator + one equipment credential'], 'two credentials but no equipment');
    award('Embroidery');
    const p = S.pace(cgl, '5001', wk9);
    assert.deepStrictEqual([p.below, p.next.week, p.next.met], [false, 13, false]);
    assert.strictEqual(S.pace(mini, '6001'), null, 'no term start, no pace');
});

test('coverage: students per skill at 0, 1 and 2+ qualifying demonstrations', () => {
    enroll(mini, '6002', 'Cal');
    const cov = S.coverage(mini).find(c => c.name === 'Silk Screening');
    const skillA = T.resolveSkill(mini, 'Silk Screening', pick('Silk Screening', 0));
    const row = cov.skills.find(s => s.skill_id === skillA);
    assert.deepStrictEqual([row.zero, row.one, row.two_plus, row.required], [1, 0, 1, 2]);
    assert.strictEqual(cov.students, 2);
    assert.ok(cov.skills.every(s => s.zero + s.one + s.two_plus === 2));
});

db.close();
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
