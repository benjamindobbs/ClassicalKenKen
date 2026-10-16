// CSV imports for students, staff, duties and links. Every import is
// previewed as a diff (adds / changes / removals) before anything is written;
// commit recomputes the diff from the same CSV text and applies it.

const { db, tx, audit, rebuildSearch } = require('./db');
const { ROLE_NAMES } = require('./permissions');

// RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF.
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') q = false;
            else field += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(f => f.trim() !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
    if (!rows.length) return { header: [], records: [] };
    const header = rows[0].map(h => h.trim().toLowerCase());
    const records = rows.slice(1).map((r, i) => {
        const o = { _line: i + 2 };
        header.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
        return o;
    });
    return { header, records };
}

const csvCell = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const emailToId = () => new Map(db.prepare('SELECT id, email FROM staff').all().map(s => [s.email.toLowerCase(), s.id]));
const idToEmail = () => new Map(db.prepare('SELECT id, email FROM staff').all().map(s => [s.id, s.email]));

// Each type: required columns, how to key rows, how to read current rows
// into the same comparable shape, and how to apply adds/changes/removals.
const TYPES = {
    students: {
        columns: ['dcid', 'student_number', 'first', 'last', 'grade'],
        sample: [['dcid', 'student_number', 'first', 'last', 'grade'], ['900001', '260001', 'Sample', 'Student', '9']],
        key: r => String(r.dcid),
        normalize(r) {
            if (!/^\d+$/.test(r.dcid)) return 'dcid must be a number';
            if (!r.student_number || !r.first || !r.last) return 'student_number, first and last are required';
            if (!/^(6|7|8|9|10|11|12)$/.test(r.grade)) return 'grade must be 6–12';
            return { dcid: r.dcid, student_number: r.student_number, first: r.first, last: r.last, grade: r.grade };
        },
        current: () => db.prepare('SELECT * FROM students WHERE active = 1').all()
            .map(s => ({ dcid: String(s.dcid), student_number: s.student_number, first: s.first, last: s.last, grade: String(s.grade) })),
        label: r => `${r.first} ${r.last} (#${r.student_number})`,
        removalVerb: 'deactivate',
        apply({ adds, changes, removals }) {
            const up = db.prepare(`INSERT INTO students(dcid, student_number, first, last, grade, active) VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(dcid) DO UPDATE SET student_number = excluded.student_number, first = excluded.first,
                    last = excluded.last, grade = excluded.grade, active = 1`);
            for (const { row } of [...adds, ...changes]) up.run(Number(row.dcid), row.student_number, row.first, row.last, Number(row.grade));
            const off = db.prepare('UPDATE students SET active = 0 WHERE dcid = ?');
            for (const r of removals) off.run(Number(r.key));
        },
    },

    staff: {
        columns: ['email', 'first', 'last', 'role'],
        sample: [['email', 'first', 'last', 'display_name', 'role', 'title', 'room', 'phone_ext', 'office_hours', 'division'],
                 ['sample.person@demo.classical.example', 'Sample', 'Person', 'Sample Person', 'teacher', 'Chemistry', '312', '2312', 'Mon 2:15–3:00', 'HS']],
        key: r => r.email.toLowerCase(),
        normalize(r) {
            if (!/^[^@\s]+@[^@\s]+$/.test(r.email)) return 'email is invalid';
            if (!r.first || !r.last) return 'first and last are required';
            if (!ROLE_NAMES.includes(r.role)) return `role must be one of ${ROLE_NAMES.join(', ')}`;
            const division = (r.division || 'BOTH').toUpperCase();
            if (!['HS', 'MS', 'BOTH'].includes(division)) return 'division must be HS, MS or BOTH';
            return {
                email: r.email.toLowerCase(), first: r.first, last: r.last, display_name: r.display_name || `${r.first} ${r.last}`,
                role: r.role, title: r.title || '', room: r.room || '', phone_ext: r.phone_ext || '', office_hours: r.office_hours || '', division,
            };
        },
        current: () => db.prepare('SELECT * FROM staff WHERE active = 1').all().map(s => ({
            email: s.email.toLowerCase(), first: s.first, last: s.last, display_name: s.display_name || `${s.first} ${s.last}`,
            role: s.role, title: s.title || '', room: s.room || '', phone_ext: s.phone_ext || '', office_hours: s.office_hours || '', division: s.division,
        })),
        label: r => `${r.display_name} <${r.email}>`,
        removalVerb: 'deactivate',
        apply({ adds, changes, removals }) {
            const up = db.prepare(`INSERT INTO staff(email, first, last, display_name, role, title, room, phone_ext, office_hours, division, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(email) DO UPDATE SET first = excluded.first, last = excluded.last, display_name = excluded.display_name,
                    role = excluded.role, title = excluded.title, room = excluded.room, phone_ext = excluded.phone_ext,
                    office_hours = excluded.office_hours, division = excluded.division, active = 1`);
            for (const { row: r } of [...adds, ...changes])
                up.run(r.email, r.first, r.last, r.display_name, r.role, r.title || null, r.room || null, r.phone_ext || null, r.office_hours || null, r.division);
            const off = db.prepare('UPDATE staff SET active = 0 WHERE lower(email) = ?');
            for (const r of removals) off.run(r.key);
        },
    },

    links: {
        columns: ['title', 'url', 'category'],
        sample: [['title', 'url', 'category', 'description', 'owner_email', 'pinned', 'sort'],
                 ['Sample Link', 'https://example.com/sample', 'Operational Responsibilities', 'What this link is for', 'dana.whitfield@demo.classical.example', '0', '40']],
        key: r => r.url,
        normalize(r) {
            if (!r.title || !r.url || !r.category) return 'title, url and category are required';
            if (r.owner_email && !emailToId().has(r.owner_email.toLowerCase())) return `unknown owner_email ${r.owner_email}`;
            return { title: r.title, url: r.url, category: r.category, description: r.description || '',
                     owner_email: (r.owner_email || '').toLowerCase(), pinned: r.pinned === '1' || /^true$/i.test(r.pinned) ? '1' : '0',
                     sort: String(parseInt(r.sort, 10) || 0) };
        },
        current: () => {
            const emails = idToEmail();
            return db.prepare('SELECT * FROM links').all().map(l => ({
                title: l.title, url: l.url, category: l.category, description: l.description || '',
                owner_email: (emails.get(l.owner_staff_id) || '').toLowerCase(), pinned: String(l.pinned), sort: String(l.sort),
            }));
        },
        label: r => `${r.title} (${r.category})`,
        removalVerb: 'delete',
        apply({ adds, changes, removals }) {
            const ids = emailToId();
            const ins = db.prepare('INSERT INTO links(title, url, category, description, owner_staff_id, pinned, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
            const upd = db.prepare('UPDATE links SET title = ?, category = ?, description = ?, owner_staff_id = ?, pinned = ?, sort = ? WHERE url = ?');
            for (const { row: r } of adds) ins.run(r.title, r.url, r.category, r.description, ids.get(r.owner_email) ?? null, Number(r.pinned), Number(r.sort));
            for (const { row: r } of changes) upd.run(r.title, r.category, r.description, ids.get(r.owner_email) ?? null, Number(r.pinned), Number(r.sort), r.url);
            const del = db.prepare('DELETE FROM links WHERE url = ?');
            for (const r of removals) del.run(r.key);
        },
    },

    duties: {
        columns: ['name', 'start_time', 'end_time', 'day_key'],
        sample: [['name', 'location', 'start_time', 'end_time', 'week_type', 'day_key', 'staff_emails'],
                 ['Morning — Front Entrance', 'Main entrance', '07:05', '07:30', '5-day', 'Mon', 'morgan.avery@demo.classical.example;sam.okafor@demo.classical.example']],
        key: r => `${r.name}|${r.week_type}|${r.day_key}`,
        normalize(r) {
            if (!r.name) return 'name is required';
            if (!/^\d{2}:\d{2}$/.test(r.start_time) || !/^\d{2}:\d{2}$/.test(r.end_time)) return 'times must be HH:MM';
            if (!/^(Mon|Tue|Wed|Thu|Fri|Day[1-4])$/.test(r.day_key)) return 'day_key must be Mon–Fri or Day1–Day4';
            const ids = emailToId();
            const emails = (r.staff_emails || '').split(';').map(e => e.trim().toLowerCase()).filter(Boolean).sort();
            const unknown = emails.find(e => !ids.has(e));
            if (unknown) return `unknown staff email ${unknown}`;
            return { name: r.name, location: r.location || '', start_time: r.start_time, end_time: r.end_time,
                     week_type: r.week_type || '5-day', day_key: r.day_key, staff_emails: emails.join(';') };
        },
        current: () => {
            const emails = idToEmail();
            return db.prepare('SELECT * FROM duty_slots').all().map(d => ({
                name: d.name, location: d.location || '', start_time: d.start_time, end_time: d.end_time,
                week_type: d.week_type, day_key: d.day_key,
                staff_emails: db.prepare('SELECT staff_id FROM duty_assignments WHERE duty_slot_id = ?').all(d.id)
                    .map(a => (emails.get(a.staff_id) || '').toLowerCase()).sort().join(';'),
            }));
        },
        label: r => `${r.name} · ${r.day_key} ${r.start_time}`,
        removalVerb: 'delete',
        apply({ adds, changes, removals }) {
            const ids = emailToId();
            const find = db.prepare('SELECT id FROM duty_slots WHERE name = ? AND week_type = ? AND day_key = ?');
            const ins = db.prepare('INSERT INTO duty_slots(name, location, start_time, end_time, week_type, day_key) VALUES (?, ?, ?, ?, ?, ?)');
            const upd = db.prepare('UPDATE duty_slots SET location = ?, start_time = ?, end_time = ? WHERE id = ?');
            const clear = db.prepare('DELETE FROM duty_assignments WHERE duty_slot_id = ?');
            const assign = db.prepare('INSERT OR IGNORE INTO duty_assignments(duty_slot_id, staff_id) VALUES (?, ?)');
            for (const { row: r } of [...adds, ...changes]) {
                let id = find.get(r.name, r.week_type, r.day_key)?.id;
                if (id) upd.run(r.location, r.start_time, r.end_time, id);
                else id = Number(ins.run(r.name, r.location, r.start_time, r.end_time, r.week_type, r.day_key).lastInsertRowid);
                clear.run(id);
                for (const e of r.staff_emails.split(';').filter(Boolean)) assign.run(id, ids.get(e));
            }
            for (const rem of removals) {
                const [name, week_type, day_key] = rem.key.split('|');
                const id = find.get(name, week_type, day_key)?.id;
                if (id) { clear.run(id); db.prepare('DELETE FROM duty_slots WHERE id = ?').run(id); }
            }
        },
    },
};

function diff(type, csvText) {
    const T = TYPES[type];
    if (!T) throw Object.assign(new Error(`Unknown import type ${type}`), { status: 400 });
    const { header, records } = parseCsv(csvText);
    const missing = T.columns.filter(c => !header.includes(c));
    if (missing.length) return { type, errors: [{ line: 1, message: `Missing column(s): ${missing.join(', ')}` }], adds: [], changes: [], removals: [] };

    const errors = [], incoming = new Map();
    for (const rec of records) {
        const row = T.normalize(rec);
        if (typeof row === 'string') { errors.push({ line: rec._line, message: row }); continue; }
        const key = T.key(row);
        if (incoming.has(key)) { errors.push({ line: rec._line, message: `duplicate ${key}` }); continue; }
        incoming.set(key, row);
    }

    const current = new Map(T.current().map(r => [T.key(r), r]));
    const adds = [], changes = [], removals = [];
    for (const [key, row] of incoming) {
        const cur = current.get(key);
        if (!cur) { adds.push({ key, label: T.label(row), row }); continue; }
        const fields = Object.keys(row).filter(f => String(row[f]) !== String(cur[f] ?? ''))
            .map(f => ({ field: f, from: cur[f] ?? '', to: row[f] }));
        if (fields.length) changes.push({ key, label: T.label(row), row, fields });
    }
    for (const [key, cur] of current) if (!incoming.has(key)) removals.push({ key, label: T.label(cur) });

    return { type, removalVerb: T.removalVerb, errors, adds, changes, removals, unchanged: incoming.size - adds.length - changes.length };
}

function commit(type, csvText, userId) {
    const d = diff(type, csvText);
    if (d.errors.length) throw Object.assign(new Error('Fix the CSV errors before committing'), { status: 400, details: d.errors });
    tx(() => {
        TYPES[type].apply(d);
        audit(userId, 'import', type, null, null, {
            adds: d.adds.map(a => a.key), changes: d.changes.map(c => ({ key: c.key, fields: c.fields })), removals: d.removals.map(r => r.key),
        });
    });
    rebuildSearch();
    return { added: d.adds.length, changed: d.changes.length, removed: d.removals.length };
}

function sampleCsv(type) {
    const T = TYPES[type];
    if (!T) return null;
    return T.sample.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

module.exports = { parseCsv, diff, commit, sampleCsv, IMPORT_TYPES: Object.keys(TYPES) };
