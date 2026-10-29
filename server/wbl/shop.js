// The open-shop views — the CGL handoff §7: a student's Today screen (their
// lane and single next step), the pacing floor, and credential coverage.
//
// Shared by the routes and the tests.

const { db } = require('../db');
const L = require('./logic');
const G = require('./gates');
const { listTemplates } = require('./templates');
const { listRoles, parseRoles } = require('./roles');
const { parsePacket } = require('./packets');

const programCredentials = (programId) => db.prepare(`
    SELECT id, name FROM wbl_credentials WHERE program_id = ? AND archived_at IS NULL ORDER BY order_idx, id
`).all(programId);

const awardedNames = (programId, studentId) => db.prepare(`
    SELECT c.name FROM wbl_credential_awards a JOIN wbl_credentials c ON c.id = a.credential_id
    WHERE a.program_id = ? AND a.student_id = ? AND a.revoked_at IS NULL
`).all(programId, studentId).map(r => r.name);

// Per credential, the student's progress; per skill, whether any credential
// linking it counts it satisfied (a skill's demonstrations are the same
// whichever credential asks, only the threshold can differ).
function studentProgress(programId, studentId) {
    const awarded = new Set(awardedNames(programId, studentId));
    const skills = new Map();
    const credentials = programCredentials(programId).map(c => {
        const prog = L.credentialProgress(c.id, programId, studentId);
        for (const s of prog.skills) {
            const prior = skills.get(s.skill_id);
            if (!prior || (s.satisfied && !prior.satisfied)) skills.set(s.skill_id, s);
        }
        return {
            credential_id: c.id, name: c.name, awarded: awarded.has(c.name),
            skills_total: prog.skills.length, skills_satisfied: prog.skills.filter(s => s.satisfied).length,
        };
    });
    return { credentials, skills };
}

// A template is done once a Work Event started from it has a Holistic Call of
// Meets spec or better — the same test as a Shop Ready template prereq.
const templateDone = (programId, studentId, code) => !!db.prepare(`
    SELECT 1 FROM wbl_work_events we
    JOIN wbl_work_event_participants wp ON wp.work_event_id = we.id
    JOIN wbl_holistic_calls hc ON hc.participant_id = wp.id
    JOIN wbl_holistic_tiers ht ON ht.tier = hc.tier
    WHERE we.program_id = ? AND we.template_code = ? AND wp.student_id = ?
      AND ht.rank >= (SELECT rank FROM wbl_holistic_tiers WHERE tier = 'meets')
`).get(programId, code, studentId);

const machineCodes = t => String(t.uses_machines || '').split(',').map(s => s.trim()).filter(Boolean);

// The student's lane and single next step, in the handoff's order:
//   1. a live job they're on;
//   then anything they've already started (a practical, project or module);
//   in Phase 1, the next onboarding template not yet done;
//   2. a station practical with an unsatisfied skill whose machines are all
//      available and whose other gated machines they're cleared on;
//   3. the next library project or business module with an unsatisfied skill.
function today(programId, studentId) {
    const phase = L.effectivePhase(programId, studentId);
    const roles = listRoles(programId);
    const roleLabel = text => parseRoles(text).map(c => roles.find(r => r.code === c)?.label || c).join(' + ');
    const { credentials, skills } = studentProgress(programId, studentId);
    const templates = listTemplates(programId);
    const tplByCode = new Map(templates.map(t => [t.code, t]));
    const machines = new Map(G.listMachines(programId).map(m => [m.code, m]));
    const unsatisfied = t => t.skills.filter(s => !skills.get(s.skill_id)?.satisfied)
        .map(s => ({ skill_id: s.skill_id, name: s.name, demos: skills.get(s.skill_id)?.demos ?? 0, required: skills.get(s.skill_id)?.required ?? null }));
    const suggest = (lane, t, why) => ({
        lane, type: 'template', template_id: t.id, code: t.code, title: t.title, kind: t.kind,
        brief_url: t.brief_url || '', onboarding: !!t.onboarding, skills: unsatisfied(t), why,
    });

    const active = db.prepare(`
        SELECT wp.id AS participant_id, wp.role, we.id AS work_event_id, we.title, we.kind, we.template_code,
               we.closed_on, we.packet_json, we.external_ref
        FROM wbl_work_event_participants wp JOIN wbl_work_events we ON we.id = wp.work_event_id
        WHERE we.program_id = ? AND wp.student_id = ? AND we.status = 'active' AND wp.left_on IS NULL
        ORDER BY we.opened_on, we.id
    `).all(programId, studentId);

    let step = null;
    const job = active.find(a => a.kind === 'job');
    const started = active.find(a => a.kind !== 'job');
    if (job) {
        const packet = parsePacket(job.packet_json);
        step = {
            lane: 1, type: 'job', work_event_id: job.work_event_id, title: job.title, job_number: job.external_ref || '',
            role: roleLabel(job.role), due_date: packet?.order?.due_date || job.closed_on || null,
            packet_url: packet?.files?.drive_folder_url || '',
            machines: G.participantMachines(job.participant_id).map(m => m.label || m.machine_code),
        };
    } else if (started) {
        const t = tplByCode.get(started.template_code);
        step = {
            lane: started.kind === 'practical' ? 2 : 3, type: 'in_progress', work_event_id: started.work_event_id,
            title: started.title, kind: started.kind, brief_url: t?.brief_url || '',
        };
    }
    if (!step && phase === 1) {
        const t = templates.filter(x => x.onboarding).find(x => !templateDone(programId, studentId, x.code));
        if (t) step = suggest(3, t, 'Onboarding — finish this before open shop.');
    }
    if (!step) {
        const byOrder = templates.slice().sort((a, b) => a.order_idx - b.order_idx);
        for (const t of byOrder.filter(x => x.kind === 'practical')) {
            if (!unsatisfied(t).length) continue;
            const uses = machineCodes(t).filter(c => machines.has(c));
            if (uses.some(c => machines.get(c).status !== 'available')) continue;
            const needsGate = uses.filter(c => machines.get(c).gate_template_code && c !== t.gate_machine_code);
            if (needsGate.some(c => !G.isCleared(programId, studentId, c))) continue;
            step = suggest(2, t, uses.length
                ? `${uses.map(c => machines.get(c).label).join(', ')} ${uses.length > 1 ? 'are' : 'is'} free.`
                : 'No machine needed.');
            break;
        }
        if (!step) {
            const t = byOrder.filter(x => x.kind === 'project' || x.kind === 'module').find(x => unsatisfied(x).length);
            if (t) step = suggest(3, t, t.kind === 'module' ? 'Business module.' : 'Library project.');
        }
    }

    return {
        phase, step,
        // A program with no templates or machines isn't run as an open shop;
        // the student page shows the Today card only when this is set.
        open_shop: templates.length > 0 || machines.size > 0,
        jobs: active.filter(a => a.kind === 'job').length,
        credentials,
        stations: [...machines.values()].map(m => ({ code: m.code, label: m.label, status: m.status, note: m.note })),
        pace: pace(programId, studentId),
    };
}

