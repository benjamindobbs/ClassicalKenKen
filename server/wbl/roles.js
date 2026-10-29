// Shop roles and rotation — the CGL handoff §6. A program's role vocabulary
// names the business roles on a job (Job Lead, QC Inspector, …) and the skills
// each one exercises. A participant's role column holds role codes, comma-
// separated when a student doubles up on a small job; programs with no
// vocabulary keep it as free text.
//
// Shared by the routes, tools/seed-cgl-templates.js and the tests.

const { db } = require('../db');
const { resolveSkill } = require('./templates');

// Upserts roles by code from a curriculum file ({code, label, planned_skills,
// note}). Production (operator) is left out of the rotation unless the file
// says otherwise. Skills follow seedTemplates: replaced from the file, except
// an existing role keeps its skills when any fails to resolve (report.kept).
function seedRoles(programId, roles) {
    const report = { created: [], updated: [], unchanged: [], unresolved: [], kept: [] };
    const find = db.prepare('SELECT * FROM wbl_roles WHERE program_id = ? AND code = ?');
    const skillsOf = db.prepare('SELECT skill_id FROM wbl_role_skills WHERE role_id = ? ORDER BY order_idx');

    roles.forEach((r, i) => {
        const skillIds = [];
        let missing = false;
        for (const ps of r.planned_skills || []) {
            const id = resolveSkill(programId, ps.credential, ps.skill);
            if (id) { if (!skillIds.includes(id)) skillIds.push(id); }
            else { missing = true; report.unresolved.push(`${r.code}: ${ps.credential} / ${ps.skill}`); }
        }
        const fields = {
            label: r.label, rotates: (r.rotates ?? r.code !== 'production') ? 1 : 0,
            note: r.note || '', order_idx: i,
        };
        let row = find.get(programId, r.code);
        if (!row) {
            const info = db.prepare(`INSERT INTO wbl_roles(program_id, code, label, rotates, note, order_idx, created_at)
                                     VALUES(?, ?, ?, ?, ?, ?, ?)`)
                .run(programId, r.code, fields.label, fields.rotates, fields.note, i, Date.now());
            row = { id: Number(info.lastInsertRowid) };
            report.created.push(r.code);
        } else {
            const changed = Object.keys(fields).filter(k => row[k] !== fields[k]);
            const old = skillsOf.all(row.id).map(s => s.skill_id);
            const skillsChanged = !missing && (old.length !== skillIds.length || old.some((id, j) => id !== skillIds[j]));
            if (changed.length) {
                db.prepare(`UPDATE wbl_roles SET ${changed.map(k => `${k} = ?`).join(', ')}, archived_at = NULL WHERE id = ?`)
                    .run(...changed.map(k => fields[k]), row.id);
            }
            (changed.length || skillsChanged ? report.updated : report.unchanged).push(r.code);
            if (missing) { report.kept.push(r.code); return; }
        }
        db.prepare('DELETE FROM wbl_role_skills WHERE role_id = ?').run(row.id);
        const ins = db.prepare('INSERT INTO wbl_role_skills(role_id, skill_id, order_idx) VALUES(?, ?, ?)');
        skillIds.forEach((id, j) => ins.run(row.id, id, j));
    });
    return report;
}

function listRoles(programId) {
    const roles = db.prepare(`
        SELECT * FROM wbl_roles WHERE program_id = ? AND archived_at IS NULL ORDER BY order_idx, label
    `).all(programId);
    const skills = db.prepare(`
        SELECT rs.skill_id, v.name,
               (SELECT c.name FROM wbl_credential_skills cs JOIN wbl_credentials c ON c.id = cs.credential_id
                 WHERE cs.skill_id = rs.skill_id AND c.archived_at IS NULL ORDER BY c.order_idx LIMIT 1) AS credential_name
        FROM wbl_role_skills rs
        LEFT JOIN wbl_skill_versions v ON v.skill_id = rs.skill_id AND v.is_current = 1
        WHERE rs.role_id = ? ORDER BY rs.order_idx
    `);
    return roles.map(r => ({ ...r, skills: skills.all(r.id) }));
}

const parseRoles = (text) => String(text || '').split(',').map(s => s.trim()).filter(Boolean);

// What a request's role (a code, a comma list, or an array) stores as. With a
// vocabulary every code must be one of the program's roles; without one the
// text is kept as typed. Returns { role } or { error }.
function normalizeRole(programId, input) {
    const codes = Array.isArray(input) ? input.map(c => String(c ?? '').trim()).filter(Boolean) : parseRoles(input);
    const vocab = listRoles(programId).map(r => r.code);
    if (!vocab.length) return { role: Array.isArray(input) ? codes.join(', ') : String(input ?? '').trim() };
    const unknown = codes.filter(c => !vocab.includes(c));
    if (unknown.length) return { error: 'unknown role: ' + unknown.join(', ') };
    return { role: vocab.filter(c => codes.includes(c)).join(',') };
}

// The skills a participant's role(s) exercise, in role order, deduplicated.
function roleSkillIds(programId, roleText) {
    const codes = parseRoles(roleText);
    if (!codes.length) return [];
    const ids = [];
    for (const r of listRoles(programId)) {
        if (!codes.includes(r.code)) continue;
        for (const s of r.skills) if (!ids.includes(s.skill_id)) ids.push(s.skill_id);
    }
    return ids;
}

// Per active student: how many jobs (kind='job') they've held each role on,
// the rotating roles never held, and a suggested next role — the rotating
// role held least, ties broken by vocabulary order.
function rotation(programId) {
    const roles = listRoles(programId);
    const rotating = roles.filter(r => r.rotates);
    const students = db.prepare(`
        SELECT e.student_id,
               (SELECT student_name FROM class_students cs WHERE cs.student_id = e.student_id LIMIT 1) AS student_name
        FROM wbl_program_enrollments e WHERE e.program_id = ? AND e.exited_on IS NULL ORDER BY student_name
    `).all(programId);
    const held = db.prepare(`
        SELECT wp.student_id, wp.role FROM wbl_work_event_participants wp
        JOIN wbl_work_events we ON we.id = wp.work_event_id
        WHERE we.program_id = ? AND we.kind = 'job' AND wp.role != ''
    `).all(programId);
    const counts = new Map(students.map(s => [s.student_id, Object.fromEntries(roles.map(r => [r.code, 0]))]));
    for (const h of held) {
        const c = counts.get(h.student_id);
        if (!c) continue;
        for (const code of parseRoles(h.role)) if (code in c) c[code]++;
    }
    return {
        roles: roles.map(r => ({ code: r.code, label: r.label, rotates: r.rotates })),
        students: students.map(s => {
            const c = counts.get(s.student_id);
            const least = rotating.reduce((best, r) => (best && c[best.code] <= c[r.code] ? best : r), null);
            return {
                ...s, counts: c,
                missing: rotating.filter(r => !c[r.code]).map(r => r.code),
                suggested: least?.code ?? null,
            };
        }),
    };
}

module.exports = { seedRoles, listRoles, parseRoles, normalizeRole, roleSkillIds, rotation };
