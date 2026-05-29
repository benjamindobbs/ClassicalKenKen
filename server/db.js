const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scores.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);

// Migrate single-row teacher tables to per-teacher-key schema
{
    const cols = db.prepare("PRAGMA table_info(teacher_profile)").all();
    if (cols.length > 0 && !cols.some(c => c.name === 'teacher_key')) {
        db.exec(`
            DROP TABLE IF EXISTS class_students;
            DROP TABLE IF EXISTS classes;
            DROP TABLE IF EXISTS assignment_settings;
            DROP TABLE IF EXISTS gradebook_settings;
            DROP TABLE IF EXISTS teacher_profile;
        `);
    }
}

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_key    TEXT    PRIMARY KEY,
        email       TEXT    NOT NULL UNIQUE,
        first_seen  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kenken_scores (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key     TEXT    NOT NULL REFERENCES users(user_key),
        score        REAL    NOT NULL,
        size         INTEGER NOT NULL,
        submitted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sat_scores (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key     TEXT    NOT NULL REFERENCES users(user_key),
        correct      INTEGER NOT NULL,
        domain_idx   INTEGER NOT NULL,
        skill        TEXT    NOT NULL DEFAULT '',
        difficulty   TEXT    NOT NULL,
        submitted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT    PRIMARY KEY,
        user_key   TEXT    NOT NULL REFERENCES users(user_key),
        created_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kenken_user   ON kenken_scores(user_key);
    CREATE INDEX IF NOT EXISTS idx_sat_user      ON sat_scores(user_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_key);

    CREATE TABLE IF NOT EXISTS teacher_profile (
        teacher_key TEXT PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS gradebook_settings (
        teacher_key             TEXT PRIMARY KEY,
        assignment_max_score    REAL NOT NULL DEFAULT 100,
        completion_score_pct    REAL NOT NULL DEFAULT 100,
        no_submission_score_pct REAL NOT NULL DEFAULT 0
    );

    -- required_activity: 'kenken' | 'sat' | 'both' | 'either'
    CREATE TABLE IF NOT EXISTS assignment_settings (
        teacher_key           TEXT    PRIMARY KEY,
        required_activity     TEXT    NOT NULL DEFAULT 'either',
        required_kenken_count INTEGER NOT NULL DEFAULT 1,
        required_sat_count    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS classes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_key TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
    );

    -- student_id is the school-assigned ID from CSV
    -- user_key links to app account; nullable until teacher maps the student
    CREATE TABLE IF NOT EXISTS class_students (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id   TEXT    NOT NULL,
        student_name TEXT    NOT NULL,
        user_key     TEXT    REFERENCES users(user_key),
        UNIQUE(class_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
    CREATE INDEX IF NOT EXISTS idx_class_students_user  ON class_students(user_key);

    -- Microcredential templates (reusable across classes)
    CREATE TABLE IF NOT EXISTS microcredentials (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_key TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        UNIQUE(teacher_key, name)
    );

    -- Ordered checkpoints within a microcredential
    CREATE TABLE IF NOT EXISTS mc_checkpoints (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        mc_id     INTEGER NOT NULL REFERENCES microcredentials(id) ON DELETE CASCADE,
        name      TEXT    NOT NULL,
        order_idx INTEGER NOT NULL
    );

    -- Assigns a microcredential template to a class; stores summative PS assignment IDs for re-sync
    CREATE TABLE IF NOT EXISTS mc_class_assignments (
        mc_id                             INTEGER NOT NULL REFERENCES microcredentials(id) ON DELETE CASCADE,
        class_id                          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        summative_ps_assignment_id        TEXT,
        summative_ps_assignmentsection_id TEXT,
        PRIMARY KEY (mc_id, class_id)
    );

    -- Per-checkpoint PS assignment IDs, scoped per class for re-sync
    CREATE TABLE IF NOT EXISTS mc_checkpoint_sync (
        checkpoint_id           INTEGER NOT NULL REFERENCES mc_checkpoints(id) ON DELETE CASCADE,
        class_id                INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        ps_assignment_id        TEXT,
        ps_assignmentsection_id TEXT,
        PRIMARY KEY (checkpoint_id, class_id)
    );

    -- One row per completed checkpoint per student per class
    CREATE TABLE IF NOT EXISTS mc_completions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        checkpoint_id INTEGER NOT NULL REFERENCES mc_checkpoints(id) ON DELETE CASCADE,
        class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id    TEXT    NOT NULL,
        completed_at  INTEGER NOT NULL,
        UNIQUE(checkpoint_id, class_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mc_checkpoints_mc    ON mc_checkpoints(mc_id);
    CREATE INDEX IF NOT EXISTS idx_mc_completions_cp    ON mc_completions(checkpoint_id, class_id);
    CREATE INDEX IF NOT EXISTS idx_mc_completions_class ON mc_completions(class_id);
`);

// Add ps_section_id to classes if not present (one-time migration)
try { db.prepare('ALTER TABLE classes ADD COLUMN ps_section_id TEXT').run(); } catch { /* already exists */ }

function upsertUser(userKey, email) {
    db.prepare(
        'INSERT OR IGNORE INTO users(user_key, email, first_seen) VALUES(?, ?, ?)'
    ).run(userKey, email, Date.now());
}

module.exports = { db, upsertUser };
