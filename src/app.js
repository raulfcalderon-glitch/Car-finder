import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, newSessionToken, hashToken } from './auth.js';
import {
  newResponseEmail,
  newDealerEmail,
  dealerApprovedEmail,
  verifyEmail,
  passwordResetEmail,
} from './email.js';
import { createLimiter } from './ratelimit.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = 'cf_session';

const CONDITIONS = ['any', 'concours', 'excellent', 'good', 'project'];
const STATUSES = ['open', 'fulfilled', 'closed'];

// Whitelisted sort options for the dealer list. Never interpolate user input into ORDER BY.
const SORTS = {
  newest: 'r.created_at DESC, r.id DESC',
  oldest: 'r.created_at ASC, r.id ASC',
  budget_desc: 'r.max_budget IS NULL, r.max_budget DESC, r.id DESC',
  budget_asc: 'r.max_budget IS NULL, r.max_budget ASC, r.id DESC',
  year_desc: 'COALESCE(r.year_max, r.year_min) IS NULL, COALESCE(r.year_max, r.year_min) DESC, r.id DESC',
  year_asc: 'COALESCE(r.year_min, r.year_max) IS NULL, COALESCE(r.year_min, r.year_max) ASC, r.id DESC',
  make: 'r.make COLLATE NOCASE ASC, r.model COLLATE NOCASE ASC, r.id DESC',
  responses: 'response_count DESC, r.created_at DESC',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- input helpers ----------

function str(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const s = String(value).trim();
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}

function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function oneOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

const MAX_YEAR = new Date().getFullYear() + 2;

function parseRequestFields(body) {
  const fields = {
    make: str(body.make, 'Make', { required: true, max: 60 }),
    model: str(body.model, 'Model', { required: true, max: 80 }),
    trim: str(body.trim, 'Trim', { max: 80 }),
    year_min: int(body.yearMin, 'Minimum year', { min: 1885, max: MAX_YEAR }),
    year_max: int(body.yearMax, 'Maximum year', { min: 1885, max: MAX_YEAR }),
    max_budget: int(body.maxBudget, 'Budget', { min: 0, max: 100_000_000 }),
    condition: oneOf(body.condition, 'Condition', CONDITIONS, 'any'),
    color: str(body.color, 'Color', { max: 60 }),
    location: str(body.location, 'Location', { max: 120 }),
    notes: str(body.notes, 'Notes', { max: 2000 }),
  };
  if (fields.year_min && fields.year_max && fields.year_min > fields.year_max) {
    throw new HttpError(400, 'Minimum year cannot be after maximum year');
  }
  return fields;
}

// ---------- serializers ----------

// Full account details, for admin screens only.
function serializeAdminAccount(a, isAdmin) {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    role: a.role,
    businessName: a.business_name,
    phone: a.phone,
    status: a.status,
    frozen: Boolean(a.frozen_at),
    frozenAt: a.frozen_at,
    frozenReason: a.frozen_reason,
    lastLoginAt: a.last_login_at,
    emailVerified: Boolean(a.email_verified_at),
    termsAcceptedAt: a.terms_accepted_at,
    createdAt: a.created_at,
    isAdmin,
    requestCount: a.request_count ?? undefined,
    openRequestCount: a.open_request_count ?? undefined,
    responseCount: a.response_count ?? undefined,
  };
}

function serializeRequest(r) {
  return {
    id: r.id,
    make: r.make,
    model: r.model,
    trim: r.trim,
    yearMin: r.year_min,
    yearMax: r.year_max,
    maxBudget: r.max_budget,
    condition: r.condition,
    color: r.color,
    location: r.location,
    notes: r.notes,
    status: r.status,
    hidden: Boolean(r.hidden_at),
    createdAt: r.created_at,
    // Dealers see only the buyer's first name; contact happens through responses.
    requesterName: r.requester_name ? String(r.requester_name).split(/\s+/)[0] : undefined,
    responseCount: r.response_count ?? undefined,
  };
}

function serializeResponse(r) {
  return {
    id: r.id,
    requestId: r.request_id,
    message: r.message,
    price: r.price,
    createdAt: r.created_at,
    dealer: {
      id: r.dealer_id,
      name: r.dealer_name,
      businessName: r.business_name,
      email: r.dealer_email,
      phone: r.dealer_phone,
    },
  };
}

// ---------- http helpers ----------

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, { secure }) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=2592000'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR) || filePath.includes(`${sep}..`)) throw new HttpError(404, 'Not found');
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    // Unknown non-API paths fall back to the single-page app.
    const body = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(body);
  }
}

// ---------- app ----------

const ACCOUNT_STATUSES = ['active', 'pending', 'rejected'];
const ACCOUNT_FILTERS = ['all', 'active', 'pending', 'rejected', 'frozen'];

