const view = document.getElementById('view');
const nav = document.getElementById('nav');
let me = null;

// ---------- helpers ----------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = (n) => (n == null ? '—' : `$${Number(n).toLocaleString()}`);

function years(r) {
  if (r.yearMin && r.yearMax) return r.yearMin === r.yearMax ? `${r.yearMin}` : `${r.yearMin}–${r.yearMax}`;
  if (r.yearMin) return `${r.yearMin}+`;
  if (r.yearMax) return `up to ${r.yearMax}`;
  return 'Any year';
}

const vehicleTitle = (r) =>
  `${r.yearMin && r.yearMin === r.yearMax ? `${r.yearMin} ` : ''}${r.make} ${r.model}${r.trim ? ` ${r.trim}` : ''}`;

const CONDITION_LABELS = {
  any: 'Any condition',
  concours: 'Concours',
  excellent: 'Excellent',
  good: 'Good / driver',
  project: 'Project car',
};

function ago(sqlDate) {
  const then = new Date(`${sqlDate.replace(' ', 'T')}Z`);
  const s = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return then.toLocaleDateString();
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForm(form, onSubmit) {
  const error = form.querySelector('.error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    if (error) error.textContent = '';
    try {
      await onSubmit(formData(form));
    } catch (err) {
      if (error) error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

// ---------- nav ----------

function renderNav() {
  if (!me) {
    nav.innerHTML = `<a href="#/login">Log in</a><a class="button" href="#/signup">Sign up</a>`;
    return;
  }
  const links =
    me.role === 'dealer'
      ? me.status === 'active'
        ? `<a href="#/browse">Browse requests</a>`
        : ''
      : `<a href="#/my">My requests</a><a href="#/new">New request</a>`;
  nav.innerHTML = `${links}${me.isAdmin ? `<a href="#/admin">Admin</a>` : ''}
    <span class="who">${esc(me.businessName || me.name)} · ${me.role === 'dealer' ? 'Dealer' : 'Buyer'}</span>
    <a href="#" id="logout">Log out</a>`;
  nav.querySelector('#logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/logout', { method: 'POST' });
    me = null;
    go('#/');
  });
}

// ---------- views ----------

function landing() {
  view.innerHTML = `
    <section class="hero">
      <h1>Tell us the car. The right dealers find it.</h1>
      <p>For 911s, M cars, special editions and the ones you've been chasing for years. Post the exact spec you want — a 1987 Carrera in Guards Red, a 6&#8209;speed E46 M3 in Laguna Seca Blue, a GT3 Touring — and vetted specialty dealers come to you.</p>
      <div class="split">
        <div class="card">
          <h2>I'm hunting for a car</h2>
          <p class="muted">Describe the spec down to the gearbox and paint. Get offers from specialists who have it or can source it.</p>
          <a class="button" href="#/signup?role=user">Post a request</a>
        </div>
        <div class="card">
          <h2>I'm a specialty dealer</h2>
          <p class="muted">See what serious enthusiasts are looking for right now. Respond with what you have and a price.</p>
          <a class="button" href="#/signup?role=dealer">Browse requests</a>
        </div>
      </div>
    </section>`;
}

function login() {
  view.innerHTML = `
    <div class="narrow card">
      <h1>Log in</h1>
      <form>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error"></p>
        <button type="submit">Log in</button>
        <p class="muted">No account? <a href="#/signup">Sign up</a></p>
      </form>
    </div>`;
  bindForm(view.querySelector('form'), async (data) => {
    me = (await api('/api/login', { method: 'POST', body: data })).account;
    go(home());
  });
}

function signup(params) {
  const role = params.get('role') === 'dealer' ? 'dealer' : 'user';
  view.innerHTML = `
    <div class="narrow card">
      <h1>Create an account</h1>
      <form>
        <fieldset>
          <label><input type="radio" name="role" value="user" ${role === 'user' ? 'checked' : ''}> I'm looking for a car</label>
          <label><input type="radio" name="role" value="dealer" ${role === 'dealer' ? 'checked' : ''}> I'm a dealer</label>
        </fieldset>
        <label>Your name <input name="name" autocomplete="name" required></label>
        <label class="dealer-only">Dealership / business name <input name="businessName" autocomplete="organization"></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label class="dealer-only">Phone <span class="hint">shown to buyers you respond to</span><input name="phone" type="tel" autocomplete="tel"></label>
        <label>Password <span class="hint">at least 8 characters</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <p class="error"></p>
        <button type="submit">Create account</button>
        <p class="muted">Already have one? <a href="#/login">Log in</a></p>
      </form>
    </div>`;
  const form = view.querySelector('form');
  const syncRole = () => {
    const isDealer = form.role.value === 'dealer';
    form.querySelectorAll('.dealer-only').forEach((el) => (el.hidden = !isDealer));
    form.businessName.required = isDealer;
  };
  form.addEventListener('change', syncRole);
  syncRole();
  bindForm(form, async (data) => {
    me = (await api('/api/signup', { method: 'POST', body: data })).account;
    go(home());
  });
}

function requestForm() {
  const thisYear = new Date().getFullYear();
  view.innerHTML = `
    <div class="card" style="max-width:720px;margin:0 auto">
      <h1>What are you hunting for?</h1>
      <p class="muted">The more specific, the better — options, gearbox, paint, mileage, provenance. Dealers see everything here except your contact details.</p>
      <form>
        <div class="grid-2">
          <label>Make <input name="make" placeholder="Porsche" required></label>
          <label>Model <input name="model" placeholder="911 Carrera" required></label>
          <label>Year from <input name="yearMin" type="number" min="1885" max="${thisYear + 2}" placeholder="1987"></label>
          <label>Year to <input name="yearMax" type="number" min="1885" max="${thisYear + 2}" placeholder="1987"></label>
          <label>Trim / variant <input name="trim" placeholder="Targa, G50 gearbox, Sport Seats"></label>
          <label>Color <input name="color" placeholder="Guards Red"></label>
          <label>Max budget (USD) <input name="maxBudget" type="number" min="0" step="500" placeholder="85000"></label>
          <label>Condition
            <select name="condition">
              ${Object.entries(CONDITION_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </label>
        </div>
        <label>Your location <span class="hint">city / state — helps dealers estimate shipping</span><input name="location" placeholder="Austin, TX"></label>
        <label>Notes <textarea name="notes" placeholder="Matching numbers, under 80k miles, service records preferred…"></textarea></label>
        <p class="error"></p>
        <div class="row"><button type="submit">Post request</button><a href="#/my">Cancel</a></div>
      </form>
    </div>`;
  bindForm(view.querySelector('form'), async (data) => {
    const { request } = await api('/api/requests', { method: 'POST', body: data });
    go(`#/request/${request.id}`);
  });
}

async function myRequests() {
  const { requests } = await api('/api/my/requests');
  view.innerHTML = `
    <div class="row spread" style="margin-bottom:16px">
      <h1 style="margin:0">My requests</h1>
      <a class="button" href="#/new">New request</a>
    </div>
    ${
      requests.length
        ? `<div class="list">${requests
            .map(
              (r) => `
            <a class="card request-card" href="#/request/${r.id}">
              <div class="row spread">
                <span class="vehicle">${esc(vehicleTitle(r))}</span>
                <span class="pill ${r.status}">${r.status}</span>
              </div>
              <div class="muted">${esc(years(r))} · ${money(r.maxBudget)} · ${esc(CONDITION_LABELS[r.condition])} · posted ${ago(r.createdAt)}</div>
              <div><strong>${r.responseCount}</strong> dealer ${r.responseCount === 1 ? 'response' : 'responses'}</div>
            </a>`,
            )
            .join('')}</div>`
        : `<div class="card empty">You haven't posted any requests yet. <a href="#/new">Post your first one</a>.</div>`
    }`;
}

// Dealer list: state lives in the URL so filters survive reloads and the back button.
const BROWSE_DEFAULTS = { q: '', make: '', year: '', condition: '', minBudget: '', status: 'open', sort: 'newest', offset: '0' };
const PAGE_SIZE = 25;

async function browse(params) {
  const state = Object.fromEntries(Object.entries(BROWSE_DEFAULTS).map(([k, d]) => [k, params.get(k) ?? d]));
  const query = new URLSearchParams(Object.entries(state).filter(([, v]) => v !== ''));
  query.set('limit', PAGE_SIZE);

  const [{ makes }, result] = await Promise.all([api('/api/makes'), api(`/api/requests?${query}`)]);

  const sortHeader = (label, desc, asc) => {
    const active = state.sort === desc ? 'descending' : state.sort === asc ? 'ascending' : null;
    const next = state.sort === desc && asc ? asc : desc;
    return `<th><button class="sort" data-sort="${next}" ${active ? `aria-sort="${active}"` : ''}>${label}</button></th>`;
  };

  view.innerHTML = `
    <div class="row spread" style="margin-bottom:12px">
      <h1 style="margin:0">Buyer requests</h1>
      <span class="muted">${result.total} ${result.total === 1 ? 'match' : 'matches'}</span>
    </div>
    <form class="filters" id="filters">
      <input class="search" name="q" type="search" placeholder="Search: porsche 1987 targa…" value="${esc(state.q)}">
      <select name="make"><option value="">All makes</option>${makes
        .map((m) => `<option ${m.toLowerCase() === state.make.toLowerCase() ? 'selected' : ''}>${esc(m)}</option>`)
        .join('')}</select>
      <input name="year" type="number" placeholder="Year I have" value="${esc(state.year)}">
      <select name="condition"><option value="">Any condition</option>${Object.entries(CONDITION_LABELS)
        .filter(([v]) => v !== 'any')
        .map(([v, l]) => `<option value="${v}" ${state.condition === v ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>
      <input name="minBudget" type="number" step="1000" placeholder="Min budget $" value="${esc(state.minBudget)}">
      <select name="sort">
        ${[
          ['newest', 'Newest first'],
          ['oldest', 'Oldest first'],
          ['budget_desc', 'Budget: high to low'],
          ['budget_asc', 'Budget: low to high'],
          ['year_desc', 'Year: newest'],
          ['year_asc', 'Year: oldest'],
          ['make', 'Make A–Z'],
          ['responses', 'Most responses'],
        ]
          .map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
      </select>
      <button type="submit" hidden>Search</button>
    </form>
    ${
      result.requests.length
        ? `<div class="table-wrap"><table>
            <thead><tr>
              ${sortHeader('Vehicle', 'make', null)}
              ${sortHeader('Years', 'year_desc', 'year_asc')}
              ${sortHeader('Budget', 'budget_desc', 'budget_asc')}
              <th>Condition</th><th>Location</th><th>Details</th>
              ${sortHeader('Responses', 'responses', null)}
              ${sortHeader('Posted', 'newest', 'oldest')}
            </tr></thead>
            <tbody>${result.requests
              .map(
                (r) => `
              <tr data-id="${r.id}">
                <td><strong>${esc(r.make)} ${esc(r.model)}</strong>${r.trim ? `<br><span class="muted">${esc(r.trim)}</span>` : ''}</td>
                <td>${esc(years(r))}</td>
                <td>${money(r.maxBudget)}</td>
                <td>${esc(CONDITION_LABELS[r.condition])}</td>
                <td>${esc(r.location || '—')}</td>
                <td class="wrap muted">${esc([r.color, r.notes].filter(Boolean).join(' · ').slice(0, 140) || '—')}</td>
                <td>${r.responseCount}</td>
                <td>${ago(r.createdAt)}</td>
              </tr>`,
              )
              .join('')}</tbody>
          </table></div>
          <div class="pager">
            <button class="secondary" data-page="-1" ${result.offset === 0 ? 'disabled' : ''}>← Previous</button>
            <span class="muted">${result.offset + 1}–${result.offset + result.requests.length} of ${result.total}</span>
            <button class="secondary" data-page="1" ${result.offset + result.requests.length >= result.total ? 'disabled' : ''}>Next →</button>
          </div>`
        : `<div class="card empty">No requests match those filters.</div>`
    }`;

  const update = (changes) => {
    const next = new URLSearchParams(
      Object.entries({ ...state, offset: '0', ...changes }).filter(([k, v]) => v !== '' && v !== BROWSE_DEFAULTS[k]),
    );
    go(`#/browse${next.toString() ? `?${next}` : ''}`);
  };

  const form = view.querySelector('#filters');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    update(formData(form));
  });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'q') update(formData(form));
  });
  view.querySelectorAll('button.sort').forEach((b) => b.addEventListener('click', () => update({ sort: b.dataset.sort })));
  view.querySelectorAll('[data-page]').forEach((b) =>
    b.addEventListener('click', () =>
      update({ offset: String(Math.max(0, result.offset + Number(b.dataset.page) * PAGE_SIZE)) }),
    ),
  );
  view.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => go(`#/request/${tr.dataset.id}`)));
}

