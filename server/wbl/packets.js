// Job packet import — the CGL handoff §7. The CGL website exports a job packet
// (format: .refs/cgl/job-packet.schema.md) and importing it creates the
// kind='job' Work Event in one step. Idempotent on job_number, which is
// stored as external_ref: a re-import updates the event's title, house flag
// and packet, and adds any newly suggested skills, but never touches its
// participants, status or dates.
//
// Shared by the routes and the tests.

const { db } = require('../db');
const L = require('./logic');
const { resolveSkill } = require('./templates');
const { machineExists } = require('./gates');
const { listRoles } = require('./roles');

const METHODS = ['screen', 'dtf', 'embroidery', 'solvent'];
const FILE_KEYS = ['drive_folder_url', 'approved_art_url', 'proof_url', 'stitch_file_url'];

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = v => (v == null ? '' : String(v).trim());

// Checks a parsed packet. Errors refuse the import; warnings (an unknown
// method, role or machine, a skill that doesn't resolve) are reported and the
// import goes ahead, since the CGL website may run ahead of this program.
function validatePacket(programId, packet) {
    const errors = [], warnings = [];
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return { errors: ['packet must be a JSON object'], warnings };
    const jobNumber = text(packet.job_number);
    if (!jobNumber) errors.push('job_number required');
    else if (jobNumber.length > 64) errors.push('job_number too long');

    const order = obj(packet.order), process = obj(packet.process), assessment = obj(packet.assessment);
    if (text(order.due_date) && !L.isDate(text(order.due_date))) errors.push('order.due_date must be YYYY-MM-DD');
    if (packet.order?.quantities != null && !Array.isArray(packet.order.quantities)) errors.push('order.quantities must be an array');
    if (packet.placement != null && !Array.isArray(packet.placement)) errors.push('placement must be an array');
    // The Drive links are rendered as links, so only web links are accepted.
    for (const k of FILE_KEYS) {
        const u = text(obj(packet.files)[k]);
        if (u && !/^https?:\/\//i.test(u)) errors.push(`files.${k} must start with http:// or https://`);
    }
    if (text(process.method) && !METHODS.includes(text(process.method))) {
        warnings.push(`process.method "${text(process.method)}" is not one of ${METHODS.join(', ')}`);
    }
    const roleCodes = listRoles(programId).map(r => r.code);
    for (const r of Array.isArray(assessment.roles_needed) ? assessment.roles_needed : []) {
        if (roleCodes.length && !roleCodes.includes(text(r))) warnings.push(`unknown role: ${text(r)}`);
    }
    for (const m of Array.isArray(assessment.machines) ? assessment.machines : []) {
        if (!machineExists(programId, text(m))) warnings.push(`unknown machine: ${text(m)}`);
    }
    return { errors, warnings };
}

// "Acme Band · 12 navy Gildan 5000" — the customer plus a short product
// description; a house job without a customer reads "House job".
function packetTitle(packet) {
    const order = obj(packet.order), product = obj(packet.product);
    const qty = (Array.isArray(order.quantities) ? order.quantities : []).reduce((n, q) => n + (Number(q?.qty) || 0), 0);
    const what = [qty || '', text(product.color), text(product.brand_style) || text(product.type)].filter(Boolean).join(' ');
    const who = text(order.customer) || (packet.is_house ? 'House job' : text(packet.job_number));
    return what ? `${who} · ${what}` : who;
}

// Creates or updates the job from a packet. Runs its own transaction.
// Returns { id, created, warnings, unresolved } or throws { status: 400, errors }.
function importPacket(programId, packet) {
    const { errors, warnings } = validatePacket(programId, packet);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400, errors });

    const jobNumber = text(packet.job_number);
    const suggested = obj(packet.assessment).suggested_skills;
    const skillIds = [], unresolved = [];
    for (const s of Array.isArray(suggested) ? suggested : []) {
        const id = resolveSkill(programId, text(s?.credential), text(s?.skill));
        if (id) { if (!skillIds.includes(id)) skillIds.push(id); }
        else unresolved.push(`${text(s?.credential)} / ${text(s?.skill)}`);
    }
    const title = packetTitle(packet);
    const json = JSON.stringify(packet);
    const isHouse = packet.is_house ? 1 : 0;
    const now = Date.now();

    db.exec('BEGIN');
    try {
        const existing = db.prepare(`SELECT id FROM wbl_work_events WHERE program_id = ? AND external_ref = ? AND kind = 'job'
                                     ORDER BY id LIMIT 1`).get(programId, jobNumber);
        let id;
        if (existing) {
            id = existing.id;
            db.prepare('UPDATE wbl_work_events SET title = ?, is_house = ?, packet_json = ?, updated_at = ? WHERE id = ?')
                .run(title, isHouse, json, now, id);
        } else {
            id = Number(db.prepare(`
                INSERT INTO wbl_work_events(program_id, title, external_ref, description, kind, is_house, packet_json,
                                            opened_on, created_at, updated_at)
                VALUES(?, ?, ?, '', 'job', ?, ?, ?, ?, ?)
            `).run(programId, title, jobNumber, isHouse, json, L.today(), now, now).lastInsertRowid);
        }
        // Planned skills are advisory and the teacher may have added some, so
        // a re-import only adds.
        const ins = db.prepare('INSERT OR IGNORE INTO wbl_work_event_skills(work_event_id, skill_id) VALUES(?, ?)');
        for (const sid of skillIds) ins.run(id, sid);
        db.exec('COMMIT');
        return { id, created: !existing, title, warnings, unresolved };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const parsePacket = (json) => { try { return json ? JSON.parse(json) : null; } catch { return null; } };

module.exports = { METHODS, validatePacket, packetTitle, importPacket, parsePacket };