// ---------------------------------------------------------------------------
// Pacing floor
// ---------------------------------------------------------------------------

// The floor is [{ week, milestone, shop_ready?, credentials_min?, required?,
// one_of? }], seeded from the curriculum file. A milestone is due by the end
// of its week, so a student is below the floor from the week after.
function pacingConfig(programId) {
    const p = db.prepare('SELECT term_start, pacing_floor_json FROM wbl_programs WHERE id = ?').get(programId);
    let floor = [];
    try { floor = JSON.parse(p?.pacing_floor_json || '[]'); } catch { /* bad JSON reads as no floor */ }
    return { term_start: p?.term_start || null, floor: Array.isArray(floor) ? floor : [] };
}

function weekOf(termStart, date) {
    if (!L.isDate(termStart) || !L.isDate(date)) return null;
    const days = Math.floor((Date.parse(date + 'T00:00:00Z') - Date.parse(termStart + 'T00:00:00Z')) / 86400000);
    return days < 0 ? 0 : Math.floor(days / 7) + 1;
}

function milestoneMet(m, { shopReady, names }) {
    const lower = new Set(names.map(n => n.toLowerCase()));
    if (m.shop_ready && !shopReady) return false;
    if (m.credentials_min && names.length < m.credentials_min) return false;
    if (Array.isArray(m.required) && m.required.some(n => !lower.has(String(n).toLowerCase()))) return false;
    if (Array.isArray(m.one_of) && m.one_of.length && !m.one_of.some(n => lower.has(String(n).toLowerCase()))) return false;
    return true;
}

// null when the program has no term start or no floor.
function pace(programId, studentId, date = L.today(), config = pacingConfig(programId)) {
    if (!config.term_start || !config.floor.length) return null;
    const week = weekOf(config.term_start, date);
    const state = {
        shopReady: L.effectivePhase(programId, studentId) === 2 || L.phase2Status(programId, studentId).ready,
        names: awardedNames(programId, studentId),
    };
    const missing = config.floor.filter(m => week > m.week && !milestoneMet(m, state)).map(m => m.milestone);
    const next = config.floor.find(m => week <= m.week);
    return {
        week, below: missing.length > 0, missing, credentials: state.names.length,
        next: next ? { week: next.week, milestone: next.milestone, met: milestoneMet(next, state) } : null,
    };
}

// ---------------------------------------------------------------------------
// Credential coverage
// ---------------------------------------------------------------------------

// Per credential and skill, how many active students have 0, 1 and 2+
// qualifying demonstrations — where the shop is thin.
function coverage(programId) {
    const students = db.prepare(`SELECT student_id FROM wbl_program_enrollments WHERE program_id = ? AND exited_on IS NULL`)
        .all(programId).map(r => r.student_id);
    const nameOf = db.prepare('SELECT name FROM wbl_skill_versions WHERE skill_id = ? AND is_current = 1');
    return programCredentials(programId).map(c => {
        const rows = new Map();
        let awarded = 0;
        for (const sid of students) {
            const prog = L.credentialProgress(c.id, programId, sid);
            if (prog.satisfied) awarded++;
            for (const s of prog.skills) {
                if (!rows.has(s.skill_id)) {
                    rows.set(s.skill_id, { skill_id: s.skill_id, name: nameOf.get(s.skill_id)?.name ?? '', required: s.required, zero: 0, one: 0, two_plus: 0 });
                }
                const r = rows.get(s.skill_id);
                if (s.demos === 0) r.zero++; else if (s.demos === 1) r.one++; else r.two_plus++;
            }
        }
        return { credential_id: c.id, name: c.name, students: students.length, satisfied: awarded, skills: [...rows.values()] };
    });
}

module.exports = { studentProgress, templateDone, today, pacingConfig, weekOf, milestoneMet, pace, coverage };