async function requestDetail(id) {
  const { request: r, responses } = await api(`/api/requests/${id}`);
  const isOwner = me.role === 'user';

  const responseHtml = responses.length
    ? responses
        .map(
          (x) => `
        <div class="card response">
          <div class="row spread">
            <strong>${esc(x.dealer.businessName || x.dealer.name)}</strong>
            <span class="muted">${ago(x.createdAt)}</span>
          </div>
          ${x.price != null ? `<div>Asking: <strong>${money(x.price)}</strong></div>` : ''}
          <p style="white-space:pre-wrap">${esc(x.message)}</p>
          ${
            isOwner
              ? `<div class="muted">Contact: ${esc(x.dealer.name)} · <a href="mailto:${esc(x.dealer.email)}">${esc(x.dealer.email)}</a>${
                  x.dealer.phone ? ` · <a href="tel:${esc(x.dealer.phone)}">${esc(x.dealer.phone)}</a>` : ''
                }</div>`
              : ''
          }
        </div>`,
        )
        .join('')
    : `<div class="card empty">${isOwner ? 'No dealer responses yet. Check back soon.' : "You haven't responded to this request yet."}</div>`;

  view.innerHTML = `
    <p><a href="${isOwner ? '#/my' : '#/browse'}">← Back</a></p>
    <div class="card">
      <div class="row spread">
        <h1 style="margin:0">${esc(vehicleTitle(r))}</h1>
        <span class="pill ${r.status}">${r.status}</span>
      </div>
      <p class="muted">Posted ${ago(r.createdAt)}${!isOwner && r.requesterName ? ` by ${esc(r.requesterName)}` : ''}</p>
      <dl class="facts">
        <dt>Years</dt><dd>${esc(years(r))}</dd>
        <dt>Budget</dt><dd>${r.maxBudget != null ? `up to ${money(r.maxBudget)}` : 'Not specified'}</dd>
        <dt>Condition</dt><dd>${esc(CONDITION_LABELS[r.condition])}</dd>
        ${r.color ? `<dt>Color</dt><dd>${esc(r.color)}</dd>` : ''}
        ${r.location ? `<dt>Location</dt><dd>${esc(r.location)}</dd>` : ''}
        ${r.notes ? `<dt>Notes</dt><dd style="white-space:pre-wrap">${esc(r.notes)}</dd>` : ''}
      </dl>
      ${
        isOwner
          ? `<div class="row">
              ${r.status !== 'fulfilled' ? `<button class="secondary" data-status="fulfilled">Mark as found</button>` : ''}
              ${r.status === 'open' ? `<button class="secondary" data-status="closed">Close request</button>` : ''}
              ${r.status !== 'open' ? `<button class="secondary" data-status="open">Reopen</button>` : ''}
            </div>`
          : ''
      }
    </div>
    <h2 style="margin-top:24px">${isOwner ? `Dealer responses (${responses.length})` : 'Your responses'}</h2>
    ${responseHtml}
    ${
      !isOwner && r.status === 'open'
        ? `<div class="card">
            <h3>Respond to this buyer</h3>
            <p class="muted">Your business name, email${me.phone ? ', and phone' : ''} will be shared with the buyer.</p>
            <form>
              <label>Asking price (USD) <span class="hint">optional</span><input name="price" type="number" min="0" step="500"></label>
              <label>Message <textarea name="message" required placeholder="I have a 1987 Carrera Targa in Guards Red, 64k miles, full records…"></textarea></label>
              <p class="error"></p>
              <button type="submit">Send response</button>
            </form>
          </div>`
        : ''
    }`;

  view.querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/requests/${r.id}`, { method: 'PATCH', body: { status: b.dataset.status } });
      render();
    }),
  );
  const form = view.querySelector('form');
  if (form) {
    bindForm(form, async (data) => {
      await api(`/api/requests/${r.id}/responses`, { method: 'POST', body: data });
      render();
    });
  }
}

function dealerNotApproved() {
  const rejected = me.status === 'rejected';
  view.innerHTML = `
    <div class="narrow card" style="text-align:center">
      <h1>${rejected ? 'Account not approved' : 'Thanks for signing up!'}</h1>
      ${
        rejected
          ? `<p class="muted">Your dealer account for ${esc(me.businessName)} wasn't approved. If you think this is a mistake, reply to any CarsFindMe email or contact us.</p>`
          : `<p>We review every dealer before they can see buyer requests, to keep buyers' information safe.</p>
             <p class="muted">You'll get an email at <strong>${esc(me.email)}</strong> as soon as <strong>${esc(me.businessName)}</strong> is approved.</p>
             <button class="secondary" id="recheck">Check again</button>`
      }
    </div>`;
  view.querySelector('#recheck')?.addEventListener('click', async () => {
    me = (await api('/api/me')).account;
    render();
  });
}

const DEALER_TABS = [
  ['pending', 'Waiting for approval'],
  ['active', 'Approved'],
  ['rejected', 'Rejected'],
];

async function admin(params) {
  const status = DEALER_TABS.some(([s]) => s === params.get('status')) ? params.get('status') : 'pending';
  const { counts, dealers } = await api(`/api/admin/dealers?status=${status}`);

  const actions = (d) =>
    [
      d.status !== 'active' && `<button data-id="${d.id}" data-status="active">Approve</button>`,
      d.status !== 'rejected' && `<button class="secondary" data-id="${d.id}" data-status="rejected">${d.status === 'active' ? 'Revoke' : 'Reject'}</button>`,
    ]
      .filter(Boolean)
      .join(' ');

  view.innerHTML = `
    <h1>Dealers</h1>
    <div class="row" style="margin-bottom:16px">
      ${DEALER_TABS.map(
        ([s, label]) =>
          `<a class="button ${s === status ? '' : 'secondary'}" href="#/admin?status=${s}">${label} (${counts[s]})</a>`,
      ).join('')}
    </div>
    ${
      dealers.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Business</th><th>Contact</th><th>Signed up</th>${status === 'active' ? '<th>Responses</th>' : ''}<th></th></tr></thead>
            <tbody>${dealers
              .map(
                (d) => `
              <tr class="static">
                <td><strong>${esc(d.businessName || '—')}</strong></td>
                <td>${esc(d.name)}<br><a href="mailto:${esc(d.email)}">${esc(d.email)}</a>${d.phone ? `<br><a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>` : ''}</td>
                <td>${ago(d.createdAt)}</td>
                ${status === 'active' ? `<td>${d.responseCount}</td>` : ''}
                <td><div class="row">${actions(d)}</div></td>
              </tr>`,
              )
              .join('')}</tbody>
          </table></div>`
        : `<div class="card empty">${status === 'pending' ? 'No dealers waiting for approval.' : 'None yet.'}</div>`
    }`;

  view.querySelectorAll('button[data-status]').forEach((b) =>
    b.addEventListener('click', async () => {
      const verb = { active: 'Approve', rejected: b.textContent }[b.dataset.status];
      if (b.dataset.status === 'rejected' && !confirm(`${verb} this dealer? They will lose access to buyer requests.`)) return;
      b.disabled = true;
      await api(`/api/admin/dealers/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.status } });
      render();
    }),
  );
}

// ---------- router ----------

const home = () => (!me ? '#/' : me.role === 'dealer' ? '#/browse' : '#/my');
const dealerBlocked = () => me.role === 'dealer' && me.status !== 'active';

async function render() {
  const [path, search = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(search);
  renderNav();

  const publicRoutes = { '': landing, '/': landing, '/login': login, '/signup': signup };
  if (path in publicRoutes) {
    if (me) return go(home());
    return publicRoutes[path](params);
  }
  if (!me) return go('#/login');

  try {
    if (me.isAdmin && path === '/admin') return await admin(params);
    if (dealerBlocked()) return dealerNotApproved();
    const detail = path.match(/^\/request\/(\d+)$/);
    if (detail) return await requestDetail(detail[1]);
    if (me.role === 'user' && path === '/my') return await myRequests();
    if (me.role === 'user' && path === '/new') return requestForm();
    if (me.role === 'dealer' && path === '/browse') return await browse(params);
    go(home());
  } catch (err) {
    if (err.status === 401) {
      me = null;
      return go('#/login');
    }
    view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', render);
me = (await api('/api/me')).account;
render();
