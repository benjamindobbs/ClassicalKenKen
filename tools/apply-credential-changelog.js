// Brings an existing program's catalog up to a new curriculum version without
// re-importing it (re-importing would create duplicates of every reworded
// skill). Dry run by default; --apply commits.
//
//   node tools/apply-credential-changelog.js --db <path> <programId> <changelog.csv> <catalog.csv>
//        [--demos N] [--apply]
//
// changelog.csv  Microcredential,Checkpoint,Field,Old (v1),New,New version
//                (.refs/cgl/credential-changelog-2026-10-21.csv)
// catalog.csv    the full new catalog, credential,skill,description,criterion
//                (.refs/cgl/graphics-printing-catalog-v2.csv) — supplies new
//                skills' descriptions and the per-credential criteria used to
//                split a merged skill.
//
// Steps, in order:
//   1. Archive junk credentials the old importer created: a CSV header row
//      imported as "Microcredential", and Habits of Work / Habits of Mind,
//      whose checkpoints are the built-in soft skills. Their skills are
//      archived too unless another live credential still requires them.
//   2. Split any skill the old slug-only importer shared between credentials
//      that the catalog lists separately (Direct to Film and Embroidery
//      "Machine Maintenance and Setup"). The first credential keeps the skill,
//      re-versioned to its own criteria; each other credential gets a new
//      skill. Refused for a skill that already has evidence on it.
//   3. Changelog rewordings become a new published version of the skill
//      (copy the current criteria, swap only the reworded ones). Assessments
//      stay pinned to the version they were made against.
//   4. Changelog "new checkpoint" rows create, publish and link the skill.
//   5. --demos N sets required_demonstrations on every live credential's links.
//
// Every step runs inside one transaction; a dry run rolls it back, so the
// report shows exactly what --apply would do. Re-running after --apply finds
// nothing left to do. Note: opening the database runs server/db.js's schema
// migrations, as the server itself would on startup.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const dbPath = flag('--db');
const demosArg = flag('--demos');
const apply = args.includes('--apply');
const [programArg, changelogPath, catalogPath] = args.filter(a => a !== '--apply');
if (!dbPath || !programArg || !changelogPath || !catalogPath) {
    console.error('usage: node tools/apply-credential-changelog.js --db <path> <programId> <changelog.csv> <catalog.csv> [--demos N] [--apply]');
    process.exit(2);
}
if (!fs.existsSync(dbPath)) { console.error(`no database at ${dbPath}`); process.exit(2); }
const demos = demosArg == null ? null : Number(demosArg);
if (demos != null && (!Number.isInteger(demos) || demos < 1)) { console.error('--demos must be a whole number of at least 1'); process.exit(2); }

process.env.DB_PATH = path.resolve(dbPath);
const { db } = require('../server/db');
const { slugify } = require('../server/wbl/catalogImport');

const programId = Number(programArg);
const program = db.prepare('SELECT * FROM wbl_programs WHERE id = ?').get(programId);
if (!program) { console.error(`program ${programId} not found`); process.exit(2); }

function readCsv(file) {
    const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    return lines.slice(1).map(line => {
        const cols = [];
        let field = '', inQ = false;
        for (const ch of line) {
            if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) { cols.push(field); field = ''; }
            else field += ch;
        }
        cols.push(field);
        return cols.map(c => c.trim());
    });
}

const changelog = readCsv(changelogPath).map(([credential, skill, field, oldValue, newValue, version]) =>
    ({ credential, skill, field, oldValue, newValue, version }));
const catalogRows = readCsv(catalogPath).map(([credential, skill, description, criterion]) =>
    ({ credential, skill, description, criterion }));
const changeNote = `Credential changelog ${path.basename(changelogPath).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? path.basename(changelogPath)}`;

