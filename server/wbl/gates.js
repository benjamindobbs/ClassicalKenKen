// Machines and gate clearances — the CGL handoff §5. A gate practical (e.g.
// SS-P3) clears a student to run one machine solo on live jobs. Clearing is
// always an explicit teacher action, never automatic; revoking keeps the row
// (it's a safety record) and every change is appended to
// wbl_gate_clearance_events. Assigning an uncleared machine on a job is a
// warning the teacher overrides with a note, not a block.
//
// Shared by the routes, tools/seed-cgl-templates.js and the tests.

const { db } = require('../db');

const MACHINE_STATUSES = ['available', 'in_use', 'down'];

// Upserts machines by code from a curriculum file ({code, label, gate, note}).
// The file owns label and gate; status and note are the teacher's once the
// row exists, so a re-seed never marks a machine back to available.
function seedMachines(programId, machines) {
    const report = { created: [], updated: [], unchanged: [] };
    const find = db.prepare('SELECT * FROM wbl_machines WHERE program_id = ? AND code = ?');
    machines.forEach((m, i) => {
        const fields = { label: m.label, gate_template_code: m.gate || null, order_idx: i };
        const row = find.get(programId, m.code);
        if (!row) {
            db.prepare(`INSERT INTO wbl_machines(program_id, code, label, gate_template_code, note, order_idx, created_at)
                        VALUES(?, ?, ?, ?, ?, ?, ?)`)
                .run(programId, m.code, fields.label, fields.gate_template_code, m.note || '', i, Date.now());
            report.created.push(m.code);
            return;
        }
        const changed = Object.keys(fields).filter(k => row[k] !== fields[k]);
        if (changed.length) {
            db.prepare(`UPDATE wbl_machines SET ${changed.map(k => `${k} = ?`).join(', ')}, archived_at = NULL WHERE id = ?`)
                .run(...changed.map(k => fields[k]), row.id);
        }
        (changed.length ? report.updated : report.unchanged).push(m.code);
    });
    return report;
}

const listMachines = (programId) => db.prepare(`
    SELECT * FROM wbl_machines WHERE program_id = ? AND archived_at IS NULL ORDER BY order_idx, label
`).all(programId);

const machineExists = (programId, code) =>
    !!db.prepare('SELECT 1 FROM wbl_machines WHERE program_id = ? AND code = ? AND archived_at IS NULL').get(programId, code);

// Live (unrevoked) clearances, keyed by student when studentId is omitted.
function clearances(programId, studentId = null) {
    return db.prepare(`
        SELECT g.*, m.label FROM wbl_gate_clearances g
        LEFT JOIN wbl_machines m ON m.program_id = g.program_id AND m.code = g.machine_code
        WHERE g.program_id = ? AND g.revoked_at IS NULL ${studentId ? 'AND g.student_id = ?' : ''}
        ORDER BY m.order_idx, g.machine_code
    `).all(...(studentId ? [programId, studentId] : [programId]));
}

const isCleared = (programId, studentId, code) => !!db.prepare(`
    SELECT 1 FROM wbl_gate_clearances
    WHERE program_id = ? AND student_id = ? AND machine_code = ? AND revoked_at IS NULL
`).get(programId, studentId, code);

const logEvent = (programId, studentId, code, action, workEventId, by, note) => db.prepare(`
    INSERT INTO wbl_gate_clearance_events(program_id, student_id, machine_code, action, work_event_id, by_teacher, at, note)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
`).run(programId, studentId, code, action, workEventId ?? null, by, Date.now(), note || '');

// Clears (or re-clears after a revoke) in place. Clearing an already-cleared
// machine is a no-op that returns the existing row, so a double click can't
// rewrite who cleared it or when.
function clearGate(programId, studentId, code, { workEventId = null, by, note = '' }) {
    if (!machineExists(programId, code)) throw new Error('unknown_machine:' + code);
    const row = db.prepare('SELECT * FROM wbl_gate_clearances WHERE program_id = ? AND student_id = ? AND machine_code = ?')
        .get(programId, studentId, code);
    if (row && row.revoked_at === null) return { already: true, clearance: row };
    const at = Date.now();
    if (row) {
        db.prepare(`UPDATE wbl_gate_clearances
                    SET work_event_id = ?, cleared_by = ?, cleared_at = ?, note = ?, revoked_at = NULL, revoked_by = NULL, revoke_note = NULL
                    WHERE id = ?`).run(workEventId, by, at, note, row.id);
    } else {
        db.prepare(`INSERT INTO wbl_gate_clearances(program_id, student_id, machine_code, work_event_id, cleared_by, cleared_at, note)
                    VALUES(?, ?, ?, ?, ?, ?, ?)`).run(programId, studentId, code, workEventId, by, at, note);
    }
    logEvent(programId, studentId, code, 'cleared', workEventId, by, note);
    return { already: false, clearance: db.prepare('SELECT * FROM wbl_gate_clearances WHERE program_id = ? AND student_id = ? AND machine_code = ?').get(programId, studentId, code) };
}