const ACCOUNT_SORTS = {
  newest: 'a.created_at DESC, a.id DESC',
  oldest: 'a.created_at ASC, a.id ASC',
  name: 'COALESCE(a.business_name, a.name) COLLATE NOCASE ASC, a.id ASC',
  last_login: 'a.last_login_at IS NULL, a.last_login_at DESC, a.id DESC',
  activity: 'request_count + response_count DESC, a.created_at DESC',
};

// Per-account activity counts, used by the admin lists and detail page.
const ACCOUNT_COUNTS = `
  (SELECT COUNT(*) FROM requests r WHERE r.user_id = a.id) AS request_count,
  (SELECT COUNT(*) FROM requests r WHERE r.user_id = a.id AND r.status = 'open') AS open_request_count,
  (SELECT COUNT(*) FROM responses x WHERE x.dealer_id = a.id) AS response_count`;

const MINUTE = 60_000;

// Abuse limits. Per-email limits are the real protection; per-IP limits are a backstop.
const DEFAULT_LIMITS = {
  loginPerAccount: { max: 5, windowMs: 15 * MINUTE }, // wrong passwords per email + IP
  loginPerIp: { max: 50, windowMs: 15 * MINUTE },
  emailPerAccount: { max: 3, windowMs: 60 * MINUTE }, // reset / verification emails per address
  emailPerIp: { max: 20, windowMs: 60 * MINUTE },
  signupPerIp: { max: 20, windowMs: 60 * MINUTE },
};