// The catalog as credential -> skill -> { description, criteria[] }, compared
// case-insensitively because names are typed by hand.
const lc = s => s.toLowerCase();
const catalog = new Map();
for (const r of catalogRows) {
    const bySkill = catalog.get(lc(r.credential)) ?? new Map();
    catalog.set(lc(r.credential), bySkill);
    const entry = bySkill.get(lc(r.skill)) ?? { description: '', criteria: [] };
    bySkill.set(lc(r.skill), entry);
    if (r.description) entry.description = r.description;
    if (r.criterion) entry.criteria.push(r.criterion);
}

const now = Date.now();
const log = [];
const warnings = [];
const say = s => log.push(s);

const q = {
    liveCreds: db.prepare('SELECT * FROM wbl_credentials WHERE program_id = ? AND archived_at IS NULL ORDER BY order_idx'),
    credByName: db.prepare('SELECT * FROM wbl_credentials WHERE program_id = ? AND LOWER(name) = LOWER(?) AND archived_at IS NULL'),
    links: db.prepare(`
        SELECT cs.*, v.id AS version_id, v.version_no, v.name AS skill_name, v.description, s.slug, s.archived_at
        FROM wbl_credential_skills cs
        JOIN wbl_skills s ON s.id = cs.skill_id
        LEFT JOIN wbl_skill_versions v ON v.skill_id = s.id AND v.is_current = 1
        WHERE cs.credential_id = ? ORDER BY cs.order_idx`),
    current: db.prepare('SELECT * FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1'),
    criteria: db.prepare('SELECT name FROM wbl_skill_criteria WHERE skill_version_id = ? ORDER BY order_idx'),
    skillCreds: db.prepare(`
        SELECT c.* FROM wbl_credential_skills cs JOIN wbl_credentials c ON c.id = cs.credential_id
        WHERE cs.skill_id = ? ORDER BY c.order_idx`),
    slugTaken: db.prepare('SELECT 1 FROM wbl_skills WHERE program_id = ? AND slug = ?'),
    softSkills: db.prepare('SELECT name FROM wbl_soft_skills'),
    evidence: db.prepare(`
        SELECT (SELECT COUNT(*) FROM wbl_skill_assessments WHERE skill_id = ?) AS assessments,
               (SELECT COUNT(*) FROM wbl_skill_checks      WHERE skill_id = ?) AS skill_checks,
               (SELECT COUNT(*) FROM wbl_work_event_skills WHERE skill_id = ?) AS planned`),
};

const criteriaOf = versionId => q.criteria.all(versionId).map(r => r.name);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function insertVersion(skillId, versionNo, name, description, criteria, note) {
    const v = db.prepare(`
        INSERT INTO wbl_skill_versions(skill_id, version_no, name, description, status, is_current, change_note, published_at, created_at)
        VALUES(?, ?, ?, ?, 'published', 0, ?, ?, ?)
    `).run(skillId, versionNo, name, description, note, now, now);
    const ins = db.prepare('INSERT INTO wbl_skill_criteria(skill_version_id, name, order_idx) VALUES(?, ?, ?)');
    criteria.forEach((c, i) => ins.run(v.lastInsertRowid, c, i));
    return Number(v.lastInsertRowid);
}

// Same path as POST /skills/:id/versions followed by .../publish: the old
// version stays published (assessments point at it) but stops being current.
function publishNewVersion(skillId, name, description, criteria) {
    const cur = q.current.get(skillId);
    const nextNo = db.prepare('SELECT MAX(version_no) m FROM wbl_skill_versions WHERE skill_id = ?').get(skillId).m + 1;
    const vid = insertVersion(skillId, nextNo, name, description, criteria, changeNote);
    db.prepare('UPDATE wbl_skill_versions SET is_current = 0 WHERE id = ?').run(cur.id);
    db.prepare('UPDATE wbl_skill_versions SET is_current = 1 WHERE id = ?').run(vid);
    return nextNo;
}

