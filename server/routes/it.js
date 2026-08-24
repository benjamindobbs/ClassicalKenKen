const { Router }      = require('express');
const { requireAuth } = require('../auth');
const { db }          = require('../db');

const router = Router();
router.use(requireAuth);

const ADMIN_EMAILS = new Set(
    (process.env.IT_ADMIN_EMAILS || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
);

function getUserEmail(userKey) {
    const row = db.prepare('SELECT email FROM users WHERE user_key = ?').get(userKey);
    return row ? row.email.toLowerCase() : null;
}

// Any signed-in @hartfordschools.org account. Assumes requireAuth already ran.
function requireItStaff(req, res, next) {
    const email = getUserEmail(req.userKey);
    if (!email || !email.endsWith('@hartfordschools.org')) {
        return res.status(403).json({ error: 'Staff account required' });
    }
    req.userEmail = email;
    next();
}

// Staff account AND membership in the IT_ADMIN_EMAILS allowlist.
function requireItAdmin(req, res, next) {
    requireItStaff(req, res, () => {
        if (process.env.DEV_IT_ADMIN) return next();
        if (!ADMIN_EMAILS.has(req.userEmail)) {
            return res.status(403).json({ error: 'IT admin access required' });
        }
        next();
    });
}

router.get('/me', (req, res) => {
    const email   = getUserEmail(req.userKey) || '';
    const isStaff = email.endsWith('@hartfordschools.org');
    const isAdmin = !!process.env.DEV_IT_ADMIN || (isStaff && ADMIN_EMAILS.has(email));
    res.json({ userKey: req.userKey, email, isStaff, isAdmin });
});

// ── Roster ───────────────────────────────────────────────────────────────

router.post('/roster/students/import-csv', requireItAdmin, (req, res) => {
    const { rows } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

    const upsert = db.prepare(`
        INSERT INTO it_students(student_id, first_name, last_name, grade_level, advisor_name)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(student_id) DO UPDATE SET
            first_name = excluded.first_name, last_name = excluded.last_name,
            grade_level = excluded.grade_level, advisor_name = excluded.advisor_name
    `);
    let imported = 0;
    for (const r of rows) {
        if (!r.student_id || !r.first_name || !r.last_name) continue;
        upsert.run(
            String(r.student_id).trim(), String(r.first_name).trim(), String(r.last_name).trim(),
            r.grade_level ? String(r.grade_level).trim() : null,
            r.advisor_name ? String(r.advisor_name).trim() : null
        );
        imported++;
    }
    res.json({ imported });
});

router.post('/roster/staff/import-csv', requireItAdmin, (req, res) => {
    const { rows } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

    const upsert = db.prepare(`
        INSERT INTO it_staff(staff_number, first_name, last_name, email)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(staff_number) DO UPDATE SET
            first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email
    `);
    let imported = 0;
    for (const r of rows) {
        if (!r.staff_number || !r.first_name || !r.last_name) continue;
        upsert.run(
            String(r.staff_number).trim(), String(r.first_name).trim(), String(r.last_name).trim(),
            r.email ? String(r.email).trim().toLowerCase() : null
        );
        imported++;
    }
    res.json({ imported });
});

// GET /roster/lookup?type=student|staff&id=  — name-confirmation lookup used by
// the missing/found tool and the ticket form's "someone else" device-owner flow.
router.get('/roster/lookup', (req, res) => {
    const { type, id } = req.query;
    if ((type !== 'student' && type !== 'staff') || !id) {
        return res.status(400).json({ error: 'type (student|staff) and id required' });
    }
    const row = type === 'student'
        ? db.prepare('SELECT first_name, last_name FROM it_students WHERE student_id = ?').get(String(id).trim())
        : db.prepare('SELECT first_name, last_name FROM it_staff WHERE staff_number = ?').get(String(id).trim());
    if (!row) return res.json({ found: false });
    res.json({ found: true, name: `${row.first_name} ${row.last_name}` });
});

router.get('/roster/students', requireItAdmin, (_req, res) => {
    res.json({ students: db.prepare('SELECT * FROM it_students ORDER BY last_name, first_name').all() });
});

router.get('/roster/staff', requireItAdmin, (_req, res) => {
    res.json({ staff: db.prepare('SELECT * FROM it_staff ORDER BY last_name, first_name').all() });
});

router.patch('/roster/students/:id', requireItAdmin, (req, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT student_id FROM it_students WHERE student_id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { first_name, last_name, grade_level, advisor_name } = req.body;
    if (!first_name || !String(first_name).trim()) return res.status(400).json({ error: 'first_name required' });
    if (!last_name || !String(last_name).trim()) return res.status(400).json({ error: 'last_name required' });

    db.prepare(`
        UPDATE it_students SET first_name = ?, last_name = ?, grade_level = ?, advisor_name = ?
        WHERE student_id = ?
    `).run(
        String(first_name).trim(), String(last_name).trim(),
        grade_level ? String(grade_level).trim() : null,
        advisor_name ? String(advisor_name).trim() : null,
        id
    );
    res.json({ ok: true });
});

router.patch('/roster/staff/:id', requireItAdmin, (req, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT staff_number FROM it_staff WHERE staff_number = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { first_name, last_name, email } = req.body;
    if (!first_name || !String(first_name).trim()) return res.status(400).json({ error: 'first_name required' });
    if (!last_name || !String(last_name).trim()) return res.status(400).json({ error: 'last_name required' });

    db.prepare(`
        UPDATE it_staff SET first_name = ?, last_name = ?, email = ?
        WHERE staff_number = ?
    `).run(
        String(first_name).trim(), String(last_name).trim(),
        email ? String(email).trim().toLowerCase() : null,
        id
    );
    res.json({ ok: true });
});

router.post('/roster/students/bulk-delete', requireItAdmin, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const del = db.prepare('DELETE FROM it_students WHERE student_id = ?');
    let deleted = 0;
    for (const id of ids) deleted += del.run(String(id)).changes;
    res.json({ deleted });
});

