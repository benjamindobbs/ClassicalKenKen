// Data fixes for the move to PDF-crop question images (SAT-Questions/
// extract_english.py and extract_math_choices.py).
//
// The old English extractor misread wrapped cells in the PDF metadata table,
// so some answers were recorded under a truncated skill name, and every
// Standard English Conventions answer was recorded with skill ''. The rebuilt
// banks carry the real names.
//
//  - Truncated skill names are renamed. This runs on every startup (it is a
//    no-op once clean) so a score posted from a stale browser tab after the
//    deploy still gets fixed on the next restart.
//  - Conventions rows with skill '' can't be split: scores don't record the
//    question. They stay as they are; /api/sat/next reads them as history for
//    both Conventions skills (LEGACY_CONVENTIONS) and the dashboards label them.
//  - Question reports and suppressions for both subjects were almost all about
//    bad OCR/extracted text, which students no longer see, so they are
//    cleared once per subject.

const SKILL_RENAMES = [
    { domainIdx: 1, from: 'Text Structure and',     to: 'Text Structure and Purpose' },
    { domainIdx: 1, from: 'Cross-text Connections', to: 'Cross-Text Connections' },
    { domainIdx: 1, from: 'Words in ContextMedium', to: 'Words in Context' },
];

// Each clear is recorded separately in schema_migrations.
const REPORT_CLEARS = [
    { name: 'english-bank-rebuild-2026-09', subject: 'english' },
    { name: 'math-image-choices-2026-09',   subject: 'math' },
];

const LEGACY_CONVENTIONS = {
    domainIdx: 3,
    skills: ['Boundaries', 'Form, Structure, and Sense'],
    label: 'Conventions (before skill split)',
};

function tableExists(db, name) {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

// Returns what was (or, with dryRun, would be) changed:
//   { renamed: { 'from -> to': n }, cleared: { <subject>: { reports, suppressions, alreadyApplied } } }
// dryRun only reads, so it is safe on a read-only connection.
function runEnglishBankMigration(db, { dryRun = false } = {}) {
    const result = { renamed: {}, cleared: {} };
    const count = (sql, ...args) => db.prepare(sql).get(...args).n;

    if (!dryRun) db.exec('BEGIN');
    try {
        for (const r of SKILL_RENAMES) {
            result.renamed[`${r.from} -> ${r.to}`] = dryRun
                ? count('SELECT COUNT(*) AS n FROM sat_scores WHERE domain_idx = ? AND skill = ?', r.domainIdx, r.from)
                : Number(db.prepare('UPDATE sat_scores SET skill = ? WHERE domain_idx = ? AND skill = ?')
                    .run(r.to, r.domainIdx, r.from).changes);
        }

        if (!dryRun) {
            db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
        }
        const hasMarkers = tableExists(db, 'schema_migrations');
        for (const { name, subject } of REPORT_CLEARS) {
            const c = { reports: 0, suppressions: 0, alreadyApplied: false };
            result.cleared[subject] = c;
            c.alreadyApplied = hasMarkers && !!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
            if (c.alreadyApplied) continue;
            if (dryRun) {
                c.reports = count('SELECT COUNT(*) AS n FROM question_reports WHERE subject = ?', subject);
                c.suppressions = count('SELECT COUNT(*) AS n FROM suppressed_questions WHERE subject = ?', subject);
            } else {
                c.reports = Number(db.prepare('DELETE FROM question_reports WHERE subject = ?').run(subject).changes);
                c.suppressions = Number(db.prepare('DELETE FROM suppressed_questions WHERE subject = ?').run(subject).changes);
                db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
            }
        }
        if (!dryRun) db.exec('COMMIT');
    } catch (err) {
        if (!dryRun) db.exec('ROLLBACK');
        throw err;
    }
    return result;
}

module.exports = { runEnglishBankMigration, LEGACY_CONVENTIONS };