function createSkill(credential, name, description, criteria) {
    const base = slugify(name);
    const slug = q.slugTaken.get(programId, base) ? `${slugify(credential.name)}--${base}` : base;
    if (q.slugTaken.get(programId, slug)) throw new Error(`slug ${slug} already taken`);
    const s = db.prepare('INSERT INTO wbl_skills(program_id, slug, created_at) VALUES(?, ?, ?)').run(programId, slug, now);
    const skillId = Number(s.lastInsertRowid);
    const vid = insertVersion(skillId, 1, name, description, criteria, '');
    db.prepare('UPDATE wbl_skill_versions SET is_current = 1 WHERE id = ?').run(vid);
    return { skillId, slug };
}

// --- 1. Junk credentials ----------------------------------------------------
function archiveJunkCredentials() {
    const softNames = new Set(q.softSkills.all().map(r => lc(r.name)));
    const junk = q.liveCreds.all(programId).filter(c => {
        const name = lc(c.name);
        if (name === 'microcredential' || name === 'credential') return true;
        if (name === 'habits of work' || name === 'habits of mind') return true;
        const links = q.links.all(c.id);
        return links.length > 0 && links.every(l => softNames.has(lc(l.skill_name ?? '')));
    });
    for (const c of junk) {
        db.prepare('UPDATE wbl_credentials SET archived_at = ? WHERE id = ?').run(now, c.id);
        say(`archive credential #${c.id} "${c.name}"`);
        for (const l of q.links.all(c.id)) {
            if (l.archived_at) continue;
            const stillNeeded = q.skillCreds.all(l.skill_id).some(o => !o.archived_at && o.id !== c.id);
            if (stillNeeded) { say(`  keep skill #${l.skill_id} "${l.skill_name}" (another credential requires it)`); continue; }
            db.prepare('UPDATE wbl_skills SET archived_at = ? WHERE id = ?').run(now, l.skill_id);
            const ev = q.evidence.get(l.skill_id, l.skill_id, l.skill_id);
            const note = ev.assessments + ev.skill_checks + ev.planned
                ? ` — keeps its history: ${ev.assessments} assessment(s), ${ev.skill_checks} skill check(s), planned on ${ev.planned} work event(s)`
                : '';
            say(`  archive skill #${l.skill_id} "${l.skill_name}"${note}`);
        }
    }
    if (!junk.length) say('no junk credentials');
}

