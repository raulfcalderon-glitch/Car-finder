import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('user', 'dealer')),
    business_name TEXT,
    phone         TEXT,
    -- Dealers start 'pending' until an admin approves them; buyers are 'active' right away.
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected')),
    -- Set by an admin to block sign-in and hide the account's requests or responses.
    frozen_at     TEXT,
    frozen_reason TEXT,
    last_login_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A vehicle request posted by a user (buyer).
  CREATE TABLE IF NOT EXISTS requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    make       TEXT NOT NULL,
    model      TEXT NOT NULL,
    trim       TEXT,
    year_min   INTEGER,
    year_max   INTEGER,
    max_budget INTEGER,
    condition  TEXT NOT NULL DEFAULT 'any'
               CHECK (condition IN ('any', 'concours', 'excellent', 'good', 'project')),
    color      TEXT,
    location   TEXT,
    notes      TEXT,
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);

  -- A dealer's reply to a request (e.g. "I have one, here's the price").
  CREATE TABLE IF NOT EXISTS responses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    dealer_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    price      INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_responses_request ON responses(request_id);
`;

// What buyers and dealers are allowed to see: nothing from frozen accounts.
// Admin screens read the underlying tables directly so they still see everything.
const VIEWS = `
  CREATE VIEW IF NOT EXISTS visible_requests AS
    SELECT r.* FROM requests r JOIN accounts a ON a.id = r.user_id WHERE a.frozen_at IS NULL;

  CREATE VIEW IF NOT EXISTS visible_responses AS
    SELECT x.* FROM responses x JOIN accounts a ON a.id = x.dealer_id WHERE a.frozen_at IS NULL;
`;

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  db.exec(VIEWS);
  return db;
}

// Brings databases created by older versions of the app up to the current schema.
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  if (!columns.includes('status')) {
    // Dealers who signed up before approval existed stay active.
    db.exec(`ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'pending', 'rejected'))`);
  }
  for (const column of ['frozen_at', 'frozen_reason', 'last_login_at']) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE accounts ADD COLUMN ${column} TEXT`);
  }
}
