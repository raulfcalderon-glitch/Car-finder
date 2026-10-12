import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;
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
  server = createServer(createApp(openDatabase(':memory:'), {
    sendEmail,
    appUrl: 'https://cars.test',
    adminEmails: ['Admin@test.com', ' ', 'boss@test.com'],
  }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Tiny cookie-keeping client so each test actor has its own session.
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

let n = 0;
let adminClient;

async function admin() {
  if (!adminClient) {
    adminClient = client();
    await adminClient('POST', '/api/signup', { email: 'admin@test.com', password: 'password123', name: 'Ada Admin', role: 'user' });
  }
  return adminClient;
}

// Signs up an account. Dealers are approved by the admin unless { approve: false } is passed.
async function signup(role, { approve = true, ...extra } = {}) {
  const call = client();
  const res = await call('POST', '/api/signup', {
    email: `${role}${++n}@test.com`,
    password: 'password123',
    name: `Test ${role}`,
    role,
    businessName: role === 'dealer' ? 'Test Motors' : undefined,
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  call.account = res.body.account;
  if (role === 'dealer' && approve) {
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
  assert.equal((await call('POST', '/api/signup', { email: 'x@y.com', password: 'password123', name: 'X', role: 'user' })).status, 201);
  assert.equal((await client()('POST', '/api/signup', { email: 'X@Y.com', password: 'password123', name: 'X', role: 'user' })).status, 409);
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
  assert.deepEqual(sentEmails.map((e) => e.to).sort(), ['admin@test.com', 'boss@test.com'], 'every admin is told');
  assert.match(sentEmails[0].subject, /Rally Imports/);
  assert.match(sentEmails[0].text, /555-0111/);

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

  // Approving lets them in and emails them.
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
    email: 'Boss@test.com', password: 'password123', name: 'Boss', role: 'dealer', businessName: 'Boss Cars',
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
  old.close();

  const db = openDatabase(file);
  const row = db.prepare("SELECT status, frozen_at, last_login_at FROM accounts WHERE email = 'old@dealer.com'").get();
  assert.equal(row.status, 'active');
  assert.equal(row.frozen_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visible_requests').get().n, 0, 'views exist');
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