// --- 2. Split shared skills ---------------------------------------------------
function splitSharedSkills() {
    let any = false;
    const seen = new Set();
    for (const cred of q.liveCreds.all(programId)) {
        for (const l of q.links.all(cred.id)) {
            if (l.archived_at || seen.has(l.skill_id)) continue;
            seen.add(l.skill_id);
            const owners = q.skillCreds.all(l.skill_id).filter(c => !c.archived_at);
            if (owners.length < 2) continue;
            const listed = owners.filter(c => catalog.get(lc(c.name))?.has(lc(l.skill_name)));
            if (listed.length < 2) continue;   // a deliberate share, not an import collision
            any = true;
            const ev = q.evidence.get(l.skill_id, l.skill_id, l.skill_id);
            if (ev.assessments + ev.skill_checks) {
                warnings.push(`skill #${l.skill_id} "${l.skill_name}" is shared by ${listed.map(c => c.name).join(' and ')} `
                    + `but has ${ev.assessments} assessment(s) and ${ev.skill_checks} skill check(s) — not split; resolve by hand`);
                continue;
            }
            // The credential whose criteria lead the merged list is the one the
            // old importer saw first; it keeps the original skill.
            const merged = criteriaOf(l.version_id);
            const keeper = listed.find(c => {
                const own = catalog.get(lc(c.name)).get(lc(l.skill_name)).criteria;
                return own.length && sameList(merged.slice(0, own.length), own);
            }) ?? listed[0];
            say(`split skill #${l.skill_id} "${l.skill_name}" (${merged.length} merged criteria)`);
            const keep = catalog.get(lc(keeper.name)).get(lc(l.skill_name));
            if (!sameList(merged, keep.criteria)) {
                const v = publishNewVersion(l.skill_id, l.skill_name, keep.description || l.description, keep.criteria);
                say(`  #${l.skill_id} stays with ${keeper.name}: v${v} with its ${keep.criteria.length} criteria`);
            }
            const newSkillFor = new Map([[keeper.id, l.skill_id]]);
            for (const other of listed.filter(c => c.id !== keeper.id)) {
                const own = catalog.get(lc(other.name)).get(lc(l.skill_name));
                const link = q.links.all(other.id).find(x => x.skill_id === l.skill_id);
                const made = createSkill(other, l.skill_name, own.description, own.criteria);
                newSkillFor.set(other.id, made.skillId);
                db.prepare('UPDATE wbl_credential_skills SET skill_id = ? WHERE credential_id = ? AND skill_id = ?')
                    .run(made.skillId, other.id, l.skill_id);
                db.prepare('UPDATE wbl_credential_skill_sync SET skill_id = ? WHERE credential_id = ? AND skill_id = ?')
                    .run(made.skillId, other.id, l.skill_id);
                say(`  ${other.name} gets new skill #${made.skillId} (${made.slug}) with its ${own.criteria.length} criteria, `
                    + `keeping order ${link.order_idx} and ${link.required_demonstrations} demo(s)`);
            }
            // A job that planned the merged skill keeps the half that matches
            // its other planned skills — a DTF setup job planning Machine
            // Maintenance alongside RasterLink means the DTF one.
            const planned = db.prepare(`
                SELECT we.id, we.title FROM wbl_work_event_skills wes JOIN wbl_work_events we ON we.id = wes.work_event_id
                WHERE wes.skill_id = ?`).all(l.skill_id);
            for (const we of planned) {
                const votes = new Map();
                for (const { credential_id } of db.prepare(`
                    SELECT cs.credential_id FROM wbl_work_event_skills wes
                    JOIN wbl_credential_skills cs ON cs.skill_id = wes.skill_id
                    WHERE wes.work_event_id = ? AND wes.skill_id != ?`).all(we.id, l.skill_id)) {
                    if (newSkillFor.has(credential_id)) votes.set(credential_id, (votes.get(credential_id) ?? 0) + 1);
                }
                const ranked = [...votes].sort((a, b) => b[1] - a[1]);
                if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) {
                    warnings.push(`work event #${we.id} "${we.title}" plans "${l.skill_name}" with no clear credential; left on ${keeper.name}'s skill`);
                    continue;
                }
                const target = ranked[0][0];
                const credName = listed.find(c => c.id === target).name;
                if (newSkillFor.get(target) !== l.skill_id) {
                    db.prepare('UPDATE wbl_work_event_skills SET skill_id = ? WHERE work_event_id = ? AND skill_id = ?')
                        .run(newSkillFor.get(target), we.id, l.skill_id);
                }
                say(`  work event #${we.id} "${we.title}" plans the ${credName} skill`);
            }
        }
    }
    if (!any) say('no shared skills to split');
}

// The live skill a changelog row names: current name, under that credential.
function findSkill(credName, skillName) {
    const cred = q.credByName.get(programId, credName);
    if (!cred) return { cred: null, link: null };
    const link = q.links.all(cred.id).find(l => !l.archived_at && lc(l.skill_name ?? '') === lc(skillName));
    return { cred, link };
}