router.post('/roster/staff/bulk-delete', requireItAdmin, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const del = db.prepare('DELETE FROM it_staff WHERE staff_number = ?');
    let deleted = 0;
    for (const id of ids) deleted += del.run(String(id)).changes;
    res.json({ deleted });
});

// ── Assets ───────────────────────────────────────────────────────────────

const ASSET_LIST_SQL = `
    SELECT a.*,
           COALESCE(s.first_name, st.first_name) AS person_first_name,
           COALESCE(s.last_name, st.last_name)   AS person_last_name,
           s.grade_level  AS grade_level,
           s.advisor_name AS advisor_name
    FROM it_assets a
    LEFT JOIN it_students s  ON a.assigned_type = 'student' AND a.assigned_student_id = s.student_id
    LEFT JOIN it_staff st    ON a.assigned_type = 'staff'   AND a.assigned_staff_number = st.staff_number
`;
const ASSET_ORDER_SQL = `
    ORDER BY CASE WHEN a.assigned_type = 'cart' THEN a.assigned_cart_name ELSE COALESCE(s.last_name, st.last_name) END,
             CASE WHEN a.assigned_type = 'cart' THEN a.assigned_cart_name ELSE COALESCE(s.first_name, st.first_name) END
`;

router.get('/assets', requireItStaff, (_req, res) => {
    res.json({ assets: db.prepare(ASSET_LIST_SQL + ASSET_ORDER_SQL).all() });
});

router.get('/assets/needs-attention', requireItStaff, (_req, res) => {
    const rows = db.prepare(`
        ${ASSET_LIST_SQL}
        WHERE a.device_status != 'working'
        ${ASSET_ORDER_SQL}
    `).all();
    const activeTicket = db.prepare(`
        SELECT id FROM it_tickets
        WHERE linked_asset_id = ? AND status != 'Completed'
        ORDER BY created_at DESC LIMIT 1
    `);
    res.json({ assets: rows.map(a => ({ ...a, active_ticket_id: activeTicket.get(a.id)?.id ?? null })) });
});

// Assets assigned to the signed-in user themself — for the ticket form's "Device Owner: Myself"
// option. Students resolve via the digit-prefix of their school email; staff resolve via the
// optional email column on the roster (see it_staff.email).
router.get('/assets/mine', (req, res) => {
    const email = getUserEmail(req.userKey);
    if (!email) return res.json({ assets: [] });

    if (email.endsWith('@hartfordschools.org')) {
        const staff = db.prepare('SELECT staff_number FROM it_staff WHERE email = ?').get(email);
        if (!staff) return res.json({ assets: [] });
        return res.json({ assets: db.prepare(
            'SELECT id, serial_number, asset_number FROM it_assets WHERE assigned_type = ? AND assigned_staff_number = ?'
        ).all('staff', staff.staff_number) });
    }

    const studentId = (req.userKey.match(/^\d+/) || [])[0];
    if (!studentId) return res.json({ assets: [] });
    res.json({ assets: db.prepare(
        'SELECT id, serial_number, asset_number FROM it_assets WHERE assigned_type = ? AND assigned_student_id = ?'
    ).all('student', studentId) });
});

