// Tests for shop roles and rotation (server/wbl/roles.js): seeding the CGL
// vocabulary with its skills, role validation (codes vs free text), the
// skills a role leads with, and the rotation counts and suggestion, against a
// scratch database.
// Run: node tools/test-wbl-roles.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-roles-')), 'test.db');
process.env.DB_PATH = tmpDb;
const { db } = require('../server/db');
const L = require('../server/wbl/logic');
const R = require('../server/wbl/roles');
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
const pid = newProgram('CGL');
const otherPid = newProgram('Woodshop');
importCatalogRows(pid, catalogRows, { requiredDemonstrations: 2 });
const classId = Number(db.prepare(`INSERT INTO classes(teacher_key, name, created_at) VALUES('t', 'P4', ?)`).run(now).lastInsertRowid);
for (const [sid, name, exited] of [['4001', 'Ada', null], ['4002', 'Ben', null], ['4003', 'Cy', '2026-10-01']]) {
    db.prepare('INSERT INTO class_students(class_id, student_id, student_name) VALUES(?, ?, ?)').run(classId, sid, name);
    db.prepare(`INSERT INTO wbl_program_enrollments(program_id, student_id, enrolled_on, exited_on, updated_at)
                VALUES(?, ?, '2026-09-01', ?, ?)`).run(pid, sid, exited, now);
}
const event = kind => Number(db.prepare(`INSERT INTO wbl_work_events(program_id, title, kind, opened_on, created_at, updated_at)
    VALUES(?, ?, ?, '2026-10-28', ?, ?)`).run(pid, kind + ' event', kind, now, now).lastInsertRowid);
const skillName = id => db.prepare('SELECT name FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1').get(id).name;

test('seeding the 6 CGL roles; every role skill resolves; production is not rotated', () => {
    const r = R.seedRoles(pid, FILE.roles);
    assert.strictEqual(r.created.length, 6);
    assert.deepStrictEqual(r.unresolved, []);
    const roles = R.listRoles(pid);
    assert.deepStrictEqual(roles.map(x => x.code),
        ['job_lead', 'buyer_receiver', 'qc_inspector', 'shipper', 'photographer', 'production']);
    assert.deepStrictEqual(roles.filter(x => !x.rotates).map(x => x.code), ['production']);
    const photo = roles.find(x => x.code === 'photographer').skills[0];
    assert.deepStrictEqual([photo.name, photo.credential_name], ['Product Photography', 'Marketing & Advertisement']);
    assert.strictEqual(R.seedRoles(pid, FILE.roles).unchanged.length, 6);
});

test('role validation: codes in vocabulary order, unknown codes refused, free text elsewhere', () => {
    assert.deepStrictEqual(R.normalizeRole(pid, 'shipper, job_lead'), { role: 'job_lead,shipper' });
    assert.deepStrictEqual(R.normalizeRole(pid, ['qc_inspector']), { role: 'qc_inspector' });
    assert.deepStrictEqual(R.normalizeRole(pid, ''), { role: '' });
    assert.match(R.normalizeRole(pid, 'Lead').error, /unknown role: Lead/);
    assert.deepStrictEqual(R.normalizeRole(otherPid, ' Lead sawyer '), { role: 'Lead sawyer' });
});

test('a doubled-up role leads with both roles\' skills, in role order', () => {
    const ids = R.roleSkillIds(pid, 'job_lead,photographer');
    assert.deepStrictEqual(ids.map(skillName), ['Client Communication', 'Project Management', 'Product Photography']);
    assert.deepStrictEqual(R.roleSkillIds(pid, 'production'), []);
    assert.deepStrictEqual(R.roleSkillIds(otherPid, 'Lead sawyer'), []);
});

test('rotation counts jobs only, skips exited students, and suggests the role held least', () => {
    const j1 = event('job'), j2 = event('job'), pr = event('practical');
    L.addParticipants(pid, j1, classId, ['4001'], 'job_lead,production');
    L.addParticipants(pid, j1, classId, ['4002'], 'qc_inspector');
    L.addParticipants(pid, j2, classId, ['4001'], 'buyer_receiver');
    L.addParticipants(pid, pr, classId, ['4002'], 'shipper');   // a practical: not a job, not counted
    L.addParticipants(pid, j2, classId, ['4003'], 'shipper');   // exited student
    const rot = R.rotation(pid);
    assert.deepStrictEqual(rot.students.map(s => s.student_id), ['4001', '4002']);
    const [ada, ben] = rot.students;
    assert.deepStrictEqual(ada.counts, { job_lead: 1, buyer_receiver: 1, qc_inspector: 0, shipper: 0, photographer: 0, production: 1 });
    assert.deepStrictEqual(ada.missing, ['qc_inspector', 'shipper', 'photographer']);
    assert.strictEqual(ada.suggested, 'qc_inspector');
    assert.strictEqual(ben.counts.shipper, 0);
    assert.strictEqual(ben.suggested, 'job_lead');
});

test('a re-seed that cannot resolve a role skill keeps the role\'s skills', () => {
    const before = R.listRoles(pid).find(r => r.code === 'qc_inspector').skills.map(s => s.skill_id);
    const file = FILE.roles.map(r => r.code === 'qc_inspector'
        ? { ...r, planned_skills: [{ credential: 'Logistics & Operations', skill: 'No Such Skill' }] } : r);
    const r = R.seedRoles(pid, file);
    assert.deepStrictEqual(r.kept, ['qc_inspector']);
    assert.deepStrictEqual(R.listRoles(pid).find(x => x.code === 'qc_inspector').skills.map(s => s.skill_id), before);
});

db.close();
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
