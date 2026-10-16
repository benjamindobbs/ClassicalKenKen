// Staff Hub database. Deliberately separate from scores.db: nothing in
// server/staff may import ../db.js, so the hub can be removed by deleting
// this folder, routes/staff.js, the two hooks in index.js and staff.db.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const dbPath = process.env.STAFF_DB_PATH || path.join(__dirname, '..', '..', 'data', 'staff.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = OFF');

db.exec(`
    CREATE TABLE IF NOT EXISTS staff (
        id            INTEGER PRIMARY KEY,
        email         TEXT    NOT NULL UNIQUE,
        first         TEXT    NOT NULL,
        last          TEXT    NOT NULL,
        display_name  TEXT,
        role          TEXT    NOT NULL,
        phone_ext     TEXT,
        room          TEXT,
        title         TEXT,
        office_hours  TEXT,
        division      TEXT    NOT NULL DEFAULT 'BOTH',
        active        INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS students (
        dcid            INTEGER PRIMARY KEY,
        student_number  TEXT    NOT NULL UNIQUE,
        first           TEXT    NOT NULL,
        last            TEXT    NOT NULL,
        grade           INTEGER NOT NULL,
        active          INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sections (
        id             INTEGER PRIMARY KEY,
        teacher_id     INTEGER NOT NULL REFERENCES staff(id),
        course_name    TEXT    NOT NULL,
        ps_expression  TEXT    NOT NULL,
        period         TEXT    NOT NULL,     -- '1'..'7' or a label like 'WIN A' / 'Advisory'
        division       TEXT    NOT NULL,
        room           TEXT,
        term           TEXT    NOT NULL DEFAULT '26-27'
    );

    CREATE TABLE IF NOT EXISTS enrollments (
        section_id    INTEGER NOT NULL REFERENCES sections(id),
        student_dcid  INTEGER NOT NULL REFERENCES students(dcid),
        enrolled_on   TEXT,
        exited_on     TEXT,
        PRIMARY KEY (section_id, student_dcid)
    );

    CREATE TABLE IF NOT EXISTS student_flags (
        id            INTEGER PRIMARY KEY,
        student_dcid  INTEGER NOT NULL,
        type          TEXT    NOT NULL,
        note          TEXT,
        start_date    TEXT    NOT NULL,
        end_date      TEXT,
        created_by    INTEGER,
        created_at    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS serves (
        id                  INTEGER PRIMARY KEY,
        student_dcid        INTEGER NOT NULL,
        ps_incident_id      TEXT,
        infraction_code     TEXT,
        incident_date       TEXT,
        sanction            TEXT    NOT NULL,
        serve_date          TEXT    NOT NULL,
        serve_end_date      TEXT,              -- multi-day OSS; NULL means a single day
        periods             TEXT    NOT NULL,  -- '1,2,3' or 'ALL'
        status              TEXT    NOT NULL DEFAULT 'scheduled',
        rescheduled_to      INTEGER,
        comments            TEXT,
        offense_number      INTEGER,
        sus_letter_sent     INTEGER,
        person_responsible  INTEGER,
        created_by          INTEGER,
        created_at          TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS field_trips (
        id             INTEGER PRIMARY KEY,
        title          TEXT    NOT NULL,
        date           TEXT    NOT NULL,
        depart_time    TEXT,
        return_time    TEXT,
        destination    TEXT,
        info           TEXT,
        submitted_by   INTEGER,
        status         TEXT    NOT NULL DEFAULT 'pending',
        reviewed_by    INTEGER,
        reviewed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS trip_attendees (
        trip_id       INTEGER NOT NULL,
        student_dcid  INTEGER NOT NULL,
        PRIMARY KEY (trip_id, student_dcid)
    );

    CREATE TABLE IF NOT EXISTS trip_revisions (
        id             INTEGER PRIMARY KEY,
        trip_id        INTEGER NOT NULL,
        snapshot_json  TEXT    NOT NULL,
        submitted_by   INTEGER,
        submitted_at   TEXT    NOT NULL,
        status         TEXT    NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS links (
        id                 INTEGER PRIMARY KEY,
        title              TEXT    NOT NULL,
        url                TEXT    NOT NULL,
        category           TEXT    NOT NULL,
        description        TEXT,
        owner_staff_id     INTEGER,
        drive_file_id      TEXT,
        drive_modified_at  TEXT,
        pinned             INTEGER NOT NULL DEFAULT 0,
        sort               INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS faq (
        id                 INTEGER PRIMARY KEY,
        topic              TEXT    NOT NULL,
        primary_contact    INTEGER,
        secondary_contact  INTEGER,
        notes              TEXT
    );

    CREATE TABLE IF NOT EXISTS bell_templates (
        id                INTEGER PRIMARY KEY,
        name              TEXT    NOT NULL,
        division          TEXT    NOT NULL,
        kind              TEXT    NOT NULL DEFAULT 'regular',  -- regular | early_release | x_day
        default_map_json  TEXT                                  -- { Mon: {slot: meets}, ... } for rotating templates
    );

    CREATE TABLE IF NOT EXISTS bell_slots (
        template_id  INTEGER NOT NULL,
        slot_order   INTEGER NOT NULL,
        start_time   TEXT    NOT NULL,
        end_time     TEXT    NOT NULL,
        label        TEXT    NOT NULL,
        note         TEXT,
        PRIMARY KEY (template_id, slot_order)
    );

    CREATE TABLE IF NOT EXISTS day_plans (
        date           TEXT    NOT NULL,
        division       TEXT    NOT NULL,
        template_id    INTEGER,
        slot_map_json  TEXT,
        note           TEXT,
        is_school_day  INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (date, division)
    );

    CREATE TABLE IF NOT EXISTS duty_slots (
        id          INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        location    TEXT,
        start_time  TEXT    NOT NULL,
        end_time    TEXT    NOT NULL,
        week_type   TEXT    NOT NULL DEFAULT '5-day',
        day_key     TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS duty_assignments (
        duty_slot_id  INTEGER NOT NULL,
        staff_id      INTEGER NOT NULL,
        PRIMARY KEY (duty_slot_id, staff_id)
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
        id        INTEGER PRIMARY KEY,
        uid       TEXT    UNIQUE,
        title     TEXT    NOT NULL,
        start     TEXT    NOT NULL,   -- 'YYYY-MM-DD' (all day) or 'YYYY-MM-DDTHH:MM', school-local time
        end       TEXT,
        all_day   INTEGER NOT NULL DEFAULT 0,
        location  TEXT,
        source    TEXT    NOT NULL DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER,
        action       TEXT    NOT NULL,
        entity       TEXT    NOT NULL,
        entity_id    TEXT,
        before_json  TEXT,
        after_json   TEXT,
        at           TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_enroll_student ON enrollments(student_dcid);
    CREATE INDEX IF NOT EXISTS idx_flags_student  ON student_flags(student_dcid);
    CREATE INDEX IF NOT EXISTS idx_serves_date    ON serves(serve_date);
    CREATE INDEX IF NOT EXISTS idx_audit_at       ON audit_log(at);
`);