// Assets assigned to a given student/staff person — powers the ticket form's device picker.
router.get('/assets/by-owner', (req, res) => {
    const { type, id } = req.query;
    if ((type !== 'student' && type !== 'staff') || !id) {
        return res.status(400).json({ error: 'type (student|staff) and id required' });
    }
    const rows = type === 'student'
        ? db.prepare('SELECT id, serial_number, asset_number FROM it_assets WHERE assigned_type = ? AND assigned_student_id = ?').all('student', String(id).trim())
        : db.prepare('SELECT id, serial_number, asset_number FROM it_assets WHERE assigned_type = ? AND assigned_staff_number = ?').all('staff', String(id).trim());
    res.json({ assets: rows });
});

const DEVICE_STATUSES = new Set(['working', 'missing', 'locked', 'in shop']);
const REPAIR_STATUSES = new Set(['not started', 'in progress', 'complete']);

// Maps the client's {assigned_type, assigned_id} pair onto the three mutually-exclusive columns.
function resolveAssignment(assigned_type, assigned_id) {
    const id = assigned_id ? String(assigned_id).trim() : null;
    if (assigned_type === 'student') return { assigned_type, assigned_student_id: id, assigned_staff_number: null, assigned_cart_name: null };
    if (assigned_type === 'staff')   return { assigned_type, assigned_student_id: null, assigned_staff_number: id, assigned_cart_name: null };
    if (assigned_type === 'cart')    return { assigned_type, assigned_student_id: null, assigned_staff_number: null, assigned_cart_name: id };
    return { assigned_type: null, assigned_student_id: null, assigned_staff_number: null, assigned_cart_name: null };
}

router.post('/assets', requireItAdmin, (req, res) => {
    const { serial_number, asset_number, assigned_type, assigned_id, device_status, repair_status } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'serial_number required' });
    if (device_status && !DEVICE_STATUSES.has(device_status)) return res.status(400).json({ error: 'invalid device_status' });
    if (repair_status && !REPAIR_STATUSES.has(repair_status)) return res.status(400).json({ error: 'invalid repair_status' });

    const a   = resolveAssignment(assigned_type, assigned_id);
    const now = Date.now();
    try {
        const result = db.prepare(`
            INSERT INTO it_assets(serial_number, asset_number, assigned_type, assigned_student_id, assigned_staff_number, assigned_cart_name, device_status, repair_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(serial_number).trim(), asset_number ? String(asset_number).trim() : null,
            a.assigned_type, a.assigned_student_id, a.assigned_staff_number, a.assigned_cart_name,
            device_status || 'working', repair_status || null, now, now
        );
        res.json({ id: result.lastInsertRowid });
    } catch {
        res.status(400).json({ error: 'serial_number already exists' });
    }
});

router.post('/assets/import-csv', requireItAdmin, (req, res) => {
    const { rows } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });

    const upsert = db.prepare(`
        INSERT INTO it_assets(serial_number, asset_number, assigned_type, assigned_student_id, assigned_staff_number, assigned_cart_name, device_status, repair_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(serial_number) DO UPDATE SET
            asset_number = excluded.asset_number, assigned_type = excluded.assigned_type,
            assigned_student_id = excluded.assigned_student_id, assigned_staff_number = excluded.assigned_staff_number,
            assigned_cart_name = excluded.assigned_cart_name, device_status = excluded.device_status,
            repair_status = excluded.repair_status, updated_at = excluded.updated_at
    `);
    const now = Date.now();
    let imported = 0;
    for (const r of rows) {
        if (!r.serial_number) continue;
        const deviceStatus = DEVICE_STATUSES.has(r.device_status) ? r.device_status : 'working';
        const repairStatus = REPAIR_STATUSES.has(r.repair_status) ? r.repair_status : null;
        const a = resolveAssignment(r.assigned_type, r.assigned_id);
        upsert.run(
            String(r.serial_number).trim(), r.asset_number ? String(r.asset_number).trim() : null,
            a.assigned_type, a.assigned_student_id, a.assigned_staff_number, a.assigned_cart_name,
            deviceStatus, repairStatus, now, now
        );
        imported++;
    }
    res.json({ imported });
});

router.patch('/assets/:id', requireItAdmin, (req, res) => {
    const existing = db.prepare('SELECT id FROM it_assets WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { serial_number, asset_number, assigned_type, assigned_id, device_status, repair_status } = req.body;
    if (device_status && !DEVICE_STATUSES.has(device_status)) return res.status(400).json({ error: 'invalid device_status' });
    if (repair_status !== undefined && repair_status !== null && !REPAIR_STATUSES.has(repair_status)) {
        return res.status(400).json({ error: 'invalid repair_status' });
    }

    const updates = ['updated_at = ?'];
    const params  = [Date.now()];
    if (serial_number !== undefined) { updates.push('serial_number = ?'); params.push(String(serial_number).trim()); }
    if (asset_number !== undefined)  { updates.push('asset_number = ?');  params.push(asset_number ? String(asset_number).trim() : null); }
    if (device_status !== undefined) { updates.push('device_status = ?'); params.push(device_status); }
    if (repair_status !== undefined) { updates.push('repair_status = ?'); params.push(repair_status); }
    if (assigned_type !== undefined) {
        const a = resolveAssignment(assigned_type, assigned_id);
        updates.push('assigned_type = ?', 'assigned_student_id = ?', 'assigned_staff_number = ?', 'assigned_cart_name = ?');
        params.push(a.assigned_type, a.assigned_student_id, a.assigned_staff_number, a.assigned_cart_name);
    }
    params.push(Number(req.params.id));

    try {
        db.prepare(`UPDATE it_assets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        res.json({ ok: true });
    } catch {
        res.status(400).json({ error: 'serial_number already exists' });
    }
});

