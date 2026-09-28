// Preview what the question image migration (server/englishBankMigration.js)
// would change in a database, without writing to it.
//
//   node tools/preview-english-migration.js data/prod-scores.db

const { DatabaseSync } = require('node:sqlite');
const { runEnglishBankMigration, LEGACY_CONVENTIONS } = require('../server/englishBankMigration');

const file = process.argv[2];
if (!file) {
    console.error('usage: node tools/preview-english-migration.js <scores.db>');
    process.exit(1);
}
const db = new DatabaseSync(file, { readOnly: true });

const r = runEnglishBankMigration(db, { dryRun: true });
console.log('Skill renames (rows):');
for (const [k, n] of Object.entries(r.renamed)) console.log(`  ${String(n).padStart(6)}  ${k}`);
for (const [subject, c] of Object.entries(r.cleared)) {
    console.log(c.alreadyApplied
        ? `${subject} reports/suppressions: already cleared on this database`
        : `${subject} reports to clear: ${c.reports}, suppressions to clear: ${c.suppressions}`);
}

const legacy = db.prepare(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT user_key) AS students
    FROM sat_scores WHERE domain_idx = ? AND skill = ''
`).get(LEGACY_CONVENTIONS.domainIdx);
console.log(`\nConventions answers from before the skill split (left as-is): ${legacy.rows} rows, ${legacy.students} students`);
console.log(`  /api/sat/next reads them as history for: ${LEGACY_CONVENTIONS.skills.join(', ')}`);
console.log(`  dashboards label them: "${LEGACY_CONVENTIONS.label}"`);
