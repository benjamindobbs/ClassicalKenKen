// Seeds a program's Work Event templates from the CGL curriculum file. Dry run
// by default; --apply commits.
//
//   node tools/seed-cgl-templates.js --db <path> <programId> [templates.json] [--apply]
//
// templates.json defaults to .refs/cgl/cgl-work-event-templates.json. Each
// template's {credential, skill} pairs resolve through the credential's links
// (server/wbl/templates.js resolveSkill), so run the catalog import or
// tools/apply-credential-changelog.js first. Re-running updates templates
// from the file but keeps any brief_url the teacher has pasted in.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const dbPath = flag('--db');
const apply = args.includes('--apply');
const [programArg, jsonArg] = args.filter(a => a !== '--apply');
const jsonPath = jsonArg || path.join(__dirname, '..', '.refs', 'cgl', 'cgl-work-event-templates.json');
if (!dbPath || !programArg) {
    console.error('usage: node tools/seed-cgl-templates.js --db <path> <programId> [templates.json] [--apply]');
    process.exit(2);
}
if (!fs.existsSync(dbPath)) { console.error(`no database at ${dbPath}`); process.exit(2); }

process.env.DB_PATH = path.resolve(dbPath);
const { db } = require('../server/db');
const { seedTemplates } = require('../server/wbl/templates');

const programId = Number(programArg);
const program = db.prepare('SELECT * FROM wbl_programs WHERE id = ?').get(programId);
if (!program) { console.error(`program ${programId} not found`); process.exit(2); }
const file = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${file.templates.length} templates into program #${programId} "${program.name}" (${program.teacher_key})\n`);
db.exec('BEGIN');
let report;
try {
    report = seedTemplates(programId, file.templates);
    db.exec(apply ? 'COMMIT' : 'ROLLBACK');
} catch (e) {
    db.exec('ROLLBACK');
    console.error(`FAILED, nothing changed: ${e.message}`);
    process.exit(1);
}

const byKind = file.templates.reduce((a, t) => (a[t.kind] = (a[t.kind] || 0) + 1, a), {});
console.log(`created   ${report.created.length}${report.created.length ? ': ' + report.created.join(' ') : ''}`);
console.log(`updated   ${report.updated.length}${report.updated.length ? ': ' + report.updated.join(' ') : ''}`);
console.log(`unchanged ${report.unchanged.length}`);
console.log(`by kind   ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (report.unresolved.length) {
    console.log(`\nWARNINGS — planned skills not found in this program (left off the template):\n${report.unresolved.map(u => '  ' + u).join('\n')}`);
}
console.log(apply ? '\nApplied.' : '\nDry run — nothing changed. Re-run with --apply to commit.');