// A revoke needs a reason; it's the record of why a student lost solo use.
function revokeGate(programId, studentId, code, { by, note }) {
    if (!note) throw new Error('note_required');
    const info = db.prepare(`
        UPDATE wbl_gate_clearances SET revoked_at = ?, revoked_by = ?, revoke_note = ?
        WHERE program_id = ? AND student_id = ? AND machine_code = ? AND revoked_at IS NULL
    `).run(Date.now(), by, note, programId, studentId, code);
    if (!info.changes) return false;
    logEvent(programId, studentId, code, 'revoked', null, by, note);
    return true;
}

const history = (programId, studentId) => db.prepare(`
    SELECT e.*, m.label FROM wbl_gate_clearance_events e
    LEFT JOIN wbl_machines m ON m.program_id = e.program_id AND m.code = e.machine_code
    WHERE e.program_id = ? AND e.student_id = ? ORDER BY e.at DESC, e.id DESC
`).all(programId, studentId);

// Which of these students lack a clearance for which of these machines.
// Returns [{ student_id, machines: [code…] }] for students with any gap.
function unclearedFor(programId, studentIds, codes) {
    return studentIds
        .map(sid => ({ student_id: sid, machines: codes.filter(c => !isCleared(programId, sid, c)) }))
        .filter(r => r.machines.length);
}

// Replaces a participant's machines. Only a job is checked: on a practical the
// student is being taught the machine. Uncleared machines on a job need
// overrideNote, else nothing is written and { needs_override } comes back.
// The note is stored on each uncleared row; cleared rows carry none.
function setParticipantMachines(participant, codes, { kind, overrideNote = '', by }) {
    const unique = [...new Set(codes)];
    for (const c of unique) if (!machineExists(participant.program_id, c)) throw new Error('unknown_machine:' + c);
    // Machines already on the participant keep their row (and any override
    // already given), so only newly added uncleared machines need a note.
    const prior = new Map(db.prepare('SELECT * FROM wbl_participant_machines WHERE participant_id = ?')
        .all(participant.id).map(r => [r.machine_code, r]));
    const gaps = kind === 'job'
        ? unique.filter(c => !prior.has(c) && !isCleared(participant.program_id, participant.student_id, c))
        : [];
    if (gaps.length && !overrideNote) return { needs_override: gaps };

    db.prepare('DELETE FROM wbl_participant_machines WHERE participant_id = ?').run(participant.id);
    const ins = db.prepare(`INSERT INTO wbl_participant_machines(participant_id, machine_code, cleared, override_note, override_by, assigned_at)
                            VALUES(?, ?, ?, ?, ?, ?)`);
    for (const c of unique) {
        const old = prior.get(c);
        if (old) ins.run(participant.id, c, old.cleared, old.override_note, old.override_by, old.assigned_at);
        else if (gaps.includes(c)) ins.run(participant.id, c, 0, overrideNote, by, Date.now());
        else ins.run(participant.id, c, 1, '', '', Date.now());
    }
    return { ok: true, overridden: gaps };
}

const participantMachines = (participantId) => db.prepare(`
    SELECT pm.*, m.label, m.status FROM wbl_participant_machines pm
    JOIN wbl_work_event_participants wp ON wp.id = pm.participant_id
    JOIN wbl_work_events we ON we.id = wp.work_event_id
    LEFT JOIN wbl_machines m ON m.program_id = we.program_id AND m.code = pm.machine_code
    WHERE pm.participant_id = ? ORDER BY m.order_idx, pm.machine_code
`).all(participantId);

module.exports = {
    MACHINE_STATUSES, seedMachines, listMachines, machineExists,
    clearances, isCleared, clearGate, revokeGate, history,
    unclearedFor, setParticipantMachines, participantMachines,
};