router.delete('/assets/:id', requireItAdmin, (req, res) => {
    db.prepare('DELETE FROM it_assets WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
});

router.post('/assets/bulk-delete', requireItAdmin, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const del = db.prepare('DELETE FROM it_assets WHERE id = ?');
    let deleted = 0;
    for (const id of ids) deleted += del.run(Number(id)).changes;
    res.json({ deleted });
});

// ── Tickets ──────────────────────────────────────────────────────────────

const CATEGORIES = new Set(['Hardware', 'Software', 'Accounts', 'Whitelist/Blacklist Request', 'DobbsCore', 'Other']);
const PRIORITIES = new Set(['Low', 'Medium', 'High', 'Urgent']);
const STATUSES   = new Set(['Open', 'In Progress', 'Completed']);

function logTicketEvent(ticketId, eventType, actorEmail, detail) {
    db.prepare('INSERT INTO it_ticket_events(ticket_id, event_type, actor_email, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ticketId, eventType, actorEmail, detail, Date.now());
}

function isItAdminEmail(email) {
    return !!process.env.DEV_IT_ADMIN || (!!email && ADMIN_EMAILS.has(email.toLowerCase()));
}

router.post('/tickets', (req, res) => {
    const { requester_name, room_number, category, priority, note, linked_asset_id } = req.body;
    const email = getUserEmail(req.userKey);
    if (!email) return res.status(400).json({ error: 'account not found' });
    const isStaff = email.endsWith('@hartfordschools.org');

    if (!requester_name || !String(requester_name).trim()) return res.status(400).json({ error: 'requester_name required' });
    if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'invalid category' });
    if (!PRIORITIES.has(priority)) return res.status(400).json({ error: 'invalid priority' });
    if (isStaff && (!room_number || !String(room_number).trim())) {
        return res.status(400).json({ error: 'room_number required for staff requests' });
    }

    let assetId = null;
    if (linked_asset_id) {
        const asset = db.prepare('SELECT id FROM it_assets WHERE id = ?').get(Number(linked_asset_id));
        if (asset) assetId = asset.id;
    }

    const now = Date.now();
    const result = db.prepare(`
        INSERT INTO it_tickets(requester_user_key, requester_name, requester_email, room_number, category, priority, note, linked_asset_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
    `).run(
        req.userKey, String(requester_name).trim(), email, isStaff ? String(room_number).trim() : null,
        category, priority, note ? String(note).trim() : '', assetId, now, now
    );

    logTicketEvent(result.lastInsertRowid, 'created', email, `Ticket created (${category}, ${priority})`);
    res.json({ id: result.lastInsertRowid });
});

