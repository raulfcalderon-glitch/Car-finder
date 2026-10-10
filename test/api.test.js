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
  server = createServer(createApp(openDatabase(':memory:'), { sendEmail, appUrl: 'https://cars.test' }));
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
async function signup(role, extra = {}) {
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
  assert.match(await res.text(), /Car Finder/);
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
