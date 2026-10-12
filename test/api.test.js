import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;
let testDb;
let uploadsDir;
let app;
// A stand-in for Google's signing key, so tests exercise the real token checks.
const googleKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const googleJwk = { ...googleKey.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
function googleToken(claims, { key = googleKey.privateKey, kid = 'test-key' } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc({
    iss: 'https://accounts.google.com', aud: 'test-client.apps.googleusercontent.com',
    exp: Math.floor(Date.now() / 1000) + 3600, email_verified: true, ...claims,
  })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}
const sentEmails = [];
let failNextEmail = false;

before(async () => {
  const sendEmail = async (email) => {
    if (failNextEmail) {
      failNextEmail = false;
      throw new Error('mail provider down');
    }
    sentEmails.push(email);
  };
  testDb = openDatabase(':memory:');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  uploadsDir = mkdtempSync(`${tmpdir()}/cf-uploads-`);
  server = createServer(app = createApp(testDb, {
    sendEmail,
    appUrl: 'https://cars.test',
    adminEmails: ['Admin@test.com', ' ', 'boss@test.com'],
    uploadsDir,
    googleClientId: 'test-client.apps.googleusercontent.com',
    fetchGoogleCerts: async () => ({ keys: [googleJwk] }),
    // Tests create many accounts from one address; keep the real login limits so they're tested.
    limits: { signupPerIp: { max: 10_000, windowMs: 60_000 }, emailPerIp: { max: 10_000, windowMs: 60_000 } },
  }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Tiny cookie-keeping client so each test actor has its own session.
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  call.cookie = () => cookie;
  return call;
}

let n = 0;
let adminClient;

const tick = () => new Promise((r) => setTimeout(r, 20));

// Finds the most recent email to an address and pulls the token out of its link.
async function tokenFromEmail(to, path) {
  await tick();
  const email = [...sentEmails].reverse().find((e) => e.to === to && e.text.includes(`/#/${path}?token=`));
  assert.ok(email, `no ${path} email sent to ${to}`);
  return email.text.match(new RegExp(`/#/${path}\\?token=([\\w-]+)`))[1];
}

async function confirmEmail(call, email) {
  const res = await call('POST', '/api/verify', { token: await tokenFromEmail(email, 'verify') });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function admin() {
  if (!adminClient) {
    adminClient = client();
    await adminClient('POST', '/api/signup', {
      email: 'admin@test.com', password: 'password123', name: 'Ada Admin', role: 'user', acceptTerms: true,
    });
  }
  return adminClient;
}

// What a licensed dealer fills in at signup.
const DEALER_APPLICATION = {
  businessName: 'Test Motors',
  dealerType: 'dealer',
  jobTitle: 'Owner',
  phone: '555-0100',
  businessAddress: '1 Main St, Miami, FL',
  website: 'testmotors.example',
  licenseNumber: 'VI-12345',
  licenseState: 'Florida',
};

async function completeChecks(id) {
  const adminCall = await admin();
  for (const check of ['license', 'web', 'call']) {
    const res = await adminCall('PATCH', `/api/admin/accounts/${id}`, { check, done: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
}

// Signs up an account and confirms its email. Dealers are approved by the admin unless
// { approve: false } is passed; pass { verify: false } to leave the email unconfirmed.
async function signup(role, { approve = true, verify = true, ...extra } = {}) {
  const call = client();
  const res = await call('POST', '/api/signup', {
    email: `${role}${++n}@test.com`,
    password: 'password123',
    name: `Test ${role}`,
    role,
    ...(role === 'dealer' ? DEALER_APPLICATION : {}),
    acceptTerms: true,
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  call.account = res.body.account;
  if (verify) await confirmEmail(call, call.account.email);
  if (role === 'dealer' && approve) {
    await completeChecks(call.account.id);
    const approved = await (await admin())('PATCH', `/api/admin/accounts/${call.account.id}`, { status: 'active' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
  }
  return call;
}

test('signup validates input and rejects duplicates', async () => {
  const call = client();
  assert.equal((await call('POST', '/api/signup', { email: 'x@y.com', password: 'short', name: 'X', role: 'user' })).status, 400);
  assert.equal((await call('POST', '/api/signup', { email: 'x@y.com', password: 'password123', name: 'X', role: 'admin' })).status, 400);
  assert.equal((await call('POST', '/api/signup', { email: 'd@y.com', password: 'password123', name: 'D', role: 'dealer' })).status, 400, 'dealer needs business name');
  assert.equal((await call('POST', '/api/signup', { email: 'x@y.com', password: 'password123', name: 'X', role: 'user' })).status, 400, 'must accept terms');
  assert.equal((await call('POST', '/api/signup', { email: 'x@y.com', password: 'password123', name: 'X', role: 'user', acceptTerms: true })).status, 201);
  assert.equal((await client()('POST', '/api/signup', { email: 'X@Y.com', password: 'password123', name: 'X', role: 'user', acceptTerms: true })).status, 409);
});

test('login, me and logout', async () => {
  await signup('user', { email: 'login@test.com' });
  const call = client();
  assert.equal((await call('POST', '/api/login', { email: 'login@test.com', password: 'wrong-pass' })).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'LOGIN@test.com', password: 'password123' })).status, 200);
  assert.equal((await call('GET', '/api/me')).body.account.email, 'login@test.com');
  await call('POST', '/api/logout');
  assert.equal((await call('GET', '/api/me')).body.account, null);
});

test('only users can post requests; only dealers can browse', async () => {
  const user = await signup('user');
  const dealer = await signup('dealer');

  assert.equal((await dealer('POST', '/api/requests', { make: 'Porsche', model: '911' })).status, 403);
  assert.equal((await user('POST', '/api/requests', { make: 'Porsche' })).status, 400, 'model required');
  assert.equal((await user('POST', '/api/requests', { make: 'Porsche', model: '911', yearMin: 1990, yearMax: 1980 })).status, 400);

  const created = await user('POST', '/api/requests', {
    make: 'Porsche', model: '911 Carrera', yearMin: '1987', yearMax: '1987', maxBudget: '85000', condition: 'excellent',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.request.yearMin, 1987);

  assert.equal((await user('GET', '/api/requests')).status, 403);
  assert.equal((await client()('GET', '/api/requests')).status, 401);
  assert.equal((await dealer('GET', '/api/requests')).status, 200);
});

test('dealer search, filters and sorting', async () => {
  const user = await signup('user');
  const dealer = await signup('dealer');
  const post = (r) => user('POST', '/api/requests', r);
  await post({ make: 'Zeta', model: 'Alpha', yearMin: 1985, yearMax: 1989, maxBudget: 50000, location: 'Austin, TX', condition: 'excellent' });
  await post({ make: 'Zeta', model: 'Beta', yearMin: 2001, yearMax: 2003, maxBudget: 20000, condition: 'project' });
  await post({ make: 'Zeta', model: 'Gamma 100%', notes: 'any year' });

  const search = async (qs) => {
    const res = await dealer('GET', `/api/requests?make=zeta&${qs}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.requests.map((r) => r.model);
  };

  assert.deepEqual((await search('sort=oldest')), ['Alpha', 'Beta', 'Gamma 100%']);
  assert.deepEqual(await search('q=austin'), ['Alpha']);
  assert.deepEqual(await search('q=zeta%201987'), ['Alpha'], 'year inside range matches text search');
  assert.deepEqual(await search('q=100%25'), ['Gamma 100%'], 'LIKE wildcards are escaped');
  assert.deepEqual(await search('year=2002&sort=oldest'), ['Beta', 'Gamma 100%'], 'no-year requests match any year');
  assert.deepEqual(await search('minBudget=30000&sort=oldest'), ['Alpha', 'Gamma 100%']);
  assert.deepEqual(await search('condition=project&sort=oldest'), ['Beta', 'Gamma 100%'], "'any' condition matches");
  assert.deepEqual(await search('sort=budget_desc'), ['Alpha', 'Beta', 'Gamma 100%'], 'nulls last');
  assert.deepEqual(await search('sort=budget_asc'), ['Beta', 'Alpha', 'Gamma 100%']);
  assert.deepEqual(await search('sort=year_desc'), ['Beta', 'Alpha', 'Gamma 100%']);
  assert.deepEqual(await search('sort=oldest&limit=1&offset=1'), ['Beta']);

  assert.equal((await dealer('GET', '/api/requests?sort=id;DROP TABLE requests')).status, 400);
  assert.equal((await dealer('GET', '/api/makes')).body.makes.includes('Zeta'), true);
});

test('dealers respond; buyers see responses with contact info; dealers do not see competitors', async () => {
  const user = await signup('user', { name: 'Pat Buyer' });
  const other = await signup('user');
  const dealerA = await signup('dealer', { phone: '555-0100' });
  const dealerB = await signup('dealer');

  const { body } = await user('POST', '/api/requests', { make: 'BMW', model: 'M3' });
  const id = body.request.id;

  const listed = (await dealerA('GET', '/api/requests?q=M3')).body.requests.find((r) => r.id === id);
  assert.equal(listed.requesterName, 'Pat', 'dealers only see first name');

  assert.equal((await user('POST', `/api/requests/${id}/responses`, { message: 'hi' })).status, 403);
  assert.equal((await dealerA('POST', `/api/requests/${id}/responses`, {})).status, 400);
  assert.equal((await dealerA('POST', `/api/requests/${id}/responses`, { message: 'Have one', price: '61000' })).status, 201);
  assert.equal((await dealerB('POST', `/api/requests/${id}/responses`, { message: 'Can source one' })).status, 201);

  const ownerView = await user('GET', `/api/requests/${id}`);
  assert.equal(ownerView.body.responses.length, 2);
  assert.equal(ownerView.body.responses[0].price, 61000);
  assert.equal(ownerView.body.responses[0].dealer.phone, '555-0100');

  const dealerView = await dealerB('GET', `/api/requests/${id}`);
  assert.equal(dealerView.body.responses.length, 1);
  assert.equal(dealerView.body.responses[0].message, 'Can source one');

  assert.equal((await other('GET', `/api/requests/${id}`)).status, 404, 'other buyers cannot view');
  assert.equal((await other('PATCH', `/api/requests/${id}`, { status: 'closed' })).status, 403);

  const mine = (await user('GET', '/api/my/requests')).body.requests;
  assert.equal(mine.find((r) => r.id === id).responseCount, 2);
});

test('closing a request hides it from dealers and blocks responses', async () => {
  const user = await signup('user');
  const dealer = await signup('dealer');
  const { body } = await user('POST', '/api/requests', { make: 'Datsun', model: '240Z Unique' });
  const id = body.request.id;

  const patched = await user('PATCH', `/api/requests/${id}`, { status: 'fulfilled' });
  assert.equal(patched.body.request.status, 'fulfilled');
  assert.equal(patched.body.request.model, '240Z Unique', 'status-only patch keeps other fields');

  assert.equal((await dealer('GET', '/api/requests?q=Unique')).body.total, 0);
  assert.equal((await dealer('GET', '/api/requests?q=Unique&status=all')).body.total, 1);
  assert.equal((await dealer('POST', `/api/requests/${id}/responses`, { message: 'late' })).status, 409);

  const edited = await user('PATCH', `/api/requests/${id}`, { maxBudget: 30000, status: 'open' });
  assert.equal(edited.body.request.maxBudget, 30000);
  assert.equal(edited.body.request.status, 'open');
});

test('serves the app and blocks path traversal', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /CarsFindMe/);
  const traversal = await fetch(`${base}/..%2fsrc%2fapp.js`);
  assert.doesNotMatch(await traversal.text(), /createApp/);
});

test('buyer gets an email when a dealer responds', async () => {
  const user = await signup('user', { email: 'alerts@test.com', name: 'Casey Jones' });
  const dealer = await signup('dealer', { email: 'sales@motors.test', businessName: 'Motors <b>& Co</b>', phone: '555-0199' });
  const { body } = await user('POST', '/api/requests', { make: 'Porsche', model: '911 Carrera', yearMin: 1987, yearMax: 1987 });
  const id = body.request.id;

  sentEmails.length = 0;
  await dealer('POST', `/api/requests/${id}/responses`, { message: 'Have one <script>', price: 87500 });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(sentEmails.length, 1);
  const [email] = sentEmails;
  assert.equal(email.to, 'alerts@test.com');
  assert.equal(email.replyTo, 'sales@motors.test');
  assert.equal(email.subject, 'Motors <b>& Co</b> responded to your 1987 Porsche 911 Carrera request');
  assert.match(email.text, /Hi Casey,/);
  assert.match(email.text, /\$87,500/);
  assert.match(email.text, /555-0199/);
  assert.match(email.text, new RegExp(`https://cars.test/#/request/${id}`));
  assert.match(email.html, /Motors &lt;b&gt;&amp; Co&lt;\/b&gt;/, 'dealer-supplied text is escaped in HTML');
  assert.doesNotMatch(email.html, /<script>/);

  failNextEmail = true;
  const res = await dealer('POST', `/api/requests/${id}/responses`, { message: 'Second offer' });
  assert.equal(res.status, 201, 'email failure does not fail the response');
});

test('new dealers wait for admin approval before seeing requests', async () => {
  const adminCall = await admin();
  const buyer = await signup('user');
  await buyer('POST', '/api/requests', { make: 'Lancia', model: 'Delta Integrale' });

  sentEmails.length = 0;
  const dealer = await signup('dealer', { approve: false, businessName: 'Rally Imports', email: 'rally@test.com', phone: '555-0111' });
  assert.equal(dealer.account.status, 'pending');
  assert.equal(dealer.account.isAdmin, false);
  await new Promise((r) => setTimeout(r, 20));
  const alerts = sentEmails.filter((e) => /waiting for approval/.test(e.subject));
  assert.deepEqual(alerts.map((e) => e.to).sort(), ['admin@test.com', 'boss@test.com'], 'every admin is told');
  assert.ok(sentEmails.some((e) => e.to === 'rally@test.com' && /Confirm your/.test(e.subject)), 'dealer is asked to confirm');
  assert.match(alerts[0].subject, /Rally Imports/);
  assert.match(alerts[0].text, /555-0111/);

  // Pending dealers can log in but cannot see or answer requests.
  assert.equal((await dealer('GET', '/api/me')).body.account.status, 'pending');
  for (const path of ['/api/requests', '/api/makes', '/api/requests/1']) {
    const res = await dealer('GET', path);
    assert.equal(res.status, 403, path);
    assert.match(res.body.error, /waiting for approval/);
  }
  assert.equal((await dealer('POST', '/api/requests/1/responses', { message: 'hi' })).status, 403);

  // Only admins can see and manage dealers.
  for (const path of ['/api/admin/accounts', '/api/admin/stats', `/api/admin/accounts/${dealer.account.id}`]) {
    assert.equal((await buyer('GET', path)).status, 403, path);
    assert.equal((await client()('GET', path)).status, 401, path);
  }
  assert.equal((await buyer('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'active' })).status, 403);

  const pending = await adminCall('GET', '/api/admin/accounts?role=dealer&status=pending');
  assert.equal(pending.status, 200);
  assert.ok(pending.body.accounts.some((d) => d.email === 'rally@test.com'));
  assert.ok((await adminCall('GET', '/api/admin/stats')).body.stats.dealersPending >= 1);
  assert.equal((await adminCall('GET', '/api/me')).body.account.isAdmin, true);
  assert.equal((await adminCall('PATCH', `/api/admin/accounts/${buyer.account.id}`, { status: 'active' })).status, 400, 'buyers have no approval status');
  assert.equal((await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'bogus' })).status, 400);

  // Approving needs the verification checks done; then it lets them in and emails them.
  const early = await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'active' });
  assert.equal(early.status, 400);
  assert.match(early.body.error, /Finish verifying/);
  await completeChecks(dealer.account.id);
  sentEmails.length = 0;
  assert.equal((await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'active' })).body.account.status, 'active');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'rally@test.com');
  assert.match(sentEmails[0].subject, /approved/);
  assert.equal((await dealer('GET', '/api/requests?q=Integrale')).body.total, 1);

  // Revoking cuts access again, without another email.
  sentEmails.length = 0;
  await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'rejected' });
  const blocked = await dealer('GET', '/api/requests');
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /not approved/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sentEmails.length, 0);

  const rejected = await adminCall('GET', '/api/admin/accounts?role=dealer&status=rejected');
  assert.ok(rejected.body.accounts.some((d) => d.email === 'rally@test.com'));
});

test('an admin who signs up as a dealer is approved automatically', async () => {
  const res = await client()('POST', '/api/signup', {
    ...DEALER_APPLICATION, email: 'Boss@test.com', password: 'password123', name: 'Boss', role: 'dealer', businessName: 'Boss Cars', acceptTerms: true,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.account.status, 'active');
  assert.equal(res.body.account.isAdmin, true);
});

test('upgrading an existing database keeps existing dealers approved', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/cf-`)}/old.db`;

  // The accounts table as it was before dealer approval existed.
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user', 'dealer')), business_name TEXT, phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  old.exec("INSERT INTO accounts (email, password_hash, name, role) VALUES ('old@dealer.com', 'x:y', 'Old', 'dealer')");
  old.exec(`CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    make TEXT NOT NULL, model TEXT NOT NULL, trim TEXT, year_min INTEGER, year_max INTEGER, max_budget INTEGER,
    condition TEXT NOT NULL DEFAULT 'any', color TEXT, location TEXT, notes TEXT,
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  old.exec("INSERT INTO requests (user_id, make, model) VALUES (1, 'Porsche', '964 RS')");
  old.close();

  const db = openDatabase(file);
  const row = db.prepare("SELECT status, frozen_at, last_login_at, email_verified_at FROM accounts WHERE email = 'old@dealer.com'").get();
  assert.equal(row.status, 'active');
  assert.ok(row.email_verified_at, 'existing accounts count as confirmed');
  assert.equal(row.frozen_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visible_requests').get().n, 1, 'old requests stay visible');
  assert.ok(db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'hidden_at'));
  db.close();
  openDatabase(file).close(); // running the migration twice is harmless
});

test('admins can list, search and inspect users and dealers', async () => {
  const adminCall = await admin();
  const buyer = await signup('user', { name: 'Quinn Searchable', email: 'quinn@search.test', phone: '555-0177' });
  const dealer = await signup('dealer', { businessName: 'Searchable Motors', email: 'sm@search.test' });
  const { body } = await buyer('POST', '/api/requests', { make: 'BMW', model: 'M3 CSL' });
  await dealer('POST', `/api/requests/${body.request.id}/responses`, { message: 'Have one', price: 120000 });

  const users = await adminCall('GET', '/api/admin/accounts?role=user&q=searchable');
  assert.equal(users.status, 200);
  assert.deepEqual(users.body.accounts.map((a) => a.email), ['quinn@search.test']);
  const [quinn] = users.body.accounts;
  assert.equal(quinn.requestCount, 1);
  assert.equal(quinn.openRequestCount, 1);
  assert.ok(quinn.lastLoginAt, 'signing up counts as a login');
  assert.equal(quinn.frozen, false);

  const byPhone = await adminCall('GET', '/api/admin/accounts?role=user&q=555-0177');
  assert.equal(byPhone.body.accounts.length, 1);
  const dealers = await adminCall('GET', '/api/admin/accounts?role=dealer&q=Searchable%20Motors&sort=activity');
  assert.equal(dealers.body.accounts[0].responseCount, 1);
  assert.equal((await adminCall('GET', '/api/admin/accounts?sort=bogus')).status, 400);

  const userDetail = await adminCall('GET', `/api/admin/accounts/${buyer.account.id}`);
  assert.equal(userDetail.body.account.phone, '555-0177');
  assert.equal(userDetail.body.requests[0].model, 'M3 CSL');
  const dealerDetail = await adminCall('GET', `/api/admin/accounts/${dealer.account.id}`);
  assert.equal(dealerDetail.body.responses[0].price, 120000);
  assert.equal(dealerDetail.body.responses[0].request.model, 'M3 CSL');
  assert.equal((await adminCall('GET', '/api/admin/accounts/999999')).status, 404);

  // Admins can open any request, see every response with contacts, and close it.
  const asAdmin = await adminCall('GET', `/api/requests/${body.request.id}`);
  assert.equal(asAdmin.body.viewer, 'admin');
  assert.equal(asAdmin.body.request.requester.email, 'quinn@search.test');
  assert.equal(asAdmin.body.responses[0].dealer.email, 'sm@search.test');
  const closed = await adminCall('PATCH', `/api/admin/requests/${body.request.id}`, { status: 'closed' });
  assert.equal(closed.body.request.status, 'closed');
  assert.equal((await buyer('PATCH', `/api/admin/requests/${body.request.id}`, { status: 'open' })).status, 403);
  assert.equal((await buyer('GET', `/api/requests/${body.request.id}`)).body.viewer, 'owner');
});

test('freezing a user signs them out, blocks login and hides their requests', async () => {
  const adminCall = await admin();
  const buyer = await signup('user', { email: 'frozen-buyer@test.com' });
  const dealer = await signup('dealer');
  const { body } = await buyer('POST', '/api/requests', { make: 'Ferrari', model: 'F40 Frozen' });
  const id = body.request.id;
  assert.equal((await dealer('GET', '/api/requests?q=Frozen')).body.total, 1);

  const frozen = await adminCall('PATCH', `/api/admin/accounts/${buyer.account.id}`, { frozen: true, reason: 'Spam' });
  assert.equal(frozen.body.account.frozen, true);
  assert.equal(frozen.body.account.frozenReason, 'Spam');

  assert.equal((await buyer('GET', '/api/me')).body.account, null, 'existing session is ended');
  assert.equal((await buyer('GET', '/api/my/requests')).status, 401);
  const login = await client()('POST', '/api/login', { email: 'frozen-buyer@test.com', password: 'password123' });
  assert.equal(login.status, 403);
  assert.match(login.body.error, /frozen/);

  assert.equal((await dealer('GET', '/api/requests?q=Frozen')).body.total, 0, 'hidden from dealer search');
  assert.equal((await dealer('GET', `/api/requests/${id}`)).status, 404);
  assert.equal((await dealer('POST', `/api/requests/${id}/responses`, { message: 'hi' })).status, 404);
  assert.ok(!(await dealer('GET', '/api/makes')).body.makes.includes('Ferrari'), 'make filter skips frozen requests');
  assert.equal((await adminCall('GET', `/api/requests/${id}`)).body.request.requester.frozen, true, 'admins still see it');
  assert.ok((await adminCall('GET', '/api/admin/accounts?role=user&status=frozen')).body.accounts.some((a) => a.email === 'frozen-buyer@test.com'));
  assert.ok(!(await adminCall('GET', '/api/admin/accounts?role=user&status=active')).body.accounts.some((a) => a.email === 'frozen-buyer@test.com'));

  await adminCall('PATCH', `/api/admin/accounts/${buyer.account.id}`, { frozen: false });
  const again = client();
  assert.equal((await again('POST', '/api/login', { email: 'frozen-buyer@test.com', password: 'password123' })).status, 200);
  assert.equal((await dealer('GET', '/api/requests?q=Frozen')).body.total, 1, 'visible again after unfreezing');
});

test("freezing a dealer hides their responses from buyers; admins can't be frozen", async () => {
  const adminCall = await admin();
  const buyer = await signup('user');
  const good = await signup('dealer', { businessName: 'Good Cars' });
  const bad = await signup('dealer', { businessName: 'Shady Cars' });
  const { body } = await buyer('POST', '/api/requests', { make: 'Porsche', model: '993 Turbo' });
  const id = body.request.id;
  await good('POST', `/api/requests/${id}/responses`, { message: 'Legit offer' });
  await bad('POST', `/api/requests/${id}/responses`, { message: 'Wire me a deposit' });
  assert.equal((await buyer('GET', `/api/requests/${id}`)).body.responses.length, 2);

  await adminCall('PATCH', `/api/admin/accounts/${bad.account.id}`, { frozen: true });
  const view = await buyer('GET', `/api/requests/${id}`);
  assert.deepEqual(view.body.responses.map((x) => x.message), ['Legit offer']);
  assert.equal(view.body.request.responseCount, 1);
  assert.equal((await buyer('GET', '/api/my/requests')).body.requests.find((r) => r.id === id).responseCount, 1);
  assert.equal((await bad('GET', '/api/requests')).status, 401, 'frozen dealer is signed out');

  const adminView = await adminCall('GET', `/api/requests/${id}`);
  assert.equal(adminView.body.responses.length, 2);
  assert.equal(adminView.body.responses.find((x) => x.message.startsWith('Wire')).dealerFrozen, true);

  const adminAccount = (await adminCall('GET', '/api/me')).body.account;
  const self = await adminCall('PATCH', `/api/admin/accounts/${adminAccount.id}`, { frozen: true });
  assert.equal(self.status, 400);
  assert.match(self.body.error, /can't be frozen/);
  assert.ok((await adminCall('GET', '/api/admin/stats')).body.stats.frozen >= 1);
});

test('admins can list, edit, hide and delete any request', async () => {
  const adminCall = await admin();
  const buyer = await signup('user', { name: 'Morgan Moderated', email: 'moderated@test.com' });
  const dealer = await signup('dealer');
  const { body } = await buyer('POST', '/api/requests', { make: 'Honda', model: 'Accord', notes: 'any color' });
  const id = body.request.id;
  await dealer('POST', `/api/requests/${id}/responses`, { message: 'Got one' });

  // Listing and search, including by buyer email and #id.
  const list = await adminCall('GET', '/api/admin/requests?q=moderated@test.com');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.requests.map((r) => r.id), [id]);
  assert.equal(list.body.requests[0].requester.name, 'Morgan Moderated');
  assert.equal(list.body.requests[0].responseCount, 1);
  assert.equal((await adminCall('GET', `/api/admin/requests?q=%23${id}&status=all`)).body.requests[0].id, id);
  assert.equal((await buyer('GET', '/api/admin/requests')).status, 403);
  assert.equal((await adminCall('GET', '/api/admin/requests?visibility=bogus')).status, 400);

  // Editing merges fields; clearing a field removes it; validation still applies.
  const edited = await adminCall('PATCH', `/api/admin/requests/${id}`, { model: 'Accord Euro R', notes: '', yearMin: 2000, yearMax: 2002 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.request.model, 'Accord Euro R');
  assert.equal(edited.body.request.make, 'Honda');
  assert.equal(edited.body.request.notes, null);
  assert.equal((await adminCall('PATCH', `/api/admin/requests/${id}`, { yearMin: 2005, yearMax: 2001 })).status, 400);
  assert.equal((await adminCall('PATCH', `/api/admin/requests/${id}`, { make: '' })).status, 400);
  assert.equal((await buyer('PATCH', `/api/admin/requests/${id}`, { model: 'x' })).status, 403);

  // Hiding takes it off the dealer side but the buyer still sees it, flagged.
  const hidden = await adminCall('PATCH', `/api/admin/requests/${id}`, { hidden: true, reason: 'Not a specialty car' });
  assert.equal(hidden.body.request.hidden, true);
  assert.equal(hidden.body.request.hiddenReason, 'Not a specialty car');
  assert.equal((await dealer('GET', '/api/requests?q=Euro')).body.total, 0);
  assert.equal((await dealer('GET', `/api/requests/${id}`)).status, 404);
  assert.equal((await dealer('POST', `/api/requests/${id}/responses`, { message: 'again' })).status, 404);
  const ownView = await buyer('GET', `/api/requests/${id}`);
  assert.equal(ownView.body.request.hidden, true);
  assert.equal(ownView.body.request.hiddenReason, undefined, 'reason is for admins only');
  assert.equal((await buyer('GET', '/api/my/requests')).body.requests.find((r) => r.id === id).hidden, true);
  assert.deepEqual((await adminCall('GET', '/api/admin/requests?visibility=hidden&q=Euro')).body.requests.map((r) => r.id), [id]);
  assert.equal((await adminCall('GET', '/api/admin/requests?visibility=visible&q=Euro')).body.requests.length, 0);
  assert.ok((await adminCall('GET', '/api/admin/stats')).body.stats.hiddenRequests >= 1);

  await adminCall('PATCH', `/api/admin/requests/${id}`, { hidden: false });
  assert.equal((await dealer('GET', '/api/requests?q=Euro')).body.total, 1, 'unhidden');

  // Deleting removes the request and its responses for good.
  const deleted = await adminCall('DELETE', `/api/admin/requests/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await buyer('GET', `/api/requests/${id}`)).status, 404);
  assert.equal((await adminCall('GET', `/api/requests/${id}`)).status, 404);
  assert.equal((await buyer('GET', '/api/my/requests')).body.requests.some((r) => r.id === id), false);
  assert.equal((await adminCall('GET', `/api/admin/accounts/${dealer.account.id}`)).body.responses.length, 0, 'responses removed too');
  assert.equal((await adminCall('DELETE', `/api/admin/requests/${id}`)).status, 404);
  assert.equal((await buyer('DELETE', `/api/admin/requests/1`)).status, 403);
});

test('new accounts must confirm their email before posting or responding', async () => {
  const buyer = await signup('user', { verify: false, email: 'unverified@test.com' });
  assert.equal(buyer.account.emailVerified, false);
  const blocked = await buyer('POST', '/api/requests', { make: 'Porsche', model: '959' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /confirm your email/);

  const dealer = await signup('dealer', { verify: false, email: 'unverified-dealer@test.com' });
  const poster = await signup('user');
  const { body } = await poster('POST', '/api/requests', { make: 'Porsche', model: '959 Komfort' });
  assert.equal((await dealer('GET', `/api/requests?q=Komfort`)).body.total, 1, 'unverified dealers can still browse');
  assert.equal((await dealer('POST', `/api/requests/${body.request.id}/responses`, { message: 'hi' })).status, 403);

  // Resend issues a fresh link and the old one stops working.
  const firstToken = await tokenFromEmail('unverified@test.com', 'verify');
  assert.equal((await buyer('POST', '/api/verify/resend')).status, 200);
  const secondToken = await tokenFromEmail('unverified@test.com', 'verify');
  assert.notEqual(firstToken, secondToken);
  assert.equal((await client()('POST', '/api/verify', { token: firstToken })).status, 400);

  // The link works without being signed in, and only once.
  assert.equal((await client()('POST', '/api/verify', { token: secondToken })).status, 200);
  assert.equal((await client()('POST', '/api/verify', { token: secondToken })).status, 400);
  assert.equal((await client()('POST', '/api/verify', { token: 'garbage' })).status, 400);
  assert.equal((await buyer('GET', '/api/me')).body.account.emailVerified, true);
  assert.equal((await buyer('POST', '/api/requests', { make: 'Porsche', model: '959' })).status, 201);
  assert.equal((await buyer('POST', '/api/verify/resend')).body.alreadyVerified, true);

  // Admins can confirm an address by hand.
  const adminCall = await admin();
  const marked = await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { verified: true });
  assert.equal(marked.body.account.emailVerified, true);
  assert.ok(marked.body.account.termsAcceptedAt);
  assert.equal((await dealer('POST', `/api/requests/${body.request.id}/responses`, { message: 'hi' })).status, 201);
});

test('forgot password emails a one-time link that sets a new password', async () => {
  const user = await signup('user', { email: 'forgetful@test.com' });
  const other = client();
  await other('POST', '/api/login', { email: 'forgetful@test.com', password: 'password123' });

  // Same answer whether or not the account exists, and no email for unknown addresses.
  sentEmails.length = 0;
  assert.deepEqual((await client()('POST', '/api/password/forgot', { email: 'nobody@test.com' })).body, { ok: true });
  await tick();
  assert.equal(sentEmails.length, 0);
  assert.deepEqual((await client()('POST', '/api/password/forgot', { email: 'Forgetful@test.com' })).body, { ok: true });
  const token = await tokenFromEmail('forgetful@test.com', 'reset');

  const anon = client();
  assert.equal((await anon('POST', '/api/password/reset', { token, password: 'short' })).status, 400);
  const reset = await anon('POST', '/api/password/reset', { token, password: 'new-password-1' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.account.email, 'forgetful@test.com', 'signed in after resetting');
  assert.equal((await anon('GET', '/api/me')).body.account.email, 'forgetful@test.com');
  assert.equal((await anon('POST', '/api/password/reset', { token, password: 'another-pass' })).status, 400, 'one use only');

  assert.equal((await user('GET', '/api/me')).body.account, null, 'old sessions are signed out');
  assert.equal((await other('GET', '/api/me')).body.account, null);
  assert.equal((await client()('POST', '/api/login', { email: 'forgetful@test.com', password: 'password123' })).status, 401);
  assert.equal((await client()('POST', '/api/login', { email: 'forgetful@test.com', password: 'new-password-1' })).status, 200);
});

test('reset links expire and stop working after a newer one is sent', async () => {
  await signup('user', { email: 'expiry@test.com' });
  await client()('POST', '/api/password/forgot', { email: 'expiry@test.com' });
  const older = await tokenFromEmail('expiry@test.com', 'reset');
  await client()('POST', '/api/password/forgot', { email: 'expiry@test.com' });
  const newer = await tokenFromEmail('expiry@test.com', 'reset');
  assert.equal((await client()('POST', '/api/password/reset', { token: older, password: 'whatever-123' })).status, 400);

  // Simulate an hour passing by rewinding the stored expiry.
  testDb.prepare("UPDATE tokens SET expires_at = datetime('now', '-1 minute') WHERE purpose = 'reset'").run();
  const expired = await client()('POST', '/api/password/reset', { token: newer, password: 'whatever-123' });
  assert.equal(expired.status, 400);
  assert.match(expired.body.error, /expired/);
});

test('repeated wrong passwords lock that email out for a while', async () => {
  await signup('user', { email: 'target@test.com' });
  const attacker = client();
  for (let i = 0; i < 5; i++) {
    assert.equal((await attacker('POST', '/api/login', { email: 'target@test.com', password: `guess-${i}` })).status, 401);
  }
  const locked = await attacker('POST', '/api/login', { email: 'target@test.com', password: 'password123' });
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  assert.match(locked.body.error, /Too many attempts.*minutes?/);

  // Reset emails are limited per address too.
  for (let i = 0; i < 3; i++) assert.equal((await client()('POST', '/api/password/forgot', { email: 'spam@test.com' })).status, 200);
  assert.equal((await client()('POST', '/api/password/forgot', { email: 'spam@test.com' })).status, 429);
});

test('admins can download a full database backup', async () => {
  const adminCall = await admin();
  const res = await fetch(`${base}/api/admin/backup`, { headers: { Cookie: adminCall.cookie() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="carsfindme-backup-\d{4}-\d{2}-\d{2}\.db"/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');

  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/cf-`)}/b.db`;
  writeFileSync(file, bytes);
  const copy = new DatabaseSync(file);
  assert.ok(copy.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = 'admin@test.com'").get().n === 1);
  copy.close();

  const buyer = await signup('user');
  assert.equal((await buyer('GET', '/api/admin/backup')).status, 403);
});

test('dealers get new-request alerts that match their settings', async () => {
  const buyer = await signup('user');
  const everything = await signup('dealer', { email: 'alerts-all@test.com' });
  const porscheOnly = await signup('dealer', { email: 'alerts-porsche@test.com' });
  const bigTicket = await signup('dealer', { email: 'alerts-big@test.com' });
  const muted = await signup('dealer', { email: 'alerts-off@test.com' });
  await signup('dealer', { email: 'alerts-pending@test.com', approve: false });
  await signup('dealer', { email: 'alerts-unverified@test.com', verify: false });

  assert.deepEqual((await everything('GET', '/api/me')).body.account.alerts, { mode: 'all', makes: [], minBudget: null });
  assert.equal((await porscheOnly('PUT', '/api/me/alerts', { mode: 'makes', makes: 'Porsche, porsche , Mercedes' })).status, 200);
  assert.deepEqual((await porscheOnly('GET', '/api/me')).body.account.alerts.makes, ['porsche', 'mercedes-benz'], 'saved as standard makes');
  await bigTicket('PUT', '/api/me/alerts', { mode: 'all', minBudget: 100000 });
  await muted('PUT', '/api/me/alerts', { mode: 'off' });
  assert.equal((await porscheOnly('PUT', '/api/me/alerts', { mode: 'makes', makes: '' })).status, 400);
  assert.equal((await porscheOnly('PUT', '/api/me/alerts', { mode: 'sometimes' })).status, 400);
  assert.equal((await buyer('PUT', '/api/me/alerts', { mode: 'all' })).status, 403);

  const alertsFor = async (make, model, maxBudget) => {
    sentEmails.length = 0;
    await buyer('POST', '/api/requests', { make, model, maxBudget });
    await tick();
    // Dealers from earlier tests get alerts too (on by default); look only at this test's dealers.
    return sentEmails
      .filter((e) => e.subject.startsWith('New request') && e.to.startsWith('alerts-'))
      .map((e) => e.to)
      .sort();
  };

  assert.deepEqual(await alertsFor('Porsche', '911 GT3', 180000), ['alerts-all@test.com', 'alerts-big@test.com', 'alerts-porsche@test.com']);
  assert.deepEqual(await alertsFor('BMW', 'M3', 60000), ['alerts-all@test.com']);
  assert.deepEqual(await alertsFor('Mercedes-Benz', '190E', null), ['alerts-all@test.com', 'alerts-big@test.com', 'alerts-porsche@test.com'],
    'loose make match, and no budget counts as a match');

  // The email has the details, a link, and a working one-click unsubscribe.
  sentEmails.length = 0;
  await buyer('POST', '/api/requests', { make: 'Porsche', model: '993 RS', maxBudget: 250000, notes: 'Riviera Blue' });
  await tick();
  const email = sentEmails.find((e) => e.to === 'alerts-porsche@test.com');
  assert.equal(email.subject, 'New request: Porsche 993 RS — up to $250,000');
  assert.match(email.text, /Riviera Blue/);
  assert.match(email.text, /https:\/\/cars\.test\/#\/request\/\d+/);
  const unsubscribeUrl = email.headers['List-Unsubscribe'].slice(1, -1);
  assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Mail apps POST to the header URL with a form body.
  const oneClick = await fetch(unsubscribeUrl.replace('https://cars.test', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(oneClick.status, 200);
  assert.equal((await porscheOnly('GET', '/api/me')).body.account.alerts.mode, 'off');
  assert.deepEqual(await alertsFor('Porsche', 'Carrera GT', 1500000), ['alerts-all@test.com', 'alerts-big@test.com']);

  // The visible link in the email works too (via the page, which posts the token).
  const token = email.text.match(/#\/unsubscribe\?token=([\w-]+)/)[1];
  assert.equal((await client()('POST', '/api/alerts/unsubscribe', { token })).status, 200);
  assert.equal((await client()('POST', '/api/alerts/unsubscribe', { token: 'nope' })).status, 400);

  // Frozen dealers don't get alerts.
  const adminCall = await admin();
  await adminCall('PATCH', `/api/admin/accounts/${everything.account.id}`, { frozen: true });
  assert.deepEqual(await alertsFor('Ferrari', 'F50', 5000000), ['alerts-big@test.com']);
});

test('dealers can attach photos to a response', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const buyer = await signup('user', { email: 'photo-buyer@test.com' });
  const dealer = await signup('dealer', { businessName: 'Photo Motors' });
  const { body } = await buyer('POST', '/api/requests', { make: 'Porsche', model: '911 R' });
  const id = body.request.id;

  // Tiny stand-ins with real image signatures.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')]);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('png body')]);
  const dataUrl = (buf, type) => `data:${type};base64,${buf.toString('base64')}`;

  const bad = (photos) => dealer('POST', `/api/requests/${id}/responses`, { message: 'x', photos });
  assert.equal((await bad([dataUrl(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml')])).status, 400, 'not a real image');
  assert.equal((await bad(['https://example.com/a.jpg'])).status, 400);
  assert.equal((await bad(Array(7).fill(dataUrl(jpeg, 'image/jpeg')))).status, 400, 'max 6');
  assert.equal((await bad('nope')).status, 400);

  sentEmails.length = 0;
  const res = await dealer('POST', `/api/requests/${id}/responses`, {
    message: 'Here it is',
    photos: [dataUrl(jpeg, 'image/jpeg'), dataUrl(png, 'image/png')],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const [first, second] = res.body.response.photos;
  assert.match(first, /^\/uploads\/[a-f0-9]{32}\.jpg$/);
  assert.match(second, /\.png$/);

  // Served back byte-for-byte with long caching; bad names are refused.
  const served = await fetch(base + first);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  assert.match(served.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${base}/uploads/..%2fapp.js`)).status, 404);
  assert.equal((await fetch(`${base}/uploads/${'0'.repeat(32)}.jpg`)).status, 404);

  // The buyer sees them on the request and in the email.
  const view = await buyer('GET', `/api/requests/${id}`);
  assert.deepEqual(view.body.responses[0].photos, [first, second]);
  await tick();
  const email = sentEmails.find((e) => e.to === 'photo-buyer@test.com');
  assert.ok(email.html.includes(`https://cars.test${first}`));
  assert.match(email.text, /2 photos attached/);

  // Deleting the request removes the files too.
  const files = res.body.response.photos.map((p) => p.split('/').pop());
  assert.ok(files.every((f) => existsSync(`${uploadsDir}/${f}`)));
  await (await admin())('DELETE', `/api/admin/requests/${id}`);
  assert.ok(files.every((f) => !readdirSync(uploadsDir).includes(f)));
});

test('users and dealers can set and remove a profile picture', async () => {
  const { existsSync } = await import('node:fs');
  const buyer = await signup('user', { name: 'Avery Avatar' });
  const dealer = await signup('dealer', { businessName: 'Avatar Autos' });
  const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('face')]).toString('base64')}`;

  assert.equal((await buyer('GET', '/api/me')).body.account.avatarUrl, null);
  assert.equal((await buyer('PUT', '/api/me/avatar', {})).status, 400);
  assert.equal((await buyer('PUT', '/api/me/avatar', { photo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  assert.equal((await client()('PUT', '/api/me/avatar', { photo: jpeg })).status, 401);

  const first = (await buyer('PUT', '/api/me/avatar', { photo: jpeg })).body.account.avatarUrl;
  assert.match(first, /^\/uploads\/[a-f0-9]{32}\.jpg$/);
  assert.equal((await fetch(base + first)).status, 200);

  // Replacing deletes the old file.
  const second = (await buyer('PUT', '/api/me/avatar', { photo: jpeg })).body.account.avatarUrl;
  assert.notEqual(first, second);
  assert.equal(existsSync(`${uploadsDir}/${first.split('/').pop()}`), false);

  // Dealers' pictures show on their responses; buyers' on their requests.
  const dealerPic = (await dealer('PUT', '/api/me/avatar', { photo: jpeg })).body.account.avatarUrl;
  const { body } = await buyer('POST', '/api/requests', { make: 'Porsche', model: '356 Speedster' });
  await dealer('POST', `/api/requests/${body.request.id}/responses`, { message: 'Have one' });
  assert.equal((await buyer('GET', `/api/requests/${body.request.id}`)).body.responses[0].dealer.avatarUrl, dealerPic);
  assert.equal((await dealer('GET', `/api/requests/${body.request.id}`)).body.request.requesterAvatarUrl, second);
  const adminList = await (await admin())('GET', '/api/admin/accounts?role=user&q=Avery');
  assert.equal(adminList.body.accounts[0].avatarUrl, second);

  const removed = await buyer('DELETE', '/api/me/avatar');
  assert.equal(removed.body.account.avatarUrl, null);
  assert.equal(existsSync(`${uploadsDir}/${second.split('/').pop()}`), false);
});

test('dealer applications collect checkable details', async () => {
  const apply = (extra) =>
    client()('POST', '/api/signup', {
      email: `applicant${++n}@test.com`, password: 'password123', name: 'Applicant', role: 'dealer', acceptTerms: true,
      ...DEALER_APPLICATION, ...extra,
    });
  // Licensed dealers must give a license, its state, and a website.
  assert.match((await apply({ licenseNumber: '' })).body.error, /license number/i);
  assert.match((await apply({ licenseState: '' })).body.error, /state/i);
  assert.match((await apply({ website: '' })).body.error, /Website/);
  assert.match((await apply({ website: 'not a website at all' })).body.error, /valid website/);
  assert.match((await apply({ dealerType: 'collector' })).body.error, /Dealer type/);
  assert.match((await apply({ phone: '' })).body.error, /Business phone/);
  assert.match((await apply({ businessAddress: '' })).body.error, /address/);

  // Brokers don't need a license or website, but must describe their track record.
  const broker = { dealerType: 'broker', licenseNumber: '', licenseState: '', website: '' };
  assert.match((await apply({ ...broker })).body.error, /Track record/);
  assert.match((await apply({ ...broker, experience: 'Trust me.' })).body.error, /a bit more/);
  const ok = await apply({ ...broker, experience: 'Sourced 40+ air-cooled 911s since 2015 via Bring a Trailer and PCA contacts.' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.account.dealerType, 'broker');
  assert.equal(ok.body.account.verified, false);
});

test('admins work through a verification checklist before approving', async () => {
  const adminCall = await admin();
  sentEmails.length = 0;
  const dealer = await signup('dealer', {
    approve: false, email: 'owner@ruf-specialists.example', website: 'https://www.ruf-specialists.example', businessName: 'RUF Specialists',
  });
  const gmailDealer = await signup('dealer', { approve: false, email: 'quickcash4cars@gmail.com' });
  await tick();

  // The admin email carries the application and the email-domain signal.
  const alert = sentEmails.find((e) => /waiting for approval: RUF Specialists/.test(e.subject));
  assert.match(alert.text, /License: VI-12345 \(Florida\)/);
  assert.match(alert.text, /Matches their website domain/);
  assert.match(alert.text, new RegExp(`/#/admin/account/${dealer.account.id}`));

  const detail = (await adminCall('GET', `/api/admin/accounts/${dealer.account.id}`)).body.account.dealer;
  assert.equal(detail.emailSignal, 'match');
  assert.deepEqual(detail.requiredChecks, ['license', 'web', 'call']);
  assert.deepEqual(detail.missingChecks, ['license', 'web', 'call']);
  assert.equal((await adminCall('GET', `/api/admin/accounts/${gmailDealer.account.id}`)).body.account.dealer.emailSignal, 'free');

  // Checks record who did them and when; they can be undone.
  const checked = await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { check: 'call', done: true, note: 'Spoke to Maria' });
  const call = checked.body.account.dealer.checks.call;
  assert.equal(call.by, 'admin@test.com');
  assert.equal(call.note, 'Spoke to Maria');
  assert.ok(call.at);
  assert.deepEqual(checked.body.account.dealer.missingChecks, ['license', 'web']);
  const undone = await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { check: 'call', done: false });
  assert.equal(undone.body.account.dealer.checks.call, undefined);
  assert.equal((await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { check: 'vibes', done: true })).status, 400);
  const buyer = await signup('user');
  assert.equal((await adminCall('PATCH', `/api/admin/accounts/${buyer.account.id}`, { check: 'call', done: true })).status, 400);

  // Approval is blocked until every required check is done, then the dealer is verified.
  assert.match((await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'active' })).body.error, /license looked up/);
  await completeChecks(dealer.account.id);
  const approved = await adminCall('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'active' });
  assert.equal(approved.body.account.dealer.verified, true);
  assert.equal((await dealer('GET', '/api/me')).body.account.verified, true);

  // Buyers see the badge on that dealer's responses.
  const { body } = await buyer('POST', '/api/requests', { make: 'RUF', model: 'CTR Yellowbird' });
  await dealer('POST', `/api/requests/${body.request.id}/responses`, { message: 'We know where one is' });
  const response = (await buyer('GET', `/api/requests/${body.request.id}`)).body.responses[0];
  assert.equal(response.dealer.verified, true);
  assert.equal(response.dealer.type, 'dealer');
});

test('brokers without a license only need the website and call checks', async () => {
  const adminCall = await admin();
  const broker = await signup('dealer', {
    approve: false, dealerType: 'broker', licenseNumber: '', licenseState: '', website: '',
    experience: 'Twelve years sourcing Ferrari classiche cars for collectors; references from three Ferrari dealers.',
  });
  const detail = (await adminCall('GET', `/api/admin/accounts/${broker.account.id}`)).body.account.dealer;
  assert.deepEqual(detail.requiredChecks, ['web', 'call']);
  await adminCall('PATCH', `/api/admin/accounts/${broker.account.id}`, { check: 'web', done: true });
  await adminCall('PATCH', `/api/admin/accounts/${broker.account.id}`, { check: 'call', done: true });
  const approved = await adminCall('PATCH', `/api/admin/accounts/${broker.account.id}`, { status: 'active' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.account.dealer.verified, true);
  assert.equal(approved.body.account.dealer.type, 'broker');
});

test('buyers can report a dealer; admins are emailed and can resolve reports', async () => {
  const adminCall = await admin();
  const buyer = await signup('user', { name: 'Riley Reporter', email: 'reporter@test.com' });
  const otherBuyer = await signup('user');
  const dealer = await signup('dealer', { businessName: 'Shady Imports', email: 'shady@test.com' });
  const { body } = await buyer('POST', '/api/requests', { make: 'Porsche', model: '911 Sport Classic' });
  const response = (await dealer('POST', `/api/requests/${body.request.id}/responses`, { message: 'Wire $10k today to hold it' })).body.response;
  const report = (b, payload) => b('POST', `/api/responses/${response.id}/reports`, payload);

  // Only the buyer who received the response can report it, with a valid reason.
  assert.equal((await report(otherBuyer, { reason: 'deposit' })).status, 404);
  assert.equal((await report(dealer, { reason: 'deposit' })).status, 403);
  assert.equal((await report(buyer, { reason: 'because' })).status, 400);
  assert.equal((await report(buyer, {})).status, 400);

  sentEmails.length = 0;
  assert.equal((await report(buyer, { reason: 'deposit', details: 'Wanted a wire before I could see it' })).status, 201);
  assert.equal((await report(buyer, { reason: 'spam' })).status, 409, 'once per response');
  await tick();
  const email = sentEmails.find((e) => e.to === 'admin@test.com' && e.subject.startsWith('Dealer reported'));
  assert.equal(email.subject, 'Dealer reported: Shady Imports — Asked for a deposit, wire or payment up front');
  assert.match(email.text, /Wanted a wire before I could see it/);
  assert.match(email.text, /Wire \$10k today/);
  assert.match(email.text, new RegExp(`/#/admin/account/${dealer.account.id}`));
  assert.equal(email.replyTo, 'reporter@test.com');

  // The buyer sees it as reported.
  assert.equal((await buyer('GET', `/api/requests/${body.request.id}`)).body.responses[0].reportedByMe, true);

  // Admins see it in the list, on the dealer, and in the stats; then resolve it.
  assert.equal((await buyer('GET', '/api/admin/reports')).status, 403);
  const open = (await adminCall('GET', '/api/admin/reports')).body.reports.find((r) => r.response.id === response.id);
  assert.equal(open.status, 'open');
  assert.equal(open.reporter.email, 'reporter@test.com');
  assert.equal(open.dealer.businessName, 'Shady Imports');
  assert.equal(open.request.model, '911 Sport Classic');
  assert.ok((await adminCall('GET', '/api/admin/stats')).body.stats.openReports >= 1);
  const dealerView = (await adminCall('GET', `/api/admin/accounts/${dealer.account.id}`)).body;
  assert.equal(dealerView.account.dealer.openReports, 1);
  assert.equal(dealerView.reports.length, 1);

  const resolved = await adminCall('PATCH', `/api/admin/reports/${open.id}`, { status: 'resolved' });
  assert.equal(resolved.body.report.status, 'resolved');
  assert.equal(resolved.body.report.resolvedBy, 'admin@test.com');
  assert.ok(!(await adminCall('GET', '/api/admin/reports')).body.reports.some((r) => r.id === open.id));
  assert.ok((await adminCall('GET', '/api/admin/reports?status=resolved')).body.reports.some((r) => r.id === open.id));
  assert.equal((await adminCall('GET', `/api/admin/accounts/${dealer.account.id}`)).body.account.dealer.openReports, 0);
  assert.equal((await adminCall('PATCH', '/api/admin/reports/999999', { status: 'resolved' })).status, 404);
});

test('the homepage ticker shows only vehicle basics of recent visible requests', async () => {
  const buyer = await signup('user', { name: 'Private Person' });
  const { body } = await buyer('POST', '/api/requests', {
    make: 'Lancia', model: 'Stratos', trim: 'HF Stradale', yearMin: 1974, yearMax: 1975,
    maxBudget: 700000, location: 'Secret Town', notes: 'call me at 555-0000',
  });
  const hidden = (await buyer('POST', '/api/requests', { make: 'Hidden', model: 'Car' })).body.request;
  await (await admin())('PATCH', `/api/admin/requests/${hidden.id}`, { hidden: true });

  const res = await client()('GET', '/api/public/recent-requests'); // no login needed
  assert.equal(res.status, 200);
  assert.ok(res.body.requests.length <= 10);
  const item = res.body.requests.find((r) => r.model === 'Stratos');
  assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'make', 'model', 'trim', 'yearMax', 'yearMin']);
  assert.ok(!JSON.stringify(res.body).includes('Secret Town'));
  assert.ok(!JSON.stringify(res.body).includes('555-0000'));
  assert.ok(!JSON.stringify(res.body).includes('Private'));
  assert.ok(!res.body.requests.some((r) => r.make === 'Hidden'), 'hidden requests stay off the homepage');

  await buyer('PATCH', `/api/requests/${body.request.id}`, { status: 'fulfilled' });
  assert.ok(!(await client()('GET', '/api/public/recent-requests')).body.requests.some((r) => r.model === 'Stratos'), 'only open requests');
});

test('the contact form emails admins, stores the message and resists spam', async () => {
  const send = (call, body) => call('POST', '/api/contact', body);
  const valid = { name: 'Casey Contact', email: 'casey@example.com', topic: 'general', message: 'Do you cover cars in Canada too?' };
  const visitor = client();

  assert.match((await send(visitor, { ...valid, topic: 'nope' })).body.error, /Topic/);
  assert.match((await send(visitor, { ...valid, email: 'not-an-email' })).body.error, /valid email/);
  assert.match((await send(visitor, { ...valid, message: 'hi' })).body.error, /a little more/);
  assert.match((await send(visitor, { ...valid, name: '' })).body.error, /Name/);

  sentEmails.length = 0;
  assert.equal((await send(visitor, valid)).status, 201);
  await tick();
  const email = sentEmails.find((e) => e.to === 'admin@test.com');
  assert.equal(email.subject, 'Contact form: General question — Casey Contact');
  assert.equal(email.replyTo, 'casey@example.com');
  assert.match(email.text, /Canada/);
  assert.equal(testDb.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE email = 'casey@example.com'").get().n, 1);

  // Signed-in senders are linked to their account.
  const buyer = await signup('user', { name: 'Signed In' });
  sentEmails.length = 0;
  await send(buyer, { ...valid, name: 'Signed In', email: buyer.account.email, topic: 'account' });
  await tick();
  assert.match(sentEmails.find((e) => e.to === 'admin@test.com').text, new RegExp(`/#/admin/account/${buyer.account.id}`));

  // The hidden honeypot field silently drops bot submissions.
  sentEmails.length = 0;
  assert.equal((await send(visitor, { ...valid, website: 'http://spam.example' })).status, 200);
  await tick();
  assert.equal(sentEmails.length, 0);

  // And there's a per-address limit (5 an hour); 2 real ones were sent above.
  for (let i = 0; i < 3; i++) assert.equal((await send(visitor, valid)).status, 201);
  assert.equal((await send(visitor, valid)).status, 429);
});

test('makes are saved under one standard spelling, and search understands nicknames', async () => {
  const buyer = await signup('user');
  const dealer = await signup('dealer');
  const post = async (make) => (await buyer('POST', '/api/requests', { make, model: `Std ${make}` })).body.request;

  assert.equal((await post('porsche')).make, 'Porsche');
  assert.equal((await post('VW')).make, 'Volkswagen');
  assert.equal((await post('mercedes benz')).make, 'Mercedes-Benz');
  assert.equal((await post('Zagato')).make, 'Zagato');
  assert.equal((await post('Some Garage Special')).make, 'Some Garage Special', 'unknown makes are kept as typed');
  assert.equal((await post('Porshe')).make, 'Porshe', 'typos are not silently changed; the form asks instead');

  // Admin edits are standardized too.
  const r = await post('Ferrari');
  const edited = await (await admin())('PATCH', `/api/admin/requests/${r.id}`, { make: 'lambo' });
  assert.equal(edited.body.request.make, 'Lamborghini');

  // Dealers can search by nickname.
  const found = await dealer('GET', '/api/requests?q=vw&status=all');
  assert.ok(found.body.requests.some((x) => x.model === 'Std VW'));
});

test('existing requests are cleaned up when the app starts', async () => {
  const db = openDatabase(':memory:');
  db.exec("INSERT INTO accounts (email, password_hash, name, role) VALUES ('u@x.com', 'x:y', 'U', 'user')");
  for (const make of ['porsche', 'PORSCHE', 'chevy', 'Unknown Make']) {
    db.prepare("INSERT INTO requests (user_id, make, model) VALUES (1, ?, 'X')").run(make);
  }
  createApp(db);
  assert.deepEqual(db.prepare('SELECT make FROM requests ORDER BY id').all().map((r) => r.make), ['Porsche', 'Porsche', 'Chevrolet', 'Unknown Make']);
});

const daysFromNow = (sqlDate) => (new Date(`${sqlDate.replace(' ', 'T')}Z`) - Date.now()) / 86400000;
const setExpiry = (id, modifier) => testDb.prepare("UPDATE requests SET expires_at = datetime('now', ?) WHERE id = ?").run(modifier, id);

test('requests close themselves after 60 days, with a reminder and one-click renewal', async () => {
  const buyer = await signup('user');
  const dealer = await signup('dealer');
  const { request } = (await buyer('POST', '/api/requests', { make: 'Porsche', model: 'Expiry 993' })).body;
  assert.ok(Math.abs(daysFromNow(request.expiresAt) - 60) < 0.1, 'new requests are open for 60 days');
  const email = buyer.account.email;
  const emailsTo = (subject) => sentEmails.filter((e) => e.to === email && e.subject.includes(subject));

  // A week out, the buyer gets one reminder (not one per run).
  setExpiry(request.id, '+5 days');
  app.runMaintenance();
  app.runMaintenance();
  await tick();
  assert.equal(emailsTo('Still looking').length, 1);
  assert.match(emailsTo('Still looking')[0].text, /Expiry 993/);

  // The email link keeps it open for another 60 days, without signing in.
  const token = await tokenFromEmail(email, 'renew');
  const renewed = await client()('POST', '/api/requests/renew', { token });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.ok(Math.abs(daysFromNow(renewed.body.request.expiresAt) - 60) < 0.1);
  assert.equal(renewed.body.request.make, 'Porsche');
  assert.equal(renewed.body.request.notes, undefined, 'the anonymous link reveals only the vehicle');
  assert.equal((await client()('POST', '/api/requests/renew', { token: 'nope' })).status, 404);

  // Once past its date it closes, dealers can't respond, and the buyer is told.
  setExpiry(request.id, '-1 minutes');
  assert.deepEqual(app.runMaintenance(), { reminded: 0, expired: 1 });
  await tick();
  const closed = (await buyer('GET', `/api/requests/${request.id}`)).body.request;
  assert.equal(closed.status, 'closed');
  assert.equal(closed.expired, true);
  assert.equal(emailsTo('has closed').length, 1);
  assert.equal((await dealer('POST', `/api/requests/${request.id}/responses`, { message: 'Too late?' })).status, 409);
  assert.ok(!(await dealer('GET', '/api/requests?q=expiry')).body.requests.some((r) => r.id === request.id));

  // The same link reopens an expired request…
  assert.equal((await client()('POST', '/api/requests/renew', { token })).status, 200);
  assert.equal((await buyer('GET', `/api/requests/${request.id}`)).body.request.status, 'open');

  // …but not one the buyer closed on purpose.
  await buyer('PATCH', `/api/requests/${request.id}`, { status: 'fulfilled' });
  assert.equal((await client()('POST', '/api/requests/renew', { token })).status, 409);

  // Reopening by hand gives a fresh 60 days, so it doesn't expire again right away.
  setExpiry(request.id, '-3 days');
  const reopened = (await buyer('PATCH', `/api/requests/${request.id}`, { status: 'open' })).body.request;
  assert.ok(Math.abs(daysFromNow(reopened.expiresAt) - 60) < 0.1);

  // The buyer can extend from the request page; nobody else can.
  setExpiry(request.id, '+3 days');
  assert.equal((await (await signup('user'))('POST', `/api/requests/${request.id}/renew`)).status, 403);
  const extended = await buyer('POST', `/api/requests/${request.id}/renew`);
  assert.ok(Math.abs(daysFromNow(extended.body.request.expiresAt) - 60) < 0.1);
});

test('requests from before expiry existed get at least two more weeks', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/cf-db-`)}/old.db`;
  const db = openDatabase(file);
  db.exec("INSERT INTO accounts (email, password_hash, name, role) VALUES ('u@x.com', 'x:y', 'U', 'user')");
  db.exec(`INSERT INTO requests (user_id, make, model, created_at) VALUES
    (1, 'Porsche', 'Old', datetime('now', '-90 days')), (1, 'Porsche', 'Recent', datetime('now', '-10 days'))`);
  db.close();
  const reopened = openDatabase(file);
  const [old, recent] = reopened.prepare('SELECT expires_at FROM requests ORDER BY id').all();
  assert.ok(Math.abs(daysFromNow(old.expires_at) - 14) < 0.1);
  assert.ok(Math.abs(daysFromNow(recent.expires_at) - 50) < 0.1);
});

test('buyers can mark responses Interested or Not for me, and dealers see it', async () => {
  const buyer = await signup('user');
  const dealer = await signup('dealer');
  const { request } = (await buyer('POST', '/api/requests', { make: 'BMW', model: 'Feedback M3' })).body;
  const { response } = (await dealer('POST', `/api/requests/${request.id}/responses`, { message: 'Have one', price: 50000 })).body;
  const feedback = (body, who = buyer) => who('PUT', `/api/responses/${response.id}/feedback`, body);

  assert.equal((await feedback({ feedback: 'interested' }, await signup('user'))).status, 404, "only the request's owner");
  assert.equal((await feedback({ feedback: 'interested' }, dealer)).status, 403);
  assert.equal((await feedback({ feedback: 'maybe' })).status, 400);

  const interested = await feedback({ feedback: 'interested' });
  assert.equal(interested.status, 200, JSON.stringify(interested.body));
  assert.equal(interested.body.response.feedback, 'interested');
  await tick();
  const note = sentEmails.find((e) => e.to === dealer.account.email && e.subject.includes('is interested'));
  assert.ok(note, 'dealer is emailed');
  assert.ok(!note.text.includes(buyer.account.email), "the buyer's email isn't shared");

  const passed = await feedback({ feedback: 'not_for_me', reason: 'price' });
  assert.equal(passed.body.response.feedbackReasonLabel, 'Price is too high');
  assert.equal((await feedback({ feedback: 'not_for_me', reason: 'bogus' })).status, 400);

  // The dealer sees the reaction on the request and on their responses list.
  const seen = (await dealer('GET', `/api/requests/${request.id}`)).body.responses[0];
  assert.equal(seen.feedback, 'not_for_me');
  const mine = (await dealer('GET', '/api/my/responses')).body.responses;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].feedbackReasonLabel, 'Price is too high');
  assert.equal(mine[0].request.model, 'Feedback M3');
  assert.equal((await buyer('GET', '/api/my/responses')).status, 403);

  assert.equal((await feedback({ feedback: null })).body.response.feedback, null, 'the buyer can clear it');
});

test('dealers can edit or withdraw their own responses', async () => {
  const buyer = await signup('user');
  const dealer = await signup('dealer');
  const other = await signup('dealer');
  const { request } = (await buyer('POST', '/api/requests', { make: 'Ferrari', model: 'Edit F40' })).body;
  const { response } = (await dealer('POST', `/api/requests/${request.id}/responses`, { message: 'Have one', price: 2_000_000 })).body;

  assert.equal((await other('PATCH', `/api/responses/${response.id}`, { price: 1 })).status, 404);
  assert.equal((await other('DELETE', `/api/responses/${response.id}`)).status, 404);
  assert.equal((await dealer('PATCH', `/api/responses/${response.id}`, { message: '' })).status, 400);

  const edited = await dealer('PATCH', `/api/responses/${response.id}`, { price: 1_900_000 });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.response.price, 1_900_000);
  assert.equal(edited.body.response.message, 'Have one', 'unchanged fields stay');
  assert.ok(edited.body.response.updatedAt);

  const withdrawn = await dealer('DELETE', `/api/responses/${response.id}`);
  assert.equal(withdrawn.body.response.withdrawn, true);
  assert.equal((await dealer('PATCH', `/api/responses/${response.id}`, { price: 1 })).status, 409);
  assert.equal((await dealer('DELETE', `/api/responses/${response.id}`)).status, 409);

  // The buyer still sees it, marked withdrawn, but it no longer counts and can't get feedback.
  const view = (await buyer('GET', `/api/requests/${request.id}`)).body;
  assert.equal(view.responses[0].withdrawn, true);
  assert.equal(view.request.responseCount, 0);
  assert.equal((await buyer('PUT', `/api/responses/${response.id}/feedback`, { feedback: 'interested' })).status, 409);

  // Edits are only allowed while the request is open.
  const second = (await other('POST', `/api/requests/${request.id}/responses`, { message: 'Me too' })).body.response;
  await buyer('PATCH', `/api/requests/${request.id}`, { status: 'closed' });
  assert.equal((await other('PATCH', `/api/responses/${second.id}`, { price: 5 })).status, 409);
});

test('link previews: the share image and tags are served', async () => {
  const image = await fetch(`${base}/og-image.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<meta property="og:image" content="https:\/\/carsfindme.com\/og-image.png">/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

test('buyers can continue with Google; dealers cannot', async () => {
  assert.equal((await client()('GET', '/api/config')).body.googleClientId, 'test-client.apps.googleusercontent.com');
  const google = (call, claims, extra = {}) => call('POST', '/api/auth/google', { credential: googleToken(claims), ...extra });

  // New buyer: first asked to accept the Terms, then the account is created, confirmed and signed in.
  const call = client();
  const claims = { sub: 'g-1', email: 'Gina@Gmail.com', name: 'Gina Lopez' };
  const first = await google(call, claims);
  assert.deepEqual(first.body, { needsTerms: true, name: 'Gina Lopez', email: 'gina@gmail.com' });
  const created = await google(call, claims, { acceptTerms: true });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.account.role, 'user');
  assert.equal(created.body.account.emailVerified, true);
  assert.equal(created.body.account.name, 'Gina Lopez');
  assert.equal((await call('POST', '/api/requests', { make: 'Porsche', model: 'Google 911' })).status, 201, 'can post right away');

  // Coming back signs into the same account, no Terms step.
  const again = await google(client(), claims);
  assert.equal(again.status, 200);
  assert.equal(again.body.account.id, created.body.account.id);

  // An existing password account with that email gets linked instead of duplicated.
  const buyer = await signup('user', { email: 'pat@gmail.com' });
  const linked = await google(client(), { sub: 'g-2', email: 'pat@gmail.com', name: 'Pat' });
  assert.equal(linked.body.account.id, buyer.account.id);
  assert.equal((await client()('POST', '/api/login', { email: 'pat@gmail.com', password: 'password123' })).status, 200, 'password still works');

  // Dealers can't use Google, even with a matching email.
  const dealer = await signup('dealer', { email: 'dealer-g@gmail.com' });
  assert.equal((await google(client(), { sub: 'g-3', email: dealer.account.email })).status, 403);

  // Forged, expired, wrong-audience and unverified tokens are refused.
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bad = (credential) => client()('POST', '/api/auth/google', { credential, acceptTerms: true });
  assert.equal((await bad(googleToken({ sub: 'x', email: 'x@gmail.com' }, { key: other.privateKey }))).status, 401);
  assert.equal((await bad(googleToken({ sub: 'x', email: 'x@gmail.com', exp: 1000 }))).status, 401);
  assert.equal((await bad(googleToken({ sub: 'x', email: 'x@gmail.com', aud: 'someone-else' }))).status, 401);
  assert.equal((await bad(googleToken({ sub: 'x', email: 'x@gmail.com', iss: 'evil.com' }))).status, 401);
  assert.equal((await bad('not-a-token')).status, 401);
  assert.equal((await bad(googleToken({ sub: 'x', email: 'x@gmail.com', email_verified: false }))).status, 400);

  // Frozen accounts stay locked out.
  await (await admin())('PATCH', `/api/admin/accounts/${created.body.account.id}`, { frozen: true });
  assert.equal((await google(client(), claims)).status, 403);
});

// A real 1x1 PNG, as the browser would send it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('approved dealers get a public profile with bio, specialties, cover and gallery', async () => {
  const dealer = await signup('dealer', { businessName: 'Stuttgart Classics', approve: false });
  const anon = client();
  const { profile: mine } = (await dealer('GET', '/api/me/profile')).body;
  assert.equal(mine.slug, 'stuttgart-classics');
  assert.equal(mine.public, false, 'not public before approval');
  assert.equal((await anon('GET', '/api/dealers/stuttgart-classics')).status, 404);
  assert.equal((await dealer('GET', '/api/dealers/stuttgart-classics')).body.viewer, 'owner', 'the dealer can preview it');

  const saved = await dealer('PUT', '/api/me/profile', {
    bio: 'Air-cooled specialists since 1998.', specialties: ['porsche', 'Air-cooled 911s', 'Porsche', 'bmw'],
    city: 'Miami, FL', foundedYear: 1998, instagram: 'https://www.instagram.com/stuttgartclassics/',
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.profile.specialties, ['Porsche', 'Air-cooled 911s', 'BMW']);
  assert.equal(saved.body.profile.instagram, 'stuttgartclassics');
  assert.equal((await dealer('PUT', '/api/me/profile', { instagram: 'not a handle!' })).status, 400);
  assert.equal((await dealer('PUT', '/api/me/profile', { foundedYear: 1700 })).status, 400);
  assert.equal((await dealer('PUT', '/api/me/profile', { specialties: Array.from({ length: 9 }, (_, i) => `S${i}`) })).status, 400);
  assert.equal((await (await signup('user'))('PUT', '/api/me/profile', { bio: 'x' })).status, 403);

  assert.equal((await dealer('PUT', '/api/me/cover', { photo: PNG })).status, 200);
  for (let i = 0; i < 8; i++) assert.equal((await dealer('POST', '/api/me/gallery', { photo: PNG, caption: `Car ${i}` })).status, 201);
  assert.equal((await dealer('POST', '/api/me/gallery', { photo: PNG })).status, 400, 'max 8 photos');
  assert.equal((await dealer('POST', '/api/me/gallery', { photo: 'data:image/png;base64,AAAA' })).status, 400);

  // Approve: now anyone can see it, with what was checked but none of the private details.
  await completeChecks(dealer.account.id);
  await (await admin())('PATCH', `/api/admin/accounts/${dealer.account.id}`, { status: 'active' });
  const pub = await anon('GET', '/api/dealers/stuttgart-classics');
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const p = pub.body.profile;
  assert.equal(p.businessName, 'Stuttgart Classics');
  assert.equal(p.verified, true);
  assert.deepEqual(p.checked, ['Dealer license checked with Florida', 'Website and business listing checked', 'Business phone called to confirm']);
  assert.equal(p.gallery.length, 8);
  assert.ok(p.coverUrl);
  for (const secret of ['email', 'phone', 'licenseNumber', 'hidden', 'accountId']) assert.equal(p[secret], undefined, secret);
  assert.ok(!JSON.stringify(pub.body).includes(dealer.account.email));

  // Dealers can only remove their own photos; admins can remove any.
  const other = await signup('dealer');
  assert.equal((await other('DELETE', `/api/me/gallery/${p.gallery[0].id}`)).status, 404);
  assert.equal((await dealer('DELETE', `/api/me/gallery/${p.gallery[0].id}`)).status, 200);
  assert.equal((await anon('DELETE', `/api/admin/gallery/${p.gallery[1].id}`)).status, 401);
  assert.equal((await (await admin())('DELETE', `/api/admin/gallery/${p.gallery[1].id}`)).status, 200);

  // Admins can hide a profile; the public then gets a 404, admins still see it.
  await (await admin())('PATCH', `/api/admin/accounts/${dealer.account.id}`, { profileHidden: true, reason: 'stolen photos' });
  assert.equal((await anon('GET', '/api/dealers/stuttgart-classics')).status, 404);
  const asAdmin = (await (await admin())('GET', '/api/dealers/stuttgart-classics')).body;
  assert.equal(asAdmin.viewer, 'admin');
  assert.equal(asAdmin.profile.hiddenReason, 'stolen photos');
  await (await admin())('PATCH', `/api/admin/accounts/${dealer.account.id}`, { profileHidden: false });

  // Same business name gets a different address.
  const twin = await signup('dealer', { businessName: 'Stuttgart Classics' });
  assert.equal((await twin('GET', '/api/me/profile')).body.profile.slug, 'stuttgart-classics-2');

  // Responses link to the profile.
  const buyer = await signup('user');
  const { request } = (await buyer('POST', '/api/requests', { make: 'Porsche', model: 'Profile 964' })).body;
  await dealer('POST', `/api/requests/${request.id}/responses`, { message: 'Have one' });
  const seen = (await buyer('GET', `/api/requests/${request.id}`)).body.responses[0];
  assert.equal(seen.dealer.profileSlug, 'stuttgart-classics');
  assert.equal((await anon('GET', '/api/dealers/stuttgart-classics')).body.profile.responseCount, 1);

  // The shareable /d/ link carries the dealer's own link-preview tags.
  const html = await (await fetch(`${base}/d/stuttgart-classics`)).text();
  assert.match(html, /<title>Stuttgart Classics on CarsFindMe — Verified dealer<\/title>/);
  assert.match(html, /og:description" content="Air-cooled specialists since 1998\."/);
  assert.match(html, /og:image" content="https:\/\/cars\.test\/uploads\/[a-f0-9]{32}\.png"/);
  const unknown = await (await fetch(`${base}/d/nobody-here`)).text();
  assert.match(unknown, /og:title" content="CarsFindMe — Tell us the car/);
});

test('the public dealer directory lists only approved dealers with finished profiles', async () => {
  const listed = async (path = '/api/dealers') => (await client()('GET', path)).body;
  const finished = async (name, profile) => {
    const d = await signup('dealer', { businessName: name });
    await d('PUT', '/api/me/avatar', { photo: PNG });
    await d('PUT', '/api/me/profile', profile);
    return d;
  };
  const before = (await listed()).total;
  const a = await finished('Directory Porsche House', { bio: 'Porsche people.', specialties: ['Porsche', 'Air-cooled 911s'], city: 'Miami, FL' });
  await finished('Directory JDM Garage', { bio: 'Imports from Japan.', specialties: ['Nissan', 'Toyota'], city: 'Austin, Texas' });
  const noLogo = await signup('dealer', { businessName: 'Directory No Logo' });
  await noLogo('PUT', '/api/me/profile', { bio: 'Has a bio but no logo.' });
  const pending = await signup('dealer', { businessName: 'Directory Pending', approve: false });
  await pending('PUT', '/api/me/avatar', { photo: PNG });
  await pending('PUT', '/api/me/profile', { bio: 'Not approved yet.' });

  const all = await listed();
  assert.equal(all.total, before + 2);
  const names = all.dealers.map((d) => d.businessName);
  assert.ok(names.includes('Directory Porsche House') && names.includes('Directory JDM Garage'));
  assert.ok(!names.includes('Directory No Logo') && !names.includes('Directory Pending'));
  const card = all.dealers.find((d) => d.businessName === 'Directory Porsche House');
  assert.equal(card.state, 'FL');
  assert.equal(card.tagline, 'Porsche people.');
  assert.equal(card.email, undefined);
  assert.equal(all.dealers.find((d) => d.businessName === 'Directory JDM Garage').state, 'TX', 'full state names work too');
  assert.ok(all.filters.states.includes('TX'));
  assert.ok(all.filters.specialties.some((sp) => sp.name === 'Air-cooled 911s'));

  const bySpecialty = await listed('/api/dealers?specialty=air-cooled%20911s');
  assert.deepEqual(bySpecialty.dealers.map((d) => d.businessName), ['Directory Porsche House']);
  assert.ok((await listed('/api/dealers?state=TX')).dealers.every((d) => d.state === 'TX'));
  assert.ok((await listed('/api/dealers?q=jdm%20austin')).dealers.some((d) => d.businessName === 'Directory JDM Garage'));
  assert.equal((await listed('/api/dealers?limit=1')).dealers.length, 1);

  // Hidden profiles drop out.
  await (await admin())('PATCH', `/api/admin/accounts/${a.account.id}`, { profileHidden: true });
  assert.ok(!(await listed()).dealers.some((d) => d.businessName === 'Directory Porsche House'));
});