// Quick lost/found tool: only covers student-assigned devices (see plan).
router.post('/tickets/missing-device', (req, res) => {
    const { student_id, action } = req.body;
    if (!student_id || (action !== 'lost' && action !== 'found')) {
        return res.status(400).json({ error: 'student_id and action (lost|found) required' });
    }
    const email = getUserEmail(req.userKey);
    if (!email) return res.status(400).json({ error: 'account not found' });

    const id      = String(student_id).trim();
    const student = db.prepare('SELECT first_name, last_name FROM it_students WHERE student_id = ?').get(id);
    if (!student) return res.status(400).json({ error: 'No matching student found' });

    const asset = db.prepare(`SELECT id, serial_number FROM it_assets WHERE assigned_type = 'student' AND assigned_student_id = ?`).get(id);
    if (!asset) return res.status(400).json({ error: 'No device assigned to that student' });

    const now       = Date.now();
    const newStatus = action === 'lost' ? 'missing' : 'working';
    db.prepare('UPDATE it_assets SET device_status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, asset.id);

    const note = action === 'lost'
        ? `Reported LOST by ${email} for student ${student.first_name} ${student.last_name} (${id}). Serial: ${asset.serial_number}. Please lock this device.`
        : `Reported FOUND by ${email} for student ${student.first_name} ${student.last_name} (${id}). Serial: ${asset.serial_number}. Please unlock this device.`;

    const result = db.prepare(`
        INSERT INTO it_tickets(requester_user_key, requester_name, requester_email, room_number, category, priority, note, linked_asset_id, status, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 'Hardware', 'Urgent', ?, ?, 'Open', ?, ?)
    `).run(req.userKey, email.split('@')[0], email, note, asset.id, now, now);

    logTicketEvent(result.lastInsertRowid, 'created', email, note);
    res.json({ id: result.lastInsertRowid, serial_number: asset.serial_number });
});

router.get('/tickets/mine', (req, res) => {
    const rows = req.query.all === '1'
        ? db.prepare('SELECT * FROM it_tickets WHERE requester_user_key = ? ORDER BY created_at DESC').all(req.userKey)
        : db.prepare(`SELECT * FROM it_tickets WHERE requester_user_key = ? AND status != 'Completed' ORDER BY created_at DESC`).all(req.userKey);
    res.json({ tickets: rows });
});

const TICKET_LIST_SQL = `
    SELECT t.*, a.serial_number AS asset_serial_number, a.asset_number AS asset_asset_number,
           a.device_status AS asset_device_status
    FROM it_tickets t
    LEFT JOIN it_assets a ON t.linked_asset_id = a.id
`;

router.get('/tickets', requireItAdmin, (_req, res) => {
    res.json({ tickets: db.prepare(TICKET_LIST_SQL + ' ORDER BY t.created_at DESC').all() });
});

router.patch('/tickets/:id', requireItAdmin, (req, res) => {
    const { status } = req.body;
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
    const id     = Number(req.params.id);
    const ticket = db.prepare('SELECT status FROM it_tickets WHERE id = ?').get(id);
    if (!ticket) return res.status(404).json({ error: 'not found' });

    db.prepare('UPDATE it_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
    logTicketEvent(id, 'status_change', req.userEmail, `${ticket.status} -> ${status}`);
    res.json({ ok: true });
});

router.post('/tickets/:id/notes', requireItAdmin, (req, res) => {
    const { note } = req.body;
    if (!note || !String(note).trim()) return res.status(400).json({ error: 'note required' });
    const id     = Number(req.params.id);
    const ticket = db.prepare('SELECT id FROM it_tickets WHERE id = ?').get(id);
    if (!ticket) return res.status(404).json({ error: 'not found' });

    db.prepare('UPDATE it_tickets SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    logTicketEvent(id, 'note', req.userEmail, String(note).trim());
    res.json({ ok: true });
});

// Ticket detail + event log — used by the ticket queue and the Device Status notes popup.
router.get('/tickets/:id', (req, res) => {
    const ticket = db.prepare(TICKET_LIST_SQL + ' WHERE t.id = ?').get(Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: 'not found' });

    const email = getUserEmail(req.userKey);
    if (ticket.requester_user_key !== req.userKey && !isItAdminEmail(email)) {
        return res.status(403).json({ error: 'not authorized' });
    }

    const events = db.prepare('SELECT * FROM it_ticket_events WHERE ticket_id = ? ORDER BY created_at ASC').all(ticket.id);
    res.json({ ticket, events });
});

module.exports = router;
