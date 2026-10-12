import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, newSessionToken } from './auth.js';
import { newResponseEmail, newDealerEmail, dealerApprovedEmail } from './email.js';

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

function serializeDealer(a) {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    businessName: a.business_name,
    phone: a.phone,
    status: a.status,
    createdAt: a.created_at,
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

export function createApp(
  db,
  { secureCookies = false, sendEmail = async () => {}, appUrl = 'http://localhost:3000', adminEmails = [] } = {},
) {
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
      'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ?',
    ),
    insertAccount: db.prepare(
      'INSERT INTO accounts (email, password_hash, name, role, business_name, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    dealersByStatus: db.prepare(`
      SELECT a.*, (SELECT COUNT(*) FROM responses x WHERE x.dealer_id = a.id) AS response_count
      FROM accounts a WHERE a.role = 'dealer' AND a.status = ? ORDER BY a.created_at DESC, a.id DESC`),
    dealerCounts: db.prepare("SELECT status, COUNT(*) AS n FROM accounts WHERE role = 'dealer' GROUP BY status"),
    setAccountStatus: db.prepare('UPDATE accounts SET status = ? WHERE id = ?'),
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
    requestById: db.prepare(`
      SELECT r.*, a.name AS requester_name,
        (SELECT COUNT(*) FROM responses x WHERE x.request_id = r.id) AS response_count
      FROM requests r JOIN accounts a ON a.id = r.user_id WHERE r.id = ?`),
    requestsByUser: db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM responses x WHERE x.request_id = r.id) AS response_count
      FROM requests r WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC`),
    responsesForRequest: db.prepare(`
      SELECT x.*, a.name AS dealer_name, a.business_name, a.email AS dealer_email, a.phone AS dealer_phone
      FROM responses x JOIN accounts a ON a.id = x.dealer_id
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
      "SELECT DISTINCT make FROM requests WHERE status = 'open' ORDER BY make COLLATE NOCASE",
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

  function requireAdmin(req) {
    const account = currentAccount(req);
    if (!account) throw new HttpError(401, 'Please log in');
    if (!isAdmin(account)) throw new HttpError(403, 'Admins only');
    return account;
  }

  function startSession(res, accountId, status, payload) {
    const token = newSessionToken();
    q.insertSession.run(token, accountId);
    sendJson(res, status, payload, { 'Set-Cookie': sessionCookie(token, { secure: secureCookies }) });
  }

  function loadRequest(id) {
    const row = q.requestById.get(id);
    if (!row) throw new HttpError(404, 'Request not found');
    return row;
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
    const total = db.prepare(`SELECT COUNT(*) AS n FROM requests r ${whereSql}`).get(args).n;
    const rows = db
      .prepare(`
        SELECT r.*, a.name AS requester_name,
          (SELECT COUNT(*) FROM responses x WHERE x.request_id = r.id) AS response_count
        FROM requests r JOIN accounts a ON a.id = r.user_id
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
      if (q.accountByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists');

      const status = role === 'dealer' && !admins.has(email) ? 'pending' : 'active';
      const { lastInsertRowid } = q.insertAccount.run(email, hashPassword(password), name, role, businessName, phone, status);
      const account = q.accountById.get(lastInsertRowid);
      startSession(res, account.id, 201, { account: publicAccount(account) });

      if (status === 'pending') {
        for (const to of admins) notify(newDealerEmail({ dealer: account, to, appUrl }));
      }
    }],

    ['POST', /^\/api\/login$/, async (req, res) => {
      const body = await readJson(req);
      const account = q.accountByEmail.get(String(body.email ?? '').trim().toLowerCase());
      if (!account || !verifyPassword(String(body.password ?? ''), account.password_hash)) {
        throw new HttpError(401, 'Incorrect email or password');
      }
      startSession(res, account.id, 200, { account: publicAccount(account) });
    }],

    ['POST', /^\/api\/logout$/, async (req, res) => {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) q.deleteSession.run(token);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }],

    ['GET', /^\/api\/me$/, async (req, res) => {
      const account = currentAccount(req);
      sendJson(res, 200, { account: account ? publicAccount(account) : null });
    }],

    // --- users (buyers) ---

    ['POST', /^\/api\/requests$/, async (req, res) => {
      const account = requireAccount(req, 'user');
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
      const request = loadRequest(Number(id));
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

    ['GET', /^\/api\/admin\/dealers$/, async (req, res, _m, url) => {
      requireAdmin(req);
      const status = oneOf(url.searchParams.get('status') || undefined, 'status', ACCOUNT_STATUSES, 'pending');
      const counts = Object.fromEntries(ACCOUNT_STATUSES.map((s) => [s, 0]));
      for (const row of q.dealerCounts.all()) counts[row.status] = row.n;
      sendJson(res, 200, { status, counts, dealers: q.dealersByStatus.all(status).map(serializeDealer) });
    }],

    ['PATCH', /^\/api\/admin\/dealers\/(\d+)$/, async (req, res, [id]) => {
      requireAdmin(req);
      const dealer = q.accountById.get(Number(id));
      if (!dealer || dealer.role !== 'dealer') throw new HttpError(404, 'Dealer not found');
      const status = oneOf((await readJson(req)).status, 'Status', ACCOUNT_STATUSES, null);
      if (!status) throw new HttpError(400, 'Status is required');
      q.setAccountStatus.run(status, dealer.id);
      sendJson(res, 200, { dealer: serializeDealer(q.accountById.get(dealer.id)) });
      if (status === 'active' && dealer.status !== 'active') notify(dealerApprovedEmail({ dealer, appUrl }));
    }],

    // --- shared ---

    ['GET', /^\/api\/requests\/(\d+)$/, async (req, res, [id]) => {
      const account = requireAccount(req);
      const request = loadRequest(Number(id));
      let responses;
      if (account.role === 'user') {
        if (request.user_id !== account.id) throw new HttpError(404, 'Request not found');
        responses = q.responsesForRequest.all(request.id);
      } else {
        // Dealers see only their own replies, not competitors'.
        responses = q.responsesForRequestByDealer.all(request.id, account.id);
      }
      sendJson(res, 200, { request: serializeRequest(request), responses: responses.map(serializeResponse) });
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