// --- 3. Rewordings -------------------------------------------------------------
function applyRewordings() {
    const groups = new Map();
    for (const r of changelog.filter(r => r.field === 'Description' || r.field === 'Subtask')) {
        const key = `${r.credential}|${r.skill}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    for (const rows of groups.values()) {
        const { credential, skill } = rows[0];
        const { cred, link } = findSkill(credential, skill);
        if (!link) { warnings.push(`${credential} / ${skill}: not found in program ${programId} — rewording skipped`); continue; }
        const cur = q.current.get(link.skill_id);
        const criteria = criteriaOf(cur.id);
        let description = cur.description;
        const swaps = [];
        for (const r of rows) {
            if (r.field === 'Description') {
                if (description !== r.newValue) { description = r.newValue; swaps.push('description'); }
                continue;
            }
            const i = criteria.indexOf(r.oldValue);
            if (i >= 0) { criteria[i] = r.newValue; swaps.push(`criterion ${i + 1}`); }
            else if (!criteria.includes(r.newValue)) warnings.push(`${credential} / ${skill}: criterion "${r.oldValue}" not found — not reworded`);
        }
        if (!swaps.length) { say(`${cred.name} / ${skill}: already up to date (v${cur.version_no})`); continue; }
        const ev = q.evidence.get(link.skill_id, link.skill_id, link.skill_id);
        const v = publishNewVersion(link.skill_id, cur.name, description, criteria);
        say(`${cred.name} / ${skill} (#${link.skill_id}): v${cur.version_no} -> v${v}, reworded ${swaps.join(', ')}`
            + (ev.assessments + ev.skill_checks ? ` — ${ev.assessments} assessment(s) and ${ev.skill_checks} skill check(s) stay on v${cur.version_no}` : ''));
    }
}

// --- 4. New checkpoints ----------------------------------------------------------
function addNewCheckpoints() {
    const groups = new Map();
    for (const r of changelog.filter(r => r.field.startsWith('Subtask (new'))) {
        const key = `${r.credential}|${r.skill}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r.newValue);
    }
    for (const [key, criteria] of groups) {
        const [credential, skill] = key.split('|');
        const { cred, link } = findSkill(credential, skill);
        if (!cred) { warnings.push(`${credential}: credential not found — new checkpoint "${skill}" skipped`); continue; }
        if (link) { say(`${cred.name} / ${skill}: already exists (#${link.skill_id})`); continue; }
        const description = catalog.get(lc(credential))?.get(lc(skill))?.description ?? '';
        if (!description) warnings.push(`${credential} / ${skill}: no description in the catalog`);
        const links = q.links.all(cred.id);
        const orderIdx = links.length ? Math.max(...links.map(l => l.order_idx)) + 1 : 0;
        const made = createSkill(cred, skill, description, criteria);
        const rd = demos ?? 2;
        db.prepare('INSERT INTO wbl_credential_skills(credential_id, skill_id, required_demonstrations, order_idx) VALUES(?, ?, ?, ?)')
            .run(cred.id, made.skillId, rd, orderIdx);
        say(`${cred.name} / ${skill}: new skill #${made.skillId} (${made.slug}), ${criteria.length} criteria, ${rd} demo(s)`);
    }
}

// --- 5. Required demonstrations -----------------------------------------------------
function setDemos() {
    if (demos == null) return say('required demonstrations unchanged (no --demos)');
    let changed = 0;
    for (const c of q.liveCreds.all(programId)) {
        changed += Number(db.prepare(`
            UPDATE wbl_credential_skills SET required_demonstrations = ?
            WHERE credential_id = ? AND required_demonstrations != ?
        `).run(demos, c.id, demos).changes);
    }
    say(`required demonstrations set to ${demos} on ${changed} link(s)`);
}

function summary() {
    const creds = q.liveCreds.all(programId);
    const lines = creds.map(c => {
        const links = q.links.all(c.id);
        const rd = [...new Set(links.map(l => l.required_demonstrations))].join('/');
        return `  ${c.name}: ${links.length} skill(s), ${rd} demo(s)`;
    });
    return [`${creds.length} live credential(s):`, ...lines];
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'} — program #${programId} "${program.name}" (${program.teacher_key}) in ${dbPath}\n`);
db.exec('BEGIN');
try {
    say('— junk credentials'); archiveJunkCredentials();
    say('— shared skills');    splitSharedSkills();
    say('— rewordings');       applyRewordings();
    say('— new checkpoints');  addNewCheckpoints();
    say('— demonstrations');   setDemos();
    log.push('', ...summary());
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
