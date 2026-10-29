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
// The CGL request form's standard picks (v1.1); anything else must read
// "Other: <what the requester typed>".
const LOCATIONS = ['Full Chest', 'Full Back', 'Front Pocket', 'Sleeve'];
const GARMENT_TYPES = ['Tee-Shirt', 'Long Sleeve Tee', 'Crew Neck', 'Pull Over', 'Full Zip', 'Polo'];
const SIZES = ['YS', 'YM', 'YL', 'YXL', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
// Colors per design location: the screen presses are 4-color, the embroidery
// machine has 15 needles. Other methods have no limit here.
const MAX_COLORS = { screen: 4, embroidery: 15 };
const standardOrOther = (v, list) => list.includes(v) || /^Other:\s*\S/.test(v);
// A color count is a whole number from 1 to the method's limit, or "not_sure".
const colorsOk = (v, max = Infinity) => v == null || v === 'not_sure' || (Number.isInteger(v) && v >= 1 && v <= max);
const isWeb = u => /^https?:\/\//i.test(u);

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
    const product = obj(packet.product);
    if (text(order.due_date) && !L.isDate(text(order.due_date))) errors.push('order.due_date must be YYYY-MM-DD');
    // Quantities are by size ({size, qty}) or one total ({qty}, no size).
    if (packet.order?.quantities != null && !Array.isArray(packet.order.quantities)) errors.push('order.quantities must be an array');
    (Array.isArray(order.quantities) ? order.quantities : []).forEach((q, i) => {
        if (!Number.isInteger(q?.qty) || q.qty < 1) errors.push(`order.quantities[${i}].qty must be a whole number of at least 1`);
        if (text(q?.size) && !SIZES.includes(text(q.size))) warnings.push(`order.quantities[${i}].size "${text(q.size)}" is not one of ${SIZES.join(', ')}`);
    });
    const maxColors = MAX_COLORS[text(process.method)] ?? Infinity;
    const colorsRule = Number.isFinite(maxColors) ? `1 to ${maxColors} for ${text(process.method)}` : 'a whole number of at least 1';
    if (packet.placement != null && !Array.isArray(packet.placement)) errors.push('placement must be an array');
    (Array.isArray(packet.placement) ? packet.placement : []).forEach((pl, i) => {
        if (!pl || typeof pl !== 'object' || Array.isArray(pl)) return errors.push(`placement[${i}] must be an object`);
        if (!colorsOk(pl.colors, maxColors)) errors.push(`placement[${i}].colors must be ${colorsRule}, or "not_sure"`);
        if (text(pl.location) && !standardOrOther(text(pl.location), LOCATIONS)) {
            warnings.push(`placement[${i}].location "${text(pl.location)}" is not one of ${LOCATIONS.join(', ')} or "Other: …"`);
        }
    });
    if (!colorsOk(process.colors, maxColors)) errors.push(`process.colors must be ${colorsRule}, or "not_sure"`);
    if (text(product.garment_type) && !standardOrOther(text(product.garment_type), GARMENT_TYPES)) {
        warnings.push(`product.garment_type "${text(product.garment_type)}" is not one of ${GARMENT_TYPES.join(', ')} or "Other: …"`);
    }
    // These are rendered as links, so only web links are accepted.
    for (const k of FILE_KEYS) {
        const u = text(obj(packet.files)[k]);
        if (u && !isWeb(u)) errors.push(`files.${k} must start with http:// or https://`);
    }
    if (text(product.blank_url) && !isWeb(text(product.blank_url))) errors.push('product.blank_url must start with http:// or https://');
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

// "Acme Band · 12 Navy Gildan 5000" — the customer plus a short product
// description (the blank's model, else the garment type); a house job
// without a customer reads "House job".
function packetTitle(packet) {
    const order = obj(packet.order), product = obj(packet.product);
    const qty = (Array.isArray(order.quantities) ? order.quantities : []).reduce((n, q) => n + (Number(q?.qty) || 0), 0);
    const item = text(product.brand_style) || text(product.garment_type).replace(/^Other:\s*/, '') || text(product.type);
    const what = [qty || '', text(product.color), item].filter(Boolean).join(' ');
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

module.exports = { METHODS, LOCATIONS, GARMENT_TYPES, SIZES, MAX_COLORS, validatePacket, packetTitle, importPacket, parsePacket };
