// Bulk catalog import — the logic behind POST /programs/:id/catalog/import-csv,
// kept out of the route so tools/test-wbl-catalog-import.js can drive it
// against a scratch database.
//
// Rows mirror the legacy microcredentials CSV shape (Microcredential,
// Checkpoint, Description, Subtask) so an existing sheet can be reused:
// Credential -> Skill -> Criterion. Existing credentials (matched by name) and
// skills (matched by slug) are left untouched — a published skill version
// cannot be edited in place, and re-importing must never silently corrupt what
// a student has already been assessed against. Only new skills get criteria
// and get published; the credential<->skill link is added either way (INSERT
// OR IGNORE) so a second pass can still attach a pre-existing skill.

const { db } = require('../db');

const str = (v, d = '') => (v == null ? d : String(v));
const slugify = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The Habits of Work credential's checkpoints ARE the built-in soft skills
// (wbl_soft_skills) — scored by the Do Now / Exit Slip flow and synced as
// Habits of Work, never assessed as hard skills. Program sheets still list
// them, so they're dropped here rather than imported as look-alike skills.
const SOFT_SKILL_CREDENTIALS = new Set(['habits of work', 'habits of mind']);

// A header row in either spelling — the teacher template's or the curriculum
// sheets'. The teacher page strips it too; this guards other callers.
const HEADER_PAIRS = new Set(['credential|skill', 'microcredential|checkpoint']);

function importCatalogRows(programId, rows, { requiredDemonstrations = 1 } = {}) {
    const now = Date.now();
    const softSkillNames = new Set(
        db.prepare('SELECT name FROM wbl_soft_skills').all().map(r => r.name.toLowerCase())
    );
    const findSkill = db.prepare('SELECT id FROM wbl_skills WHERE program_id = ? AND slug = ?');
    const linkedCredentials = db.prepare('SELECT credential_id FROM wbl_credential_skills WHERE skill_id = ?');

    const credIds = new Map();        // name -> id
    const skillIds = new Map();       // slug -> id
    const slugOwner = new Map();      // slug -> credential name that claimed it in this import
    const slugFor = new Map();        // "credential|skill" -> slug, so each pair resolves once
    const newSkillOrder = [];         // slugs created this import, in row order
    const credSkillOrder = new Map(); // credential name -> [skill slug, ...] in row order
    let credsCreated = 0, skillsCreated = 0, skippedSoftSkills = 0;

    // Skills are identified by (credential, name), not name alone: Direct to
    // Film and Embroidery each have their own "Machine Maintenance and Setup".
    // The plain slug goes to whichever credential holds it first; a second
    // credential with the same skill name gets a credential-qualified slug
    // (direct-to-film--machine-maintenance-and-setup). Slugs that already
    // exist are never renamed (decision 18) — sharing one skill across
    // credentials stays possible through PUT /credentials/:id/skills.
    function resolveSlug(credName, credId, skillName) {
        const key = credName + '|' + skillName;
        if (slugFor.has(key)) return slugFor.get(key);
        const base = slugify(skillName);
        const qualified = slugify(credName) + '--' + base;
        let slug;
        if (findSkill.get(programId, qualified)) {
            slug = qualified;
        } else if (slugOwner.has(base)) {
            slug = slugOwner.get(base) === credName ? base : qualified;
        } else {
            const existing = findSkill.get(programId, base);
            const links = existing ? linkedCredentials.all(existing.id).map(r => r.credential_id) : [];
            slug = !existing || !links.length || links.includes(credId) ? base : qualified;
        }
        if (!slugOwner.has(slug)) slugOwner.set(slug, credName);
        slugFor.set(key, slug);
        return slug;
    }

    db.exec('BEGIN');
    try {
        for (const row of rows) {
            const credName = str(row.credential).trim();
            const skillName = str(row.skill).trim();
            if (!credName || !skillName || !slugify(skillName)) continue;
            if (HEADER_PAIRS.has(`${credName.toLowerCase()}|${skillName.toLowerCase()}`)) continue;
            if (SOFT_SKILL_CREDENTIALS.has(credName.toLowerCase()) || softSkillNames.has(skillName.toLowerCase())) {
                skippedSoftSkills++;
                continue;
            }

            if (!credIds.has(credName)) {
                let cred = db.prepare('SELECT id FROM wbl_credentials WHERE program_id = ? AND name = ?')
                    .get(programId, credName);
                if (!cred) {
                    const info = db.prepare(`
                        INSERT INTO wbl_credentials(program_id, name, description, min_holistic_tier, order_idx, created_at)
                        VALUES(?, ?, '', 'meets', ?, ?)
                    `).run(programId, credName, credIds.size, now);
                    cred = { id: Number(info.lastInsertRowid) };
                    credsCreated++;
                }
                credIds.set(credName, cred.id);
                credSkillOrder.set(credName, []);
            }
            const slug = resolveSlug(credName, credIds.get(credName), skillName);
            if (!credSkillOrder.get(credName).includes(slug)) credSkillOrder.get(credName).push(slug);

            if (!skillIds.has(slug)) {
                let skill = findSkill.get(programId, slug);
                if (!skill) {
                    const s = db.prepare('INSERT INTO wbl_skills(program_id, slug, created_at) VALUES(?, ?, ?)')
                        .run(programId, slug, now);
                    db.prepare(`
                        INSERT INTO wbl_skill_versions(skill_id, version_no, name, description, status, created_at)
                        VALUES(?, 1, ?, ?, 'draft', ?)
                    `).run(s.lastInsertRowid, skillName, str(row.description), now);
                    skill = { id: Number(s.lastInsertRowid) };
                    skillsCreated++;
                    newSkillOrder.push(slug);
                }
                skillIds.set(slug, skill.id);
            }

            const criterion = str(row.criterion).trim();
            if (criterion && newSkillOrder.includes(slug)) {
                const v = db.prepare('SELECT id FROM wbl_skill_versions WHERE skill_id = ? AND status = ?')
                    .get(skillIds.get(slug), 'draft');
                const n = db.prepare('SELECT COUNT(*) n FROM wbl_skill_criteria WHERE skill_version_id = ?').get(v.id).n;
                db.prepare('INSERT INTO wbl_skill_criteria(skill_version_id, name, order_idx) VALUES(?, ?, ?)')
                    .run(v.id, criterion, n);
            }
        }

        for (const slug of newSkillOrder) {
            const v = db.prepare('SELECT id FROM wbl_skill_versions WHERE skill_id = ? AND status = ?')
                .get(skillIds.get(slug), 'draft');
            db.prepare(`UPDATE wbl_skill_versions SET status = 'published', is_current = 1, published_at = ? WHERE id = ?`)
                .run(now, v.id);
        }

        const linkCred = db.prepare(`
            INSERT OR IGNORE INTO wbl_credential_skills(credential_id, skill_id, required_demonstrations, order_idx)
            VALUES(?, ?, ?, ?)
        `);
        for (const [credName, slugs] of credSkillOrder) {
            slugs.forEach((slug, i) => linkCred.run(credIds.get(credName), skillIds.get(slug), requiredDemonstrations, i));
        }

        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    return {
        credentials_created: credsCreated,
        skills_created: skillsCreated,
        skipped_soft_skill_rows: skippedSoftSkills,
        rows: rows.length,
    };
}

module.exports = { importCatalogRows, slugify };