// One standalone FTS5 table, rebuilt wholesale after writes to indexed
// tables. The hub's data is a few hundred rows, so a full rebuild is cheaper
// to reason about than per-table triggers.
let ftsAvailable = true;
try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        kind UNINDEXED, ref UNINDEXED, title, body, tokenize = 'unicode61'
    )`);
} catch (e) {
    ftsAvailable = false;
    console.warn('staff: FTS5 unavailable, search falls back to LIKE:', e.message);
}

function rebuildSearch() {
    if (!ftsAvailable) return;
    const ins = db.prepare('INSERT INTO search_index(kind, ref, title, body) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
        db.exec('DELETE FROM search_index');
        for (const r of db.prepare('SELECT id, title, description, category FROM links').all())
            ins.run('link', String(r.id), r.title, `${r.description || ''} ${r.category}`);
        for (const r of db.prepare('SELECT id, topic, notes FROM faq').all())
            ins.run('faq', String(r.id), r.topic, r.notes || '');
        for (const r of db.prepare('SELECT id, first, last, display_name, title, room FROM staff WHERE active = 1').all())
            ins.run('staff', String(r.id), `${r.display_name || r.first + ' ' + r.last}`, `${r.first} ${r.last} ${r.title || ''} ${r.room || ''}`);
        for (const r of db.prepare('SELECT id, title FROM calendar_events').all())
            ins.run('event', String(r.id), r.title, '');
        for (const r of db.prepare('SELECT dcid, first, last, student_number FROM students WHERE active = 1').all())
            ins.run('student', String(r.dcid), `${r.first} ${r.last}`, r.student_number);
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

function nowIso() {
    return new Date().toISOString();
}

function audit(userId, action, entity, entityId, before, after) {
    db.prepare(`INSERT INTO audit_log(user_id, action, entity, entity_id, before_json, after_json, at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        userId ?? null, action, entity, entityId == null ? null : String(entityId),
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        nowIso()
    );
}

// Run fn inside a transaction; node:sqlite has no helper for this.
function tx(fn) {
    db.exec('BEGIN');
    try {
        const out = fn();
        db.exec('COMMIT');
        return out;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

module.exports = { db, dbPath, ftsAvailable: () => ftsAvailable, rebuildSearch, audit, tx, nowIso };