function clientIp(req) {
  // Render (and Cloudflare in front of it) put the visitor's address first in X-Forwarded-For.
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

export function createApp(
  db,
  {
    secureCookies = false,
    sendEmail = async () => {},
    appUrl = 'http://localhost:3000',
    adminEmails = [],
    limits = {},
  } = {},
) {
  const limiter = Object.fromEntries(
    Object.entries({ ...DEFAULT_LIMITS, ...limits }).map(([name, opts]) => [name, createLimiter(opts)]),
  );

  // Throws 429 if any of the given limiter keys is over its limit, otherwise counts this attempt.
  function throttle(checks, { count = true } = {}) {
    for (const [name, key] of checks) {
      const wait = limiter[name].blockedFor(key);
      if (wait) {
        const minutes = Math.ceil(wait / 60);
        throw new HttpError(429, `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      }
    }
    if (count) for (const [name, key] of checks) limiter[name].hit(key);
  }
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const isAdmin = (account) => admins.has(account.email.toLowerCase());

  function publicAccount(a) {
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      businessName: a.business_name,
      phone: a.phone,
      status: a.status,
      emailVerified: Boolean(a.email_verified_at),
      isAdmin: isAdmin(a),
    };
  }

  // Emails go out after the HTTP reply, so a slow or failing provider never blocks or breaks a request.
  function notify(email) {
    sendEmail(email).catch((err) => console.error(`Failed to email ${email.to}:`, err.message));
  }

  const q = {
    accountByEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
    accountBySession: db.prepare(
      'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ? AND a.frozen_at IS NULL',
    ),
    insertAccount: db.prepare(`
      INSERT INTO accounts (email, password_hash, name, role, business_name, phone, status, terms_accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`),
    setPassword: db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?'),
    markVerified: db.prepare("UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?"),
    deleteTokens: db.prepare('DELETE FROM tokens WHERE account_id = ? AND purpose = ?'),
    insertToken: db.prepare(
      "INSERT INTO tokens (token_hash, account_id, purpose, expires_at) VALUES (?, ?, ?, datetime('now', ?))",
    ),
    tokenByHash: db.prepare(
      "SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND expires_at > datetime('now')",
    ),
    deleteToken: db.prepare('DELETE FROM tokens WHERE token_hash = ?'),
    setAccountStatus: db.prepare('UPDATE accounts SET status = ? WHERE id = ?'),
    freezeAccount: db.prepare("UPDATE accounts SET frozen_at = datetime('now'), frozen_reason = ? WHERE id = ?"),
    unfreezeAccount: db.prepare('UPDATE accounts SET frozen_at = NULL, frozen_reason = NULL WHERE id = ?'),
    deleteSessionsFor: db.prepare('DELETE FROM sessions WHERE account_id = ?'),
    touchLogin: db.prepare("UPDATE accounts SET last_login_at = datetime('now') WHERE id = ?"),
    adminAccountById: db.prepare(`SELECT a.*, ${ACCOUNT_COUNTS} FROM accounts a WHERE a.id = ?`),
    adminRequestsByUser: db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM responses x WHERE x.request_id = r.id) AS response_count
      FROM requests r WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC`),
    adminResponsesByDealer: db.prepare(`
      SELECT x.*, r.make, r.model, r.trim, r.year_min, r.year_max, r.status AS request_status
      FROM responses x JOIN requests r ON r.id = x.request_id
      WHERE x.dealer_id = ? ORDER BY x.created_at DESC, x.id DESC`),
    adminResponsesForRequest: db.prepare(`
      SELECT x.*, a.name AS dealer_name, a.business_name, a.email AS dealer_email, a.phone AS dealer_phone,
        a.frozen_at AS dealer_frozen_at
      FROM responses x JOIN accounts a ON a.id = x.dealer_id
      WHERE x.request_id = ? ORDER BY x.created_at ASC, x.id ASC`),
    accountById: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token, account_id) VALUES (?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    insertRequest: db.prepare(`
      INSERT INTO requests (user_id, make, model, trim, year_min, year_max, max_budget, condition, color, location, notes)
      VALUES (:user_id, :make, :model, :trim, :year_min, :year_max, :max_budget, :condition, :color, :location, :notes)`),
    updateRequest: db.prepare(`
      UPDATE requests SET make = :make, model = :model, trim = :trim, year_min = :year_min, year_max = :year_max,
        max_budget = :max_budget, condition = :condition, color = :color, location = :location, notes = :notes
      WHERE id = :id`),
    updateStatus: db.prepare('UPDATE requests SET status = ? WHERE id = ?'),
    hideRequest: db.prepare("UPDATE requests SET hidden_at = datetime('now'), hidden_reason = ? WHERE id = ?"),
    unhideRequest: db.prepare('UPDATE requests SET hidden_at = NULL, hidden_reason = NULL WHERE id = ?'),
    deleteRequest: db.prepare('DELETE FROM requests WHERE id = ?'),
    requestById: db.prepare(`
      SELECT r.*, a.name AS requester_name, a.email AS requester_email, a.frozen_at AS requester_frozen_at,
        (SELECT COUNT(*) FROM visible_responses x WHERE x.request_id = r.id) AS response_count
      FROM requests r JOIN accounts a ON a.id = r.user_id WHERE r.id = ?`),
    requestsByUser: db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM visible_responses x WHERE x.request_id = r.id) AS response_count
      FROM requests r WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC`),
    responsesForRequest: db.prepare(`
      SELECT x.*, a.name AS dealer_name, a.business_name, a.email AS dealer_email, a.phone AS dealer_phone
      FROM visible_responses x JOIN accounts a ON a.id = x.dealer_id
      WHERE x.request_id = ? ORDER BY x.created_at ASC, x.id ASC`),
    responsesForRequestByDealer: db.prepare(`
      SELECT x.*, a.name AS dealer_name, a.business_name, a.email AS dealer_email, a.phone AS dealer_phone
      FROM responses x JOIN accounts a ON a.id = x.dealer_id
      WHERE x.request_id = ? AND x.dealer_id = ? ORDER BY x.created_at ASC, x.id ASC`),
    insertResponse: db.prepare('INSERT INTO responses (request_id, dealer_id, message, price) VALUES (?, ?, ?, ?)'),
    responseById: db.prepare(`
      SELECT x.*, a.name AS dealer_name, a.business_name, a.email AS dealer_email, a.phone AS dealer_phone
      FROM responses x JOIN accounts a ON a.id = x.dealer_id WHERE x.id = ?`),
    distinctMakes: db.prepare(
      "SELECT DISTINCT make FROM visible_requests WHERE status = 'open' ORDER BY make COLLATE NOCASE",
    ),
  };

  function currentAccount(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token ? q.accountBySession.get(token) : undefined;
  }

  function requireAccount(req, role) {
    const account = currentAccount(req);
    if (!account) throw new HttpError(401, 'Please log in');
    if (role && account.role !== role) throw new HttpError(403, `Only ${role}s can do that`);
    if (account.role === 'dealer') requireApproved(account);
    return account;
  }

  function requireApproved(account) {
    if (account.status === 'pending') throw new HttpError(403, 'Your dealer account is waiting for approval');
    if (account.status === 'rejected') throw new HttpError(403, 'Your dealer account was not approved');
  }

  function requireVerified(account) {
    if (!account.email_verified_at) {
      throw new HttpError(403, 'Please confirm your email address first — check your inbox for the link we sent.');
    }
  }

  // Creates a one-time email link token, replacing any earlier one for the same purpose.
  function issueToken(accountId, purpose, minutes) {
    const token = newSessionToken();
    q.deleteTokens.run(accountId, purpose);
    q.insertToken.run(hashToken(token), accountId, purpose, `+${minutes} minutes`);
    return token;
  }

  // Returns the token's row and burns it, or null if it's unknown, used or expired.
  function consumeToken(token, purpose) {
    const row = token ? q.tokenByHash.get(hashToken(String(token)), purpose) : undefined;
    if (!row) return null;
    q.deleteToken.run(row.token_hash);
    return row;
  }

  function sendVerification(account) {
    const token = issueToken(account.id, 'verify', 7 * 24 * 60);
    notify(verifyEmail({ account, link: `${appUrl}/#/verify?token=${token}` }));
  }

  function requireAdmin(req) {
    const account = currentAccount(req);
    if (!account) throw new HttpError(401, 'Please log in');
    if (!isAdmin(account)) throw new HttpError(403, 'Admins only');
    return account;
  }

  function startSession(res, accountId, status, payload) {
    const token = newSessionToken();
    q.insertSession.run(token, accountId);
    q.touchLogin.run(accountId);
    sendJson(res, status, payload, { 'Set-Cookie': sessionCookie(token, { secure: secureCookies }) });
  }

  function loadRequest(id) {
    const row = q.requestById.get(id);
    if (!row) throw new HttpError(404, 'Request not found');
    return row;
  }

  // Hidden requests and those from frozen accounts don't exist as far as dealers are concerned.
  function assertVisibleToDealers(request) {
    if (request.hidden_at || request.requester_frozen_at) throw new HttpError(404, 'Request not found');
  }

  // Everything an admin sees about a request, including who posted it and moderation state.
  function adminRequestPayload(row) {
    return {
      ...serializeRequest(row),
      hiddenAt: row.hidden_at,
      hiddenReason: row.hidden_reason,
      requester: {
        id: row.user_id,
        name: row.requester_name,
        email: row.requester_email,
        frozen: Boolean(row.requester_frozen_at),
      },
    };
  }

  // Admin list of every request, with search, filters and sorting.
  function searchAdminRequests(params) {
    const where = [];
    const args = {};
    const status = oneOf(params.get('status') || undefined, 'status', [...STATUSES, 'all'], 'open');
    if (status !== 'all') {
      where.push('r.status = :status');
      args.status = status;
    }
    const visibility = oneOf(params.get('visibility') || undefined, 'visibility', ['all', 'visible', 'hidden'], 'all');
    if (visibility === 'hidden') where.push('(r.hidden_at IS NOT NULL OR a.frozen_at IS NOT NULL)');
    if (visibility === 'visible') where.push('r.hidden_at IS NULL AND a.frozen_at IS NULL');

    const text = str(params.get('q'), 'q', { max: 100 });
    if (text) {
      text.split(/\s+/).slice(0, 8).forEach((word, i) => {
        where.push(`(r.make LIKE :w${i} ESCAPE '\\' OR r.model LIKE :w${i} ESCAPE '\\' OR r.trim LIKE :w${i} ESCAPE '\\'
          OR r.notes LIKE :w${i} ESCAPE '\\' OR r.location LIKE :w${i} ESCAPE '\\' OR a.name LIKE :w${i} ESCAPE '\\'
          OR a.email LIKE :w${i} ESCAPE '\\' OR CAST(r.id AS TEXT) = :n${i})`);
        args[`w${i}`] = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        args[`n${i}`] = word.replace(/^#/, '');
      });
    }
    const sortKey = oneOf(params.get('sort') || undefined, 'sort', Object.keys(SORTS), 'newest');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT r.*, a.name AS requester_name, a.email AS requester_email, a.frozen_at AS requester_frozen_at,
          (SELECT COUNT(*) FROM responses x WHERE x.request_id = r.id) AS response_count
        FROM requests r JOIN accounts a ON a.id = r.user_id
        ${whereSql}
        ORDER BY ${SORTS[sortKey]}
        LIMIT 500`)
      .all(args);
    return { status, visibility, sort: sortKey, requests: rows.map(adminRequestPayload) };
  }

  function adminAccountPayload(id) {
    const account = q.adminAccountById.get(id);
    if (!account) throw new HttpError(404, 'Account not found');
    return serializeAdminAccount(account, isAdmin(account));
  }

  // Admin list of users or dealers, with search, status filter and sorting.
  function searchAccounts(params) {
    const role = oneOf(params.get('role') || undefined, 'role', ['user', 'dealer'], 'dealer');
    const status = oneOf(params.get('status') || undefined, 'status', ACCOUNT_FILTERS, 'all');
    const sortKey = oneOf(params.get('sort') || undefined, 'sort', Object.keys(ACCOUNT_SORTS), 'newest');
    const where = ['a.role = :role'];
    const args = { role };

    if (status === 'frozen') where.push('a.frozen_at IS NOT NULL');
    else if (status !== 'all') {
      where.push('a.frozen_at IS NULL AND a.status = :status');
      args.status = status;
    }
    const text = str(params.get('q'), 'q', { max: 100 });
    if (text) {
      where.push("(a.name LIKE :text ESCAPE '\\' OR a.email LIKE :text ESCAPE '\\' OR a.business_name LIKE :text ESCAPE '\\' OR a.phone LIKE :text ESCAPE '\\')");
      args.text = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }

    const rows = db
      .prepare(`SELECT a.*, ${ACCOUNT_COUNTS} FROM accounts a WHERE ${where.join(' AND ')} ORDER BY ${ACCOUNT_SORTS[sortKey]} LIMIT 500`)
      .all(args);
    return { role, status, sort: sortKey, accounts: rows.map((a) => serializeAdminAccount(a, isAdmin(a))) };
  }

  function adminStats() {
    const one = (sql) => db.prepare(sql).get().n;
    return {
      users: one("SELECT COUNT(*) AS n FROM accounts WHERE role = 'user'"),
      dealersApproved: one("SELECT COUNT(*) AS n FROM accounts WHERE role = 'dealer' AND status = 'active' AND frozen_at IS NULL"),
      dealersPending: one("SELECT COUNT(*) AS n FROM accounts WHERE role = 'dealer' AND status = 'pending' AND frozen_at IS NULL"),
      frozen: one('SELECT COUNT(*) AS n FROM accounts WHERE frozen_at IS NOT NULL'),
      openRequests: one("SELECT COUNT(*) AS n FROM visible_requests WHERE status = 'open'"),
      hiddenRequests: one("SELECT COUNT(*) AS n FROM requests WHERE hidden_at IS NOT NULL AND status = 'open'"),
      requestsLast7Days: one("SELECT COUNT(*) AS n FROM requests WHERE created_at >= datetime('now', '-7 days')"),
      responsesLast7Days: one("SELECT COUNT(*) AS n FROM responses WHERE created_at >= datetime('now', '-7 days')"),
      newAccountsLast7Days: one("SELECT COUNT(*) AS n FROM accounts WHERE created_at >= datetime('now', '-7 days')"),
    };
  }

  // Dealer-facing search over open requests.
  function searchRequests(params) {
    const where = [];
    const args = {};

    const status = oneOf(params.get('status') || undefined, 'status', [...STATUSES, 'all'], 'open');
    if (status !== 'all') {
      where.push('r.status = :status');
      args.status = status;
    }

    const text = str(params.get('q'), 'q', { max: 100 });
    if (text) {
      // Every word must match somewhere, so "porsche 911 turbo" narrows instead of widening.
      text.split(/\s+/).slice(0, 8).forEach((word, i) => {
        where.push(`(r.make LIKE :w${i} ESCAPE '\\' OR r.model LIKE :w${i} ESCAPE '\\' OR r.trim LIKE :w${i} ESCAPE '\\'
          OR r.color LIKE :w${i} ESCAPE '\\' OR r.location LIKE :w${i} ESCAPE '\\' OR r.notes LIKE :w${i} ESCAPE '\\'
          OR :y${i} BETWEEN COALESCE(r.year_min, r.year_max) AND COALESCE(r.year_max, r.year_min))`);
        args[`w${i}`] = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        // A 4-digit word like "1987" also matches any request whose year range covers it.
        args[`y${i}`] = /^\d{4}$/.test(word) ? Number(word) : -1;
      });
    }

    const make = str(params.get('make'), 'make', { max: 60 });
    if (make) {
      where.push('r.make = :make COLLATE NOCASE');
      args.make = make;
    }

    const condition = oneOf(params.get('condition') || undefined, 'condition', CONDITIONS, null);
    if (condition && condition !== 'any') {
      // A buyer who said "any" is still a match for a dealer holding a specific condition.
      where.push("(r.condition = :condition OR r.condition = 'any')");
      args.condition = condition;
    }

    // Year filter: show requests whose wanted range overlaps the dealer's range.
    const year = int(params.get('year'), 'year', { min: 1885, max: MAX_YEAR });
    if (year) {
      where.push('(r.year_min IS NULL OR r.year_min <= :year) AND (r.year_max IS NULL OR r.year_max >= :year)');
      args.year = year;
    }

    const minBudget = int(params.get('minBudget'), 'minBudget', { max: 100_000_000 });
    if (minBudget !== null) {
      where.push('(r.max_budget IS NULL OR r.max_budget >= :minBudget)');
      args.minBudget = minBudget;
    }

    const sortKey = oneOf(params.get('sort') || undefined, 'sort', Object.keys(SORTS), 'newest');
    const limit = int(params.get('limit'), 'limit', { min: 1, max: 100 }) ?? 50;
    const offset = int(params.get('offset'), 'offset', { min: 0 }) ?? 0;

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM visible_requests r ${whereSql}`).get(args).n;
    const rows = db
      .prepare(`
        SELECT r.*, a.name AS requester_name,
          (SELECT COUNT(*) FROM visible_responses x WHERE x.request_id = r.id) AS response_count
        FROM visible_requests r JOIN accounts a ON a.id = r.user_id
        ${whereSql}
        ORDER BY ${SORTS[sortKey]}
        LIMIT :limit OFFSET :offset`)
      .all({ ...args, limit, offset });

    return { total, limit, offset, sort: sortKey, requests: rows.map(serializeRequest) };
  }

  const routes = [
    ['POST', /^\/api\/signup$/, async (req, res) => {
      const body = await readJson(req);
      const email = str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
      const password = String(body.password ?? '');
      if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      const name = str(body.name, 'Name', { required: true, max: 100 });
      const role = oneOf(body.role, 'Account type', ['user', 'dealer'], null);
      if (!role) throw new HttpError(400, 'Account type is required');
      const businessName = str(body.businessName, 'Business name', { required: role === 'dealer', max: 120 });
      const phone = str(body.phone, 'Phone', { max: 40 });
      if (body.acceptTerms !== true) throw new HttpError(400, 'Please accept the Terms of Service and Privacy Policy');
      if (q.accountByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists');
      throttle([['signupPerIp', clientIp(req)]]);

      const status = role === 'dealer' && !admins.has(email) ? 'pending' : 'active';
      const { lastInsertRowid } = q.insertAccount.run(email, hashPassword(password), name, role, businessName, phone, status);
      const account = q.accountById.get(lastInsertRowid);
      startSession(res, account.id, 201, { account: publicAccount(account) });
      sendVerification(account);

      if (status === 'pending') {
        for (const to of admins) notify(newDealerEmail({ dealer: account, to, appUrl }));
      }
    }],

    ['POST', /^\/api\/login$/, async (req, res) => {
      const body = await readJson(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      const ip = clientIp(req);
      const checks = [
        ['loginPerAccount', `${email}|${ip}`],
        ['loginPerIp', ip],
      ];
      throttle(checks, { count: false });
      const account = q.accountByEmail.get(email);
      if (!account || !verifyPassword(String(body.password ?? ''), account.password_hash)) {
        throttle(checks); // only failed attempts count
        throw new HttpError(401, 'Incorrect email or password');
      }
      limiter.loginPerAccount.reset(`${email}|${ip}`);
      if (account.frozen_at) throw new HttpError(403, 'This account has been frozen. Please contact CarsFindMe support.');
      startSession(res, account.id, 200, { account: publicAccount(account) });
    }],

    ['POST', /^\/api\/logout$/, async (req, res) => {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) q.deleteSession.run(token);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }],

    // --- email verification & password reset ---

    ['POST', /^\/api\/verify$/, async (req, res) => {
      const row = consumeToken((await readJson(req)).token, 'verify');
      if (!row) throw new HttpError(400, 'This link is invalid or has expired. Log in and ask for a new one.');
      q.markVerified.run(row.account_id);
      sendJson(res, 200, { ok: true });
    }],

    ['POST', /^\/api\/verify\/resend$/, async (req, res) => {
      const account = currentAccount(req);
      if (!account) throw new HttpError(401, 'Please log in');
      if (account.email_verified_at) return sendJson(res, 200, { ok: true, alreadyVerified: true });
      throttle([
        ['emailPerAccount', `verify:${account.id}`],
        ['emailPerIp', clientIp(req)],
      ]);
      sendVerification(account);
      sendJson(res, 200, { ok: true });
    }],

    // Always answers the same way, so it can't be used to find out who has an account.
    ['POST', /^\/api\/password\/forgot$/, async (req, res) => {
      const email = str((await readJson(req)).email, 'Email', { required: true, max: 200 }).toLowerCase();
      throttle([
        ['emailPerAccount', `reset:${email}`],
        ['emailPerIp', clientIp(req)],
      ]);
      const account = q.accountByEmail.get(email);
      sendJson(res, 200, { ok: true });
      if (account) {
        const token = issueToken(account.id, 'reset', 60);
        notify(passwordResetEmail({ account, link: `${appUrl}/#/reset?token=${token}` }));
      }
    }],

    ['POST', /^\/api\/password\/reset$/, async (req, res) => {
      const body = await readJson(req);
      const password = String(body.password ?? '');
      if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      const row = consumeToken(body.token, 'reset');
      if (!row) throw new HttpError(400, 'This reset link is invalid or has expired. Please ask for a new one.');

      q.setPassword.run(hashPassword(password), row.account_id);
      q.markVerified.run(row.account_id); // they proved they own the inbox
      q.deleteSessionsFor.run(row.account_id); // sign out everywhere else
      const account = q.accountById.get(row.account_id);
      if (account.frozen_at) return sendJson(res, 200, { ok: true, account: null });
      startSession(res, account.id, 200, { ok: true, account: publicAccount(account) });
    }],

    ['GET', /^\/api\/me$/, async (req, res) => {
      const account = currentAccount(req);
      sendJson(res, 200, { account: account ? publicAccount(account) : null });
    }],

    // --- users (buyers) ---

    ['POST', /^\/api\/requests$/, async (req, res) => {
      const account = requireAccount(req, 'user');
      requireVerified(account);
      const fields = parseRequestFields(await readJson(req));
      const { lastInsertRowid } = q.insertRequest.run({ ...fields, user_id: account.id });
      sendJson(res, 201, { request: serializeRequest(loadRequest(lastInsertRowid)) });
    }],

    ['GET', /^\/api\/my\/requests$/, async (req, res) => {
      const account = requireAccount(req, 'user');
      sendJson(res, 200, { requests: q.requestsByUser.all(account.id).map(serializeRequest) });
    }],

    ['PATCH', /^\/api\/requests\/(\d+)$/, async (req, res, [id]) => {
      const account = requireAccount(req, 'user');
      const existing = loadRequest(Number(id));
      if (existing.user_id !== account.id) throw new HttpError(403, 'You can only edit your own requests');
      const body = await readJson(req);

      if (Object.keys(body).some((k) => k !== 'status')) {
        q.updateRequest.run({ ...parseRequestFields({ ...toBodyShape(existing), ...body }), id: existing.id });
      }
      if (body.status !== undefined) {
        q.updateStatus.run(oneOf(body.status, 'Status', STATUSES, existing.status), existing.id);
      }
      sendJson(res, 200, { request: serializeRequest(loadRequest(existing.id)) });
    }],

    // --- dealers ---

    ['GET', /^\/api\/requests$/, async (req, res, _m, url) => {
      requireAccount(req, 'dealer');
      sendJson(res, 200, searchRequests(url.searchParams));
    }],

    ['GET', /^\/api\/makes$/, async (req, res) => {
      requireAccount(req, 'dealer');
      sendJson(res, 200, { makes: q.distinctMakes.all().map((r) => r.make) });
    }],

    ['POST', /^\/api\/requests\/(\d+)\/responses$/, async (req, res, [id]) => {
      const account = requireAccount(req, 'dealer');
      requireVerified(account);
      const request = loadRequest(Number(id));
      assertVisibleToDealers(request);
      if (request.status !== 'open') throw new HttpError(409, 'This request is no longer open');
      const body = await readJson(req);
      const message = str(body.message, 'Message', { required: true, max: 2000 });
      const price = int(body.price, 'Price', { min: 0, max: 100_000_000 });
      const { lastInsertRowid } = q.insertResponse.run(request.id, account.id, message, price);
      const response = q.responseById.get(lastInsertRowid);
      sendJson(res, 201, { response: serializeResponse(response) });
      notify(newResponseEmail({ request, response, dealer: account, buyer: q.accountById.get(request.user_id), appUrl }));
    }],

    // --- admin ---

    // A consistent copy of the whole database, for safekeeping.
    ['GET', /^\/api\/admin\/backup$/, async (req, res) => {
      requireAdmin(req);
      const dir = await mkdtemp(join(tmpdir(), 'carsfindme-backup-'));
      const file = join(dir, 'backup.db');
      try {
        db.prepare('VACUUM INTO ?').run(file);
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.sqlite3',
          'Content-Disposition': `attachment; filename="carsfindme-backup-${new Date().toISOString().slice(0, 10)}.db"`,
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }],

    ['GET', /^\/api\/admin\/stats$/, async (req, res) => {
      requireAdmin(req);
      sendJson(res, 200, { stats: adminStats() });
    }],

    ['GET', /^\/api\/admin\/accounts$/, async (req, res, _m, url) => {
      requireAdmin(req);
      sendJson(res, 200, searchAccounts(url.searchParams));
    }],

    ['GET', /^\/api\/admin\/accounts\/(\d+)$/, async (req, res, [id]) => {
      requireAdmin(req);
      const account = adminAccountPayload(Number(id));
      const requests = account.role === 'user' ? q.adminRequestsByUser.all(account.id).map(serializeRequest) : [];
      const responses =
        account.role === 'dealer'
          ? q.adminResponsesByDealer.all(account.id).map((x) => ({
              id: x.id,
              requestId: x.request_id,
              message: x.message,
              price: x.price,
              createdAt: x.created_at,
              request: serializeRequest({ ...x, id: x.request_id, status: x.request_status, created_at: undefined }),
            }))
          : [];
      sendJson(res, 200, { account, requests, responses });
    }],

    // Approve / reject a dealer, and freeze / unfreeze any account.
    ['PATCH', /^\/api\/admin\/accounts\/(\d+)$/, async (req, res, [id]) => {
      const me = requireAdmin(req);
      const target = q.accountById.get(Number(id));
      if (!target) throw new HttpError(404, 'Account not found');
      const body = await readJson(req);

      if (body.status !== undefined) {
        if (target.role !== 'dealer') throw new HttpError(400, 'Only dealer accounts have an approval status');
        q.setAccountStatus.run(oneOf(body.status, 'Status', ACCOUNT_STATUSES, target.status), target.id);
      }
      if (body.frozen === true) {
        if (target.id === me.id || isAdmin(target)) throw new HttpError(400, "Admin accounts can't be frozen");
        q.freezeAccount.run(str(body.reason, 'Reason', { max: 500 }), target.id);
        q.deleteSessionsFor.run(target.id); // signs them out everywhere
      } else if (body.frozen === false) {
        q.unfreezeAccount.run(target.id);
      }
      if (body.verified === true) q.markVerified.run(target.id);

      sendJson(res, 200, { account: adminAccountPayload(target.id) });
      if (body.status === 'active' && target.status !== 'active') notify(dealerApprovedEmail({ dealer: target, appUrl }));
    }],

    ['GET', /^\/api\/admin\/requests$/, async (req, res, _m, url) => {
      requireAdmin(req);
      sendJson(res, 200, searchAdminRequests(url.searchParams));
    }],

    // Edit any field, change status, and hide / unhide a request.
    ['PATCH', /^\/api\/admin\/requests\/(\d+)$/, async (req, res, [id]) => {
      requireAdmin(req);
      const existing = loadRequest(Number(id));
      const { status, hidden, reason, ...fields } = await readJson(req);

      if (Object.keys(fields).length) {
        q.updateRequest.run({ ...parseRequestFields({ ...toBodyShape(existing), ...fields }), id: existing.id });
      }
      if (status !== undefined) q.updateStatus.run(oneOf(status, 'Status', STATUSES, existing.status), existing.id);
      if (hidden === true) q.hideRequest.run(str(reason, 'Reason', { max: 500 }), existing.id);
      else if (hidden === false) q.unhideRequest.run(existing.id);

      sendJson(res, 200, { request: adminRequestPayload(loadRequest(existing.id)) });
    }],

    // Permanent: also removes every dealer response to the request.
    ['DELETE', /^\/api\/admin\/requests\/(\d+)$/, async (req, res, [id]) => {
      requireAdmin(req);
      const request = loadRequest(Number(id));
      q.deleteRequest.run(request.id);
      sendJson(res, 200, { ok: true, deletedId: request.id });
    }],

    // --- shared ---

    ['GET', /^\/api\/requests\/(\d+)$/, async (req, res, [id]) => {
      const account = requireAccount(req);
      const admin = isAdmin(account);
      const request = loadRequest(Number(id));
      let viewer;
      let responses;
      if (account.role === 'user' && request.user_id === account.id) {
        viewer = 'owner';
        responses = q.responsesForRequest.all(request.id).map(serializeResponse);
      } else if (admin) {
        // Admins see every response, including ones hidden because the dealer is frozen.
        viewer = 'admin';
        responses = q.adminResponsesForRequest.all(request.id).map((x) => ({
          ...serializeResponse(x),
          dealerFrozen: Boolean(x.dealer_frozen_at),
        }));
      } else if (account.role === 'dealer') {
        // Dealers see only their own replies, not competitors'.
        assertVisibleToDealers(request);
        viewer = 'dealer';
        responses = q.responsesForRequestByDealer.all(request.id, account.id).map(serializeResponse);
      } else {
        throw new HttpError(404, 'Request not found');
      }
      const payload = viewer === 'admin' ? adminRequestPayload(request) : serializeRequest(request);
      sendJson(res, 200, { viewer, request: payload, responses });
    }],
  ];

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, pattern, handler] of routes) {
          const match = url.pathname.match(pattern);
          if (match && req.method === method) return await handler(req, res, match.slice(1), url);
        }
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      await serveStatic(res, url.pathname);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      const status = err instanceof HttpError ? err.status : 500;
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong' : err.message });
      else res.end();
    }
  };
}

// Converts a DB row back into the API's camelCase body shape so partial PATCHes can be merged.
function toBodyShape(r) {
  return {
    make: r.make,
    model: r.model,
    trim: r.trim,
    yearMin: r.year_min,
    yearMax: r.year_max,
    maxBudget: r.max_budget,
    condition: r.condition,
    color: r.color,
    location: r.location,
    notes: r.notes,
  };
}
