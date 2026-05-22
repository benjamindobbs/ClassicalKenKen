const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scores.db');

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);

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

    CREATE INDEX IF NOT EXISTS idx_kenken_user ON kenken_scores(user_key);
    CREATE INDEX IF NOT EXISTS idx_sat_user ON sat_scores(user_key);
`);

function upsertUser(userKey, email) {
    db.prepare(
        'INSERT OR IGNORE INTO users(user_key, email, first_seen) VALUES(?, ?, ?)'
    ).run(userKey, email, Date.now());
}

module.exports = { db, upsertUser };
