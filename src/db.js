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

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}
