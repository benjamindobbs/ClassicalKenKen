// Tests for server/wbl/catalogImport.js against a scratch database.
// Run: node tools/test-wbl-catalog-import.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wbl-import-')), 'test.db');
process.env.DB_PATH = tmpDb;
const { db } = require('../server/db');
const { importCatalogRows } = require('../server/wbl/catalogImport');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; }
}

// Same quote handling as the teacher page's splitCsvRow.
function readCsv(file) {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).map(line => {
        const cols = [];
        let field = '', inQ = false;
        for (const ch of line) {
            if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) { cols.push(field); field = ''; }
            else field += ch;
        }
        cols.push(field);
        const [credential, skill, description, criterion] = cols.map(c => (c ?? '').trim());
        return { credential, skill, description, criterion };
    });
}

let programSeq = 0;
function newProgram() {
    const info = db.prepare(`INSERT INTO wbl_programs(teacher_key, name, created_at) VALUES('test', ?, ?)`)
        .run(`P${++programSeq}`, Date.now());
    return Number(info.lastInsertRowid);
}

// credential name -> skill name -> { slug, criteria: [...], demos }
function catalog(programId) {
    const rows = db.prepare(`
        SELECT c.name AS cred, s.id, s.slug, v.name AS skill, v.id AS vid, cs.required_demonstrations AS demos
        FROM wbl_credentials c
        JOIN wbl_credential_skills cs ON cs.credential_id = c.id
        JOIN wbl_skills s ON s.id = cs.skill_id
        JOIN wbl_skill_versions v ON v.skill_id = s.id AND v.is_current = 1
        WHERE c.program_id = ?
    `).all(programId);
    const crit = db.prepare('SELECT name FROM wbl_skill_criteria WHERE skill_version_id = ? ORDER BY order_idx');
    const out = {};
    for (const r of rows) {
        (out[r.cred] ??= {})[r.skill] = { id: r.id, slug: r.slug, demos: r.demos, criteria: crit.all(r.vid).map(c => c.name) };
    }
    return out;
}

const count = (sql, ...args) => db.prepare(sql).get(...args).n;
const V2 = readCsv(path.join(__dirname, '..', '.refs', 'cgl', 'graphics-printing-catalog-v2.csv'));
const V1 = readCsv(path.join(__dirname, '..', '.refs', 'cgl', 'graphics-printing-catalog-v1.csv'));
const MM = 'Machine Maintenance and Setup';
const mmRows = cred => V2.filter(r => r.credential === cred && r.skill === MM);

test('same skill name under two credentials imports as two skills', () => {
    const pid = newProgram();
    importCatalogRows(pid, [...mmRows('Embroidery'), ...mmRows('Direct to Film')]);
    const c = catalog(pid);
    assert.strictEqual(c.Embroidery[MM].criteria.length, 5);
    assert.strictEqual(c['Direct to Film'][MM].criteria.length, 3);
    assert.notStrictEqual(c.Embroidery[MM].id, c['Direct to Film'][MM].id);
    assert.strictEqual(c.Embroidery[MM].slug, 'machine-maintenance-and-setup');
    assert.strictEqual(c['Direct to Film'][MM].slug, 'direct-to-film--machine-maintenance-and-setup');
});

test('a later import does not attach to a same-named skill held by another credential', () => {
    const pid = newProgram();
    importCatalogRows(pid, mmRows('Embroidery'));
    importCatalogRows(pid, mmRows('Direct to Film'));
    const c = catalog(pid);
    assert.notStrictEqual(c.Embroidery[MM].id, c['Direct to Film'][MM].id);
    assert.strictEqual(c['Direct to Film'][MM].criteria.length, 3);
    assert.strictEqual(c.Embroidery[MM].criteria.length, 5);
});

test('full v2 catalog: 8 credentials, 42 skills, criteria as in the CSV', () => {
    const pid = newProgram();
    const r = importCatalogRows(pid, V2, { requiredDemonstrations: 2 });
    assert.strictEqual(r.credentials_created, 8);
    assert.strictEqual(r.skills_created, 42);
    const c = catalog(pid);
    assert.strictEqual(Object.keys(c).length, 8);
    let skills = 0, empty = 0;
    for (const [cred, bySkill] of Object.entries(c)) {
        for (const [skill, s] of Object.entries(bySkill)) {
            skills++;
            const expected = V2.filter(x => x.credential === cred && x.skill === skill && x.criterion).map(x => x.criterion);
            assert.deepStrictEqual(s.criteria, expected, `${cred} / ${skill}`);
            assert.strictEqual(s.demos, 2, `${cred} / ${skill} demos`);
            if (!s.criteria.length) empty++;
        }
    }
    assert.strictEqual(skills, 42);
    assert.strictEqual(empty, 10);
});

test('re-importing the same file changes nothing', () => {
    const pid = newProgram();
    importCatalogRows(pid, V2, { requiredDemonstrations: 2 });
    const before = JSON.stringify(catalog(pid));
    const crit = count('SELECT COUNT(*) n FROM wbl_skill_criteria');
    const r = importCatalogRows(pid, V2, { requiredDemonstrations: 2 });
    assert.strictEqual(r.credentials_created + r.skills_created, 0);
    assert.strictEqual(JSON.stringify(catalog(pid)), before);
    assert.strictEqual(count('SELECT COUNT(*) n FROM wbl_skill_criteria'), crit);
});

test('v1 sheet: header row and Habits of Work rows are skipped', () => {
    const pid = newProgram();
    assert.strictEqual(V1[0].credential, 'Microcredential');
    const r = importCatalogRows(pid, V1);
    assert.strictEqual(r.skipped_soft_skill_rows, 5);
    const names = db.prepare('SELECT name FROM wbl_credentials WHERE program_id = ?').all(pid).map(x => x.name);
    assert.ok(!names.includes('Microcredential'), 'header imported as a credential');
    assert.ok(!names.includes('Habits of Work'), 'Habits of Work imported as a credential');
    assert.strictEqual(names.length, 8);
    assert.strictEqual(count(`SELECT COUNT(*) n FROM wbl_skills WHERE program_id = ? AND slug = 'persistence'`, pid), 0);
});

test('a soft-skill name is skipped under any credential name, e.g. "Habits of Mind"', () => {
    const pid = newProgram();
    const r = importCatalogRows(pid, [
        { credential: 'Habits of Mind', skill: 'Persistence' },
        { credential: 'Character', skill: 'Academic Curiosity' },
    ]);
    assert.strictEqual(r.skipped_soft_skill_rows, 2);
    assert.strictEqual(count('SELECT COUNT(*) n FROM wbl_credentials WHERE program_id = ?', pid), 0);
});

test('required_demonstrations defaults to 1', () => {
    const pid = newProgram();
    importCatalogRows(pid, mmRows('Embroidery'));
    assert.strictEqual(catalog(pid).Embroidery[MM].demos, 1);
});

db.close();
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
