// Work Event templates — the CGL handoff §4. A template is a reusable
// practical, library project or business module; starting one creates the
// Work Event, its planned skills and its participants in one step.
//
// Shared by the routes, tools/seed-cgl-templates.js and the tests.

const { db } = require('../db');
const L = require('./logic');

// A curriculum file names skills as {credential, skill} pairs. They resolve
// through the credential's links rather than by slug, because the same skill
// name can live under two credentials (Direct to Film and Embroidery "Machine
// Maintenance and Setup") with different slugs.
function resolveSkill(programId, credentialName, skillName) {
    return db.prepare(`
        SELECT s.id FROM wbl_credentials c
        JOIN wbl_credential_skills cs ON cs.credential_id = c.id
        JOIN wbl_skills s ON s.id = cs.skill_id AND s.archived_at IS NULL
        JOIN wbl_skill_versions v ON v.skill_id = s.id AND v.is_current = 1
        WHERE c.program_id = ? AND c.archived_at IS NULL
          AND LOWER(c.name) = LOWER(?) AND LOWER(v.name) = LOWER(?)
    `).get(programId, credentialName, skillName)?.id ?? null;
}

// Upserts templates by code. The curriculum file owns every field except
// brief_url, which the teacher pastes in afterward (Shared Drive links) and a
// re-seed must not wipe. Planned skills are replaced from the file — except
// when any of an existing template's skills fails to resolve (e.g. a
// credential's links were edited), in which case its current planned skills
// are kept rather than silently dropped (report.kept). Runs inside the
// caller's transaction; returns a report and any unresolved skills.
function seedTemplates(programId, templates) {
    const report = { created: [], updated: [], unchanged: [], unresolved: [], kept: [] };
    const find = db.prepare('SELECT * FROM wbl_work_event_templates WHERE program_id = ? AND code = ?');
    const skillsOf = db.prepare('SELECT skill_id FROM wbl_work_event_template_skills WHERE template_id = ? ORDER BY order_idx');

    templates.forEach((t, i) => {
        if (!L.WORK_EVENT_KINDS.includes(t.kind)) throw new Error(`${t.code}: unknown kind "${t.kind}"`);
        const skillIds = [];
        let missing = false;
        for (const ps of t.planned_skills || []) {
            const id = resolveSkill(programId, ps.credential, ps.skill);
            if (id) { if (!skillIds.includes(id)) skillIds.push(id); }
            else { missing = true; report.unresolved.push(`${t.code}: ${ps.credential} / ${ps.skill}`); }
        }
        const fields = {
            title: t.title, kind: t.kind, gate_machine_code: t.gate_for_machine || null,
            onboarding: t.onboarding ? 1 : 0, notes: t.notes || '', order_idx: i,
        };

        let row = find.get(programId, t.code);
        if (!row) {
            const info = db.prepare(`
                INSERT INTO wbl_work_event_templates
                    (program_id, code, title, kind, gate_machine_code, onboarding, brief_url, notes, order_idx, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(programId, t.code, fields.title, fields.kind, fields.gate_machine_code, fields.onboarding,
                   t.brief_url || '', fields.notes, fields.order_idx, Date.now());
            row = { id: Number(info.lastInsertRowid) };
            report.created.push(t.code);
        } else {
            const changed = Object.keys(fields).filter(k => row[k] !== fields[k]);
            const oldSkills = skillsOf.all(row.id).map(r => r.skill_id);
            const skillsChanged = !missing
                && (oldSkills.length !== skillIds.length || oldSkills.some((id, j) => id !== skillIds[j]));
            if (changed.length) {
                db.prepare(`UPDATE wbl_work_event_templates SET ${changed.map(k => `${k} = ?`).join(', ')}, archived_at = NULL WHERE id = ?`)
                    .run(...changed.map(k => fields[k]), row.id);
            }
            (changed.length || skillsChanged ? report.updated : report.unchanged).push(t.code);
            if (missing) { report.kept.push(t.code); return; }
        }
        setTemplateSkills(row.id, skillIds);
    });
    return report;
}

function setTemplateSkills(templateId, skillIds) {
    db.prepare('DELETE FROM wbl_work_event_template_skills WHERE template_id = ?').run(templateId);
    const ins = db.prepare('INSERT OR IGNORE INTO wbl_work_event_template_skills(template_id, skill_id, order_idx) VALUES(?, ?, ?)');
    skillIds.forEach((id, i) => ins.run(templateId, id, i));
}

function listTemplates(programId, { includeArchived = false } = {}) {
    const rows = db.prepare(`
        SELECT * FROM wbl_work_event_templates
        WHERE program_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}
        ORDER BY onboarding DESC, order_idx, code
    `).all(programId);
    const skills = db.prepare(`
        SELECT ts.skill_id, v.name,
               (SELECT c.name FROM wbl_credential_skills cs JOIN wbl_credentials c ON c.id = cs.credential_id
                 WHERE cs.skill_id = ts.skill_id AND c.archived_at IS NULL ORDER BY c.order_idx LIMIT 1) AS credential_name
        FROM wbl_work_event_template_skills ts
        LEFT JOIN wbl_skill_versions v ON v.skill_id = ts.skill_id AND v.is_current = 1
        WHERE ts.template_id = ? ORDER BY ts.order_idx
    `);
    return rows.map(t => ({ ...t, evidence: L.evidenceLetter(t.kind), skills: skills.all(t.id) }));
}

// Creates the Work Event (kind, title, template_code, planned skills) and its
// participants in one transaction. `students` is [{class_id, student_id}] —
// participants carry their own section, so a practical can mix periods.
function createFromTemplate(programId, templateId, { title, opened_on, closed_on, students = [], role = '' } = {}) {
    const t = db.prepare('SELECT * FROM wbl_work_event_templates WHERE id = ? AND program_id = ?').get(templateId, programId);
    if (!t) throw Object.assign(new Error('template_not_found'), { status: 404 });
    const on = L.isDate(opened_on) ? opened_on : L.today();
    const due = L.isDate(closed_on) ? closed_on : null;

    db.exec('BEGIN');
    try {
        const info = db.prepare(`
            INSERT INTO wbl_work_events(program_id, title, description, kind, template_code, opened_on, closed_on, created_at, updated_at)
            VALUES(?, ?, '', ?, ?, ?, ?, ?, ?)
        `).run(programId, (title || '').trim() || `${t.code} · ${t.title}`, t.kind, t.code, on, due, Date.now(), Date.now());
        const weId = Number(info.lastInsertRowid);
        db.prepare(`
            INSERT INTO wbl_work_event_skills(work_event_id, skill_id)
            SELECT ?, ts.skill_id FROM wbl_work_event_template_skills ts
            JOIN wbl_skills s ON s.id = ts.skill_id AND s.archived_at IS NULL
            WHERE ts.template_id = ?
        `).run(weId, t.id);

        const byClass = new Map();
        for (const s of students) {
            const classId = Number(s.class_id);
            if (!classId || !s.student_id) continue;
            if (!byClass.has(classId)) byClass.set(classId, []);
            byClass.get(classId).push(String(s.student_id));
        }
        let added = 0;
        for (const [classId, ids] of byClass) added += L.addParticipants(programId, weId, classId, ids, role, on);
        db.exec('COMMIT');
        return { id: weId, added };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { resolveSkill, seedTemplates, setTemplateSkills, listTemplates, createFromTemplate };
