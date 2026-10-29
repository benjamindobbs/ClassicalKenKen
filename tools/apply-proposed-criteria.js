// Loads approved criteria onto skills that have none, as a new published
// version of each skill (the same path as tools/apply-credential-changelog.js).
// Dry run by default; --apply commits.
//
//   node tools/apply-proposed-criteria.js --db <path> <programId> <criteria.csv>
//        [--skip "<credential>|<skill>"]... [--apply]
//
// criteria.csv   credential,skill,criterion — one row per criterion, in order
//                (.refs/cgl/criteria-proposed-PENDING-APPROVAL.csv)
// --skip         leave a skill out (repeatable), e.g. one still awaiting approval
//
// A skill is found through its credential's links; failing that, by its
// current name when exactly one live skill in the program has it (reported,
// since it means the credential's links were edited). A skill whose current
// version already has these criteria is left alone, so re-running is a no-op;
// one that has different criteria is skipped with a warning rather than
// overwritten. Assessments stay pinned to the version they were made against.
// Note: opening the database runs server/db.js's schema migrations, as the
// server itself would on startup.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const dbPath = flag('--db');
const skips = [];
for (let s; (s = flag('--skip')) != null;) skips.push(s.toLowerCase());
const apply = args.includes('--apply');
const [programArg, csvPath] = args.filter(a => a !== '--apply');
if (!dbPath || !programArg || !csvPath) {
    console.error('usage: node tools/apply-proposed-criteria.js --db <path> <programId> <criteria.csv> [--skip "<credential>|<skill>"]... [--apply]');
    process.exit(2);
}
if (!fs.existsSync(dbPath)) { console.error(`no database at ${dbPath}`); process.exit(2); }

process.env.DB_PATH = path.resolve(dbPath);
const { db } = require('../server/db');
const { resolveSkill } = require('../server/wbl/templates');

const programId = Number(programArg);
const program = db.prepare('SELECT * FROM wbl_programs WHERE id = ?').get(programId);
if (!program) { console.error(`program ${programId} not found`); process.exit(2); }

function readCsv(file) {
    const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    return lines.slice(1).map(line => {
        const cols = [];
        let field = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"' && inQ && line[i + 1] === '"') { field += '"'; i++; }   // "" inside quotes is a literal quote (1/4")
            else if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) { cols.push(field); field = ''; }
            else field += ch;
        }
        cols.push(field);
        return cols.map(c => c.trim());
    });
}

// credential|skill -> criteria[], in file order.
const groups = new Map();
for (const [credential, skill, criterion] of readCsv(csvPath)) {
    if (!credential || !skill || !criterion) continue;
    const key = `${credential}|${skill}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(criterion);
}

const now = Date.now();
const changeNote = `Approved criteria (${path.basename(csvPath)})`;
const log = [], warnings = [];
const current = db.prepare('SELECT * FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1');
const criteriaOf = vid => db.prepare('SELECT name FROM wbl_skill_criteria WHERE skill_version_id = ? ORDER BY order_idx').all(vid).map(r => r.name);
const byName = db.prepare(`
    SELECT s.id FROM wbl_skills s JOIN wbl_skill_versions v ON v.skill_id = s.id AND v.is_current = 1
    WHERE s.program_id = ? AND s.archived_at IS NULL AND LOWER(v.name) = LOWER(?)
`);
const assessed = db.prepare('SELECT COUNT(*) n FROM wbl_skill_assessments WHERE skill_id = ?');

function findSkill(credential, skill) {
    const linked = resolveSkill(programId, credential, skill);
    if (linked) return linked;
    const named = byName.all(programId, skill);
    if (named.length === 1) {
        warnings.push(`${credential} / ${skill}: not linked to that credential; found by name (#${named[0].id})`);
        return named[0].id;
    }
    return null;
}

function publish(skillId, cur, criteria) {
    const nextNo = db.prepare('SELECT MAX(version_no) m FROM wbl_skill_versions WHERE skill_id = ?').get(skillId).m + 1;
    const v = db.prepare(`
        INSERT INTO wbl_skill_versions(skill_id, version_no, name, description, status, is_current, change_note, published_at, created_at)
        VALUES(?, ?, ?, ?, 'published', 0, ?, ?, ?)
    `).run(skillId, nextNo, cur.name, cur.description, changeNote, now, now);
    const vid = Number(v.lastInsertRowid);
    const ins = db.prepare('INSERT INTO wbl_skill_criteria(skill_version_id, name, order_idx) VALUES(?, ?, ?)');
    criteria.forEach((c, i) => ins.run(vid, c, i));
    db.prepare('UPDATE wbl_skill_versions SET is_current = 0 WHERE id = ?').run(cur.id);
    db.prepare('UPDATE wbl_skill_versions SET is_current = 1 WHERE id = ?').run(vid);
    return nextNo;
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'} — program #${programId} "${program.name}" (${program.teacher_key}) in ${dbPath}\n`);
db.exec('BEGIN');
try {
    for (const [key, criteria] of groups) {
        const [credential, skill] = key.split('|');
        if (skips.includes(key.toLowerCase())) { log.push(`${credential} / ${skill}: skipped (--skip)`); continue; }
        const skillId = findSkill(credential, skill);
        if (!skillId) { warnings.push(`${credential} / ${skill}: not found in program ${programId} — skipped`); continue; }
        const cur = current.get(skillId);
        const have = criteriaOf(cur.id);
        if (have.length === criteria.length && have.every((c, i) => c === criteria[i])) {
            log.push(`${credential} / ${skill} (#${skillId}): already has these ${criteria.length} criteria (v${cur.version_no})`);
            continue;
        }
        if (have.length) {
            warnings.push(`${credential} / ${skill} (#${skillId}): v${cur.version_no} already has ${have.length} different criteria — skipped, not overwritten`);
            continue;
        }
        const n = assessed.get(skillId).n;
        const v = publish(skillId, cur, criteria);
        log.push(`${credential} / ${skill} (#${skillId}): v${cur.version_no} -> v${v}, ${criteria.length} criteria`
            + (n ? ` — ${n} assessment(s) stay on v${cur.version_no}` : ''));
    }
    db.exec(apply ? 'COMMIT' : 'ROLLBACK');
} catch (e) {
    db.exec('ROLLBACK');
    console.error(log.join('\n'));
    console.error(`\nFAILED, nothing changed: ${e.message}`);
    process.exit(1);
}
console.log(log.join('\n'));
if (warnings.length) console.log(`\nWARNINGS\n${warnings.map(w => '  ' + w).join('\n')}`);
console.log(apply ? '\nApplied.' : '\nDry run — nothing changed. Re-run with --apply to commit.');
