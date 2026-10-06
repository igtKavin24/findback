const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file lives in backend/data/findback.db
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'findback.db'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    type       TEXT NOT NULL CHECK (type IN ('lost','found')),
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,
    color      TEXT,
    brand      TEXT,
    location   TEXT NOT NULL,
    date       TEXT NOT NULL,
    photo_path TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    lost_id      INTEGER NOT NULL REFERENCES reports(id),
    found_id     INTEGER NOT NULL REFERENCES reports(id),
    requester_id INTEGER NOT NULL REFERENCES users(id),
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','declined','cancelled','completed')),
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    sender_id  INTEGER NOT NULL REFERENCES users(id),
    text       TEXT NOT NULL,
    edited     INTEGER NOT NULL DEFAULT 0,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dismissed_matches (
    user_id  INTEGER NOT NULL REFERENCES users(id),
    lost_id  INTEGER NOT NULL REFERENCES reports(id),
    found_id INTEGER NOT NULL REFERENCES reports(id),
    PRIMARY KEY (user_id, lost_id, found_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_type_done ON reports(type, done);
  CREATE INDEX IF NOT EXISTS idx_reports_user      ON reports(user_id);
  CREATE INDEX IF NOT EXISTS idx_requests_lost     ON requests(lost_id);
  CREATE INDEX IF NOT EXISTS idx_requests_found    ON requests(found_id);
  CREATE INDEX IF NOT EXISTS idx_messages_request  ON messages(request_id);
`);

module.exports = db;