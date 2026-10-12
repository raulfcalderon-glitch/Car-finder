import { TERMS_HTML, PRIVACY_HTML, LEGAL_UPDATED, CONTACT_EMAIL } from './legal.js';
import { normalizeMake, suggestMake, matchMakes, matchModels } from './vehicles.js';

const view = document.getElementById('view');
const banner = document.getElementById('banner');
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

const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Outside the US'];

const verifiedBadge = (type) => `<span class="verified-badge" title="CarsFindMe checked this ${type === 'broker' ? "broker's references" : "dealer's license"}, website and phone">✓ Verified ${type === 'broker' ? 'broker' : 'dealer'}</span>`;

// ---------- avatars ----------

// Up to two initials: "Stuttgart Classics" → SC, "Raul Calderon" → RC, "Porsche" → P.
function initials(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

const displayName = (p) => (p.role === 'dealer' || !p.name ? p.businessName || p.name : p.name);

// A profile picture, or a colored circle with initials. Same name → same color, everywhere.
function avatar(person, size = 36) {
  const label = person.businessName || person.name || '';
  const style = `width:${size}px;height:${size}px`;
  if (person.avatarUrl) return `<img class="avatar" src="${esc(person.avatarUrl)}" alt="" style="${style}">`;
  let hash = 0;
  for (const c of label) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar" aria-hidden="true" style="${style};font-size:${Math.round(size * 0.4)}px;background:hsl(${hash % 360} 42% 38%)">${esc(initials(label))}</span>`;
}

// ---------- nav ----------

function navItems() {
  const items =
    me.role === 'dealer'
      ? me.status === 'active'
        ? [['#/browse', 'Requests'], ['#/alerts', 'Alerts']]
        : [['#/alerts', 'Alerts']]
      : [['#/my', 'My requests'], ['#/new', 'New request']];
  if (me.isAdmin) items.push(['#/admin', 'Admin']);
  return items;
}

const chevron = '<svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderNav() {
  if (!me) {
    nav.innerHTML = `<a class="nav-login" href="#/login">Log in</a><a class="button" href="#/signup">Sign up</a>`;
    return;
  }
  const path = location.hash.split('?')[0] || '#/';
  const links = navItems()
    .map(([href, label]) => `<a href="${href}" class="${path === href || path.startsWith(`${href}/`) ? 'active' : ''}">${label}</a>`)
    .join('');
  nav.innerHTML = `
    <div class="nav-links">${links}</div>
    <div class="account">
      <button class="account-button" id="account-button" aria-haspopup="menu" aria-expanded="false">
        ${avatar(me, 32)}<span class="account-name">${esc(displayName(me))}</span>${chevron}
      </button>
      <div class="menu" id="account-menu" role="menu" hidden>
        <div class="menu-head">
          ${avatar(me, 44)}
          <div>
            <strong>${esc(displayName(me))}</strong>
            <span class="muted">${esc(me.email)}</span>
            <span class="role-tag">${me.role === 'dealer' ? 'Dealer' : 'Buyer'}${me.isAdmin ? ' · Admin' : ''}</span>
          </div>
        </div>
        <div class="menu-links menu-mobile">${links}</div>
        <a href="#/profile" role="menuitem">Profile &amp; photo</a>
        <a href="#/" role="menuitem">Home</a>
        <a href="#/contact" role="menuitem">Contact us</a>
        <button type="button" id="logout" role="menuitem">Log out</button>
      </div>
    </div>`;
  const button = nav.querySelector('#account-button');
  const menu = nav.querySelector('#account-menu');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  nav.querySelector('#logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    me = null;
    go('#/');
  });
}

// Close the account menu when clicking elsewhere or pressing Escape.
document.addEventListener('click', (e) => {
  const menu = document.getElementById('account-menu');
  if (menu && !menu.hidden && !e.target.closest('#account-menu')) {
    menu.hidden = true;
    document.getElementById('account-button')?.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('account-menu')?.setAttribute('hidden', '');
});

function profilePage() {
  view.innerHTML = `
    <div class="card profile" style="max-width:560px;margin:0 auto">
      <h1>Profile</h1>
      <div class="profile-row">
        <div id="profile-avatar">${avatar(me, 96)}</div>
        <div>
          <strong class="profile-name">${esc(displayName(me))}</strong>
          ${me.role === 'dealer' && me.businessName ? `<div class="muted">${esc(me.name)}</div>` : ''}
          <div class="muted">${esc(me.email)}</div>
          <span class="role-tag">${me.role === 'dealer' ? 'Dealer' : 'Buyer'}</span>
        </div>
      </div>
      <p class="muted">${
        me.role === 'dealer'
          ? 'Your photo or logo appears next to your responses, so buyers recognize you.'
          : 'Your photo appears next to your requests. Dealers still only see your first name.'
      } Without one, we show your initials.</p>
      <div class="row">
        <label class="button" for="avatar-input">${me.avatarUrl ? 'Change photo' : 'Upload photo'}</label>
        <input id="avatar-input" type="file" accept="image/*" hidden>
        ${me.avatarUrl ? '<button class="secondary" id="avatar-remove">Remove photo</button>' : ''}
      </div>
      <p class="error"></p>
    </div>`;
  const error = view.querySelector('.error');
  view.querySelector('#avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    error.textContent = '';
    view.querySelector('#profile-avatar').innerHTML = '<span class="muted">Uploading…</span>';
    try {
      me = (await api('/api/me/avatar', { method: 'PUT', body: { photo: await squarePhoto(file) } })).account;
    } catch (err) {
      error.textContent = err.message.includes('Failed to') ? "Couldn't read that image. Try a JPEG or PNG." : err.message;
    }
    renderNav();
    profilePage();
  });
  view.querySelector('#avatar-remove')?.addEventListener('click', async () => {
    me = (await api('/api/me/avatar', { method: 'DELETE' })).account;
    renderNav();
    profilePage();
  });
}

// Center-crops a photo to a square and shrinks it for use as a profile picture.
async function squarePhoto(file, size = 400) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(size, side);
  canvas.getContext('2d').drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- views ----------

// Illustrative requests for the homepage (not real listings).
const EXAMPLE_REQUESTS = [
  {
    title: '1973 Porsche 911 Carrera RS 2.7',
    tags: ['Lightweight (M471)', 'Grand Prix White, blue script', 'Matching numbers'],
    budget: 'up to $1,600,000',
    where: 'Greenwich, CT',
  },
  {
    title: '2004 BMW M3 CSL',
    tags: ['Silver Grey', 'Under 30k miles', 'Full BMW history'],
    budget: 'up to $185,000',
    where: 'Scottsdale, AZ',
  },
  {
    title: '2018 Porsche 911 GT3 Touring',
    tags: ['6-speed manual', 'Paint to Sample preferred', 'No track use'],
    budget: 'up to $210,000',
    where: 'Miami, FL',
  },
];

// Homepage calls to action, adjusted for whoever is looking: a visitor, a buyer or a dealer.
function landingLinks() {
  if (!me) {
    return {
      primary: ['#/signup?role=user', "Post a request — it's free"],
      secondary: ['#/signup?role=dealer', "I'm a dealer"],
      buyer: ['#/signup?role=user', 'Post a request'],
      dealer: ['#/signup?role=dealer', 'Become a Dealer'],
      closing: ['#/signup?role=user', 'Post your first request'],
    };
  }
  if (me.role === 'dealer') {
    const browse = ['#/browse', 'Browse requests'];
    return { primary: browse, secondary: ['#/alerts', 'Alert settings'], buyer: null, dealer: ['#/alerts', 'Set up alerts'], closing: browse };
  }
  const post = ['#/new', 'Post a new request'];
  return { primary: post, secondary: ['#/my', 'My requests'], buyer: post, dealer: ['#/signup?role=dealer', 'Become a Dealer'], closing: post };
}

function landing() {
  const links = landingLinks();
  const button = (link, cls = '') => (link ? `<a class="button ${cls}" href="${link[0]}">${link[1]}</a>` : '');
  view.innerHTML = `
    <section class="hero-band">
      <div class="hero-inner">
        <div class="hero-copy">
          <p class="eyebrow">For enthusiast, collector &amp; special-edition cars</p>
          <h1>Tell us the car.<br>The right dealers <span>find it.</span></h1>
          <p class="lede">Post the exact spec you've been chasing — gearbox, paint, options, provenance — and vetted specialty dealers who have it, or can source it, come to you.</p>
          <div class="row">
            ${button(links.primary, 'big')}
            ${button(links.secondary, 'big ghost')}
          </div>
        </div>
        <div class="hero-cards" aria-label="Example requests">
          ${EXAMPLE_REQUESTS.map(
            (r, i) => `
            <div class="spec-card" style="--i:${i}">
              <div class="spec-top"><span class="spec-label">Wanted</span><span class="spec-budget">${r.budget}</span></div>
              <div class="spec-title">${r.title}</div>
              <div class="spec-tags">${r.tags.map((t) => `<span>${t}</span>`).join('')}</div>
              <div class="spec-where">${r.where}</div>
            </div>`,
          ).join('')}
          <p class="spec-note">Example requests</p>
        </div>
      </div>
      <div class="ticker" id="ticker" hidden aria-label="Latest requests on CarsFindMe"></div>
    </section>

    <section class="section">
      <h2 class="section-title reveal">How it works</h2>
      <div class="steps">
        <div class="step reveal" style="--d:0"><span class="step-n">1</span><h3>Post the exact spec</h3><p class="muted">Years, trim, gearbox, color, mileage, budget, must-haves. The more specific, the better the matches.</p></div>
        <div class="step reveal" style="--d:1"><span class="step-n">2</span><h3>Specialists see it</h3><p class="muted">Only dealers we've reviewed can see requests, and they get an alert the moment yours matches what they sell.</p></div>
        <div class="step reveal" style="--d:2"><span class="step-n">3</span><h3>Compare offers, deal direct</h3><p class="muted">Get offers with prices and photos by email. Reach out to the dealers you like — no middleman, no fees.</p></div>
      </div>
    </section>

    <section class="section audiences">
      <div class="card audience reveal" style="--d:0">
        <h2>For enthusiasts</h2>
        <ul class="checks">
          <li><strong>Get access to off-market cars</strong> — many special cars trade quietly through dealer networks and never get listed publicly</li>
          <li>Stop refreshing listings — let the cars come to you</li>
          <li>Your email and phone stay private; dealers only see your first name</li>
          <li>Offers arrive with prices and photos</li>
        </ul>
        ${button(links.buyer)}
      </div>
      <div class="card audience reveal" style="--d:1">
        <h2>For specialty dealers</h2>
        <ul class="checks">
          <li>See exactly what serious buyers want, right now</li>
          <li>Alerts for the makes you specialize in</li>
          <li>Respond with a price and photos in a minute</li>
        </ul>
        ${button(links.dealer)}
      </div>
    </section>

    ${
      me?.role === 'dealer'
        ? `<section class="cta-band">
            <h2 class="reveal">See what enthusiasts want right now</h2>
            <div class="reveal" style="--d:1">${button(links.closing, 'big')}</div>
          </section>`
        : `<section class="cta-band">
            <h2 class="reveal">What are you hunting for?</h2>
            <p class="lede reveal" style="--d:1">Type the car and we'll start your request.</p>
            <form class="quickstart reveal" style="--d:2" id="quickstart">
              <input name="car" autocomplete="off" aria-label="The car you're looking for" placeholder="1995 Porsche 993 Carrera">
              <button type="submit" class="button big">Start my request</button>
            </form>
            <p class="quickstart-note reveal" style="--d:3">Free for enthusiasts · Only verified dealers see your request</p>
          </section>`
    }`;
  loadTicker();
  revealOnScroll();
  bindQuickStart();
}

// Sections fade up as they scroll into view.
function revealOnScroll() {
  const items = view.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) return items.forEach((el) => el.classList.add('in'));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  items.forEach((el) => observer.observe(el));
}

const QUICKSTART_KEY = 'carsfindme:quickstart';
const QUICKSTART_EXAMPLES = [
  '1995 Porsche 993 Carrera',
  '2004 BMW M3 CSL',
  '1992 Lancia Delta Integrale Evo',
  '1967 Jaguar E-Type Series 1',
  '2011 Lexus LFA',
  '1994 Toyota Supra Turbo',
  '1989 Ferrari 328 GTS',
];

// "1995 Porsche 993 Carrera" → year 1995, make Porsche, model 993 Carrera. The buyer reviews it on the form.
function parseCarText(text) {
  const clean = String(text).trim().replace(/\s+/g, ' ');
  const match = clean.match(/\b(18[89]\d|19\d\d|20\d\d)\b/);
  const year = match ? Number(match[1]) : null;
  const rest = match ? `${clean.slice(0, match.index)} ${clean.slice(match.index + 4)}`.trim().replace(/\s+/g, ' ') : clean;
  const [make = '', ...model] = rest.split(' ');
  return { make, model: model.join(' '), yearMin: year, yearMax: year };
}

function storage(action, value) {
  try {
    if (action === 'set') sessionStorage.setItem(QUICKSTART_KEY, value);
    else if (action === 'take') {
      const v = sessionStorage.getItem(QUICKSTART_KEY);
      sessionStorage.removeItem(QUICKSTART_KEY);
      return v;
    } else return sessionStorage.getItem(QUICKSTART_KEY);
  } catch {
    return null;
  }
}

function bindQuickStart() {
  const form = view.querySelector('#quickstart');
  if (!form) return;
  const input = form.car;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim() || input.placeholder;
    storage('set', text);
    go(me ? '#/new' : '#/signup?role=user');
  });
  typePlaceholder(input);
}

// Types example cars into the quick-start box, one after another, until the visitor starts typing.
function typePlaceholder(input) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let example = 0;
  let chars = 0;
  let deleting = false;
  const tick = () => {
    if (!input.isConnected) return; // left the homepage
    if (document.activeElement !== input && !input.value) {
      const word = QUICKSTART_EXAMPLES[example];
      chars += deleting ? -1 : 1;
      input.placeholder = word.slice(0, chars) || ' ';
      if (!deleting && chars === word.length) {
        deleting = true;
        return setTimeout(tick, 1800);
      }
      if (deleting && chars === 0) {
        deleting = false;
        example = (example + 1) % QUICKSTART_EXAMPLES.length;
      }
    }
    setTimeout(tick, deleting ? 35 : 75);
  };
  tick();
}

function contactPage() {
  view.innerHTML = `
    <div class="contact-layout">
      <div class="card">
        <h1>Contact us</h1>
        <p class="muted">Questions, feedback, help with your account, or interested in partnering? Send us a message and we'll get back to you, usually within 1–2 business days.</p>
        <form id="contact-form">
          <div class="grid-2">
            <label>Your name <input name="name" autocomplete="name" required value="${esc(me?.name ?? '')}"></label>
            <label>Email <input name="email" type="email" autocomplete="email" required value="${esc(me?.email ?? '')}"></label>
          </div>
          <label>Topic
            <select name="topic" required>
              <option value="">Choose a topic…</option>
              ${Object.entries(CONTACT_TOPICS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </label>
          <label>Message <textarea name="message" rows="6" required minlength="10"></textarea></label>
          <label class="hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
          <p class="error"></p>
          <button type="submit">Send message</button>
        </form>
      </div>
      <aside class="card contact-side">
        <h2>Other ways to reach us</h2>
        <p>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
        <p class="muted">Reporting a dealer? Use <strong>Report this dealer</strong> on their offer, so we have the details we need.</p>
        <p class="muted">Applying as a dealer? See how we verify dealers on the <a href="#/signup?role=dealer">dealer signup page</a>.</p>
      </aside>
    </div>`;
  bindForm(view.querySelector('#contact-form'), async (data) => {
    await api('/api/contact', { method: 'POST', body: data });
    view.querySelector('.contact-layout .card').innerHTML = `
      <h1>Thanks, ${esc(data.name.split(' ')[0])}!</h1>
      <p>Your message is on its way. We'll reply to <strong>${esc(data.email)}</strong>, usually within 1–2 business days.</p>
      <a class="button" href="#/">Back to home</a>`;
  });
}

const CONTACT_TOPICS = {
  general: 'General question',
  account: 'Help with my account',
  dealer: 'Becoming a dealer',
  problem: 'Report a problem',
  partnership: 'Partnerships or press',
  other: 'Something else',
};

function login() {
  view.innerHTML = `
    <div class="narrow card">
      <h1>Log in</h1>
      <form>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error"></p>
        <button type="submit">Log in</button>
        <p><a href="#/forgot">Forgot your password?</a></p>
        <p class="muted">No account? <a href="#/signup">Sign up</a></p>
      </form>
    </div>`;
  bindForm(view.querySelector('form'), async (data) => {
    me = (await api('/api/login', { method: 'POST', body: data })).account;
    go(me.role === 'user' && storage('peek') ? '#/new' : home());
  });
}

function signup(params) {
  const role = params.get('role') === 'dealer' ? 'dealer' : 'user';
  if (me) {
    view.innerHTML = `
      <div class="narrow card">
        <h1>${role === 'dealer' ? 'Become a Dealer' : 'Create an account'}</h1>
        <p>You're signed in as <strong>${esc(displayName(me))}</strong> (${esc(me.email)}).</p>
        <p class="muted">${
          role === 'dealer'
            ? 'Dealer accounts are separate from buyer accounts and need their own email address. Log out to apply as a dealer.'
            : 'Log out first to create a different account.'
        }</p>
        <div class="row"><button id="switch">Log out and continue</button><a href="${home()}">Cancel</a></div>
      </div>`;
    view.querySelector('#switch').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      me = null;
      render();
    });
    return;
  }
  view.innerHTML = `
    <div class="card signup-card">
      <h1>Create an account</h1>
      <form>
        <fieldset>
          <label><input type="radio" name="role" value="user" ${role === 'user' ? 'checked' : ''}> I'm looking for a car</label>
          <label><input type="radio" name="role" value="dealer" ${role === 'dealer' ? 'checked' : ''}> I'm a dealer or broker</label>
        </fieldset>

        <div class="verify-explainer dealer-only">
          <strong>How we verify dealers</strong>
          <p>To protect buyers, every dealer and broker is reviewed before they can see requests. We'll:</p>
          <ol>
            <li>Look up your dealer license with the issuing state (brokers: if you have one).</li>
            <li>Check that your website, Google listing or references match the details below.</li>
            <li>Call your business at its <em>publicly listed</em> number to confirm you work there.</li>
          </ol>
          <p class="muted">Most reviews take 1–2 business days. Verified accounts get a <span class="verified-badge">✓ Verified</span> badge buyers can see.</p>
        </div>

        <fieldset class="dealer-only">
          <label><input type="radio" name="dealerType" value="dealer" checked> Licensed dealer</label>
          <label><input type="radio" name="dealerType" value="broker"> Broker / independent specialist</label>
        </fieldset>

        <label>Your name <input name="name" autocomplete="name" required></label>
        <label class="dealer-only">Your role <span class="hint">e.g. Owner, Sales Manager</span><input name="jobTitle" autocomplete="organization-title" data-required="dealer broker"></label>
        <label class="dealer-only">Business name <span class="hint">as registered</span><input name="businessName" autocomplete="organization" data-required="dealer broker"></label>
        <label>Email <span class="hint dealer-only">a business address on your own domain speeds up review</span><input name="email" type="email" autocomplete="email" required></label>
        <div class="grid-2 dealer-only">
          <label>Business phone <span class="hint">shown to buyers you respond to</span><input name="phone" type="tel" autocomplete="tel" data-required="dealer broker"></label>
          <label>Website <span class="hint broker-only">optional</span><input name="website" placeholder="yourdealership.com" autocomplete="url" data-required="dealer"></label>
        </div>
        <label class="dealer-only">Business address <input name="businessAddress" placeholder="Street, city, state" autocomplete="street-address" data-required="dealer broker"></label>
        <div class="grid-2 dealer-only">
          <label>Dealer license number <span class="hint broker-only">if you have one</span><input name="licenseNumber" data-required="dealer"></label>
          <label>Issuing state
            <select name="licenseState" data-required="dealer"><option value="">Select…</option>${US_STATES.map((st) => `<option>${st}</option>`).join('')}</select>
          </label>
        </div>
        <label class="broker-only">Your track record <span class="hint">what you've sourced, how long you've done it, and references we can check (auction history, clubs, dealers you work with)</span>
          <textarea name="experience" data-required="broker" minlength="40"></textarea>
        </label>

        <label>Password <span class="hint">at least 8 characters</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <label class="checkbox"><input type="checkbox" name="acceptTerms" required> <span>I'm 18 or older and agree to the <a href="#/terms" target="_blank">Terms of Service</a> and <a href="#/privacy" target="_blank">Privacy Policy</a>.</span></label>
        <p class="error"></p>
        <button type="submit">Create account</button>
        <p class="muted">Already have one? <a href="#/login">Log in</a></p>
      </form>
    </div>`;
  const form = view.querySelector('form');
  // Show the fields for the chosen account type, and only require the ones that are visible.
  const syncRole = () => {
    const isDealer = form.role.value === 'dealer';
    const kind = isDealer ? form.dealerType.value : 'user';
    form.querySelectorAll('.dealer-only').forEach((el) => (el.hidden = !isDealer));
    form.querySelectorAll('.broker-only').forEach((el) => (el.hidden = kind !== 'broker'));
    form.querySelectorAll('[data-required]').forEach((el) => (el.required = el.dataset.required.split(' ').includes(kind)));
  };
  form.addEventListener('change', syncRole);
  syncRole();
  bindForm(form, async (data) => {
    const body = { ...data, acceptTerms: data.acceptTerms === 'on' };
    if (body.role !== 'dealer') for (const k of ['dealerType', 'jobTitle', 'website', 'businessAddress', 'licenseNumber', 'licenseState', 'experience']) delete body[k];
    me = (await api('/api/signup', { method: 'POST', body })).account;
    go(me.role === 'user' && storage('peek') ? '#/new' : home());
  });
}

function forgotPassword() {
  view.innerHTML = `
    <div class="narrow card">
      <h1>Reset your password</h1>
      <p class="muted">Enter the email you signed up with and we'll send you a link to choose a new password.</p>
      <form>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <p class="error"></p>
        <button type="submit">Send reset link</button>
        <p><a href="#/login">Back to log in</a></p>
      </form>
    </div>`;
  bindForm(view.querySelector('form'), async (data) => {
    await api('/api/password/forgot', { method: 'POST', body: data });
    view.innerHTML = `
      <div class="narrow card">
        <h1>Check your email</h1>
        <p>If an account exists for <strong>${esc(data.email)}</strong>, we've sent a link to reset your password. It works for 1 hour.</p>
        <p class="muted">Don't see it? Check your spam folder, or <a href="#/forgot">try again</a>.</p>
      </div>`;
  });
}

function resetPassword(params) {
  view.innerHTML = `
    <div class="narrow card">
      <h1>Choose a new password</h1>
      <form>
        <label>New password <span class="hint">at least 8 characters</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <label>Confirm new password <input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>
        <p class="error"></p>
        <button type="submit">Save password</button>
      </form>
    </div>`;
  bindForm(view.querySelector('form'), async ({ password, confirm }) => {
    if (password !== confirm) throw new Error("The passwords don't match");
    const result = await api('/api/password/reset', { method: 'POST', body: { token: params.get('token'), password } });
    me = result.account;
    view.innerHTML = `
      <div class="narrow card">
        <h1>Password updated</h1>
        <p>${me ? "You're signed in with your new password." : 'You can now log in with your new password.'}</p>
        <a class="button" href="${me ? home() : '#/login'}">Continue</a>
      </div>`;
    renderNav();
    renderBanner();
  });
}

async function verifyEmailPage(params) {
  try {
    await api('/api/verify', { method: 'POST', body: { token: params.get('token') } });
    if (me) me = (await api('/api/me')).account;
    renderNav();
    renderBanner();
    view.innerHTML = `
      <div class="narrow card" style="text-align:center">
        <h1>Email confirmed</h1>
        <p>Thanks — your email address is confirmed.</p>
        <a class="button" href="${me ? home() : '#/login'}">${me ? 'Continue' : 'Log in'}</a>
      </div>`;
  } catch (err) {
    view.innerHTML = `
      <div class="narrow card" style="text-align:center">
        <h1>Link expired</h1>
        <p>${esc(err.message)}</p>
        <a class="button" href="${me ? home() : '#/login'}">${me ? 'Continue' : 'Log in'}</a>
      </div>`;
  }
}

function legalPage(title, html) {
  view.innerHTML = `
    <article class="card legal">
      <h1>${title}</h1>
      <p class="muted">Last updated ${LEGAL_UPDATED}</p>
      ${html}
    </article>`;
  window.scrollTo(0, 0);
}

function alertSettingsPage() {
  const { mode, makes, minBudget } = me.alerts;
  view.innerHTML = `
    <div class="card" style="max-width:640px;margin:0 auto">
      <h1>New-request alerts</h1>
      <p class="muted">Get an email the moment a buyer posts a request you can help with.${
        me.status === 'active' ? '' : ' Alerts start once your dealer account is approved.'
      }</p>
      <form>
        <fieldset class="stack">
          <label><input type="radio" name="mode" value="all" ${mode === 'all' ? 'checked' : ''}> <span><strong>Every new request</strong></span></label>
          <label><input type="radio" name="mode" value="makes" ${mode === 'makes' ? 'checked' : ''}> <span><strong>Only these makes</strong></span></label>
          <label class="makes-field">Makes <span class="hint">separate with commas — e.g. Porsche, BMW, Ferrari</span>
            <input name="makes" placeholder="Porsche, BMW, Mercedes-Benz" value="${esc(makes.map(titleCase).join(', '))}">
          </label>
          <label><input type="radio" name="mode" value="off" ${mode === 'off' ? 'checked' : ''}> <span><strong>Off</strong> — no alert emails</span></label>
        </fieldset>
        <label class="budget-field">Only if the budget is at least (USD) <span class="hint">optional — requests without a budget are always included</span>
          <input name="minBudget" type="number" min="0" step="1000" placeholder="50000" value="${esc(minBudget ?? '')}">
        </label>
        <p class="error"></p>
        <div class="row"><button type="submit">Save alert settings</button><span class="muted" id="saved"></span></div>
      </form>
    </div>`;
  const form = view.querySelector('form');
  const sync = () => {
    form.querySelector('.makes-field').hidden = form.mode.value !== 'makes';
    form.querySelector('.budget-field').hidden = form.mode.value === 'off';
  };
  form.addEventListener('change', sync);
  sync();
  bindForm(form, async (data) => {
    me = (await api('/api/me/alerts', { method: 'PUT', body: data })).account;
    view.querySelector('#saved').textContent = 'Saved ✓';
  });
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bBmw\b/, 'BMW').replace(/\bAmg\b/, 'AMG');

async function unsubscribePage(params) {
  try {
    await api('/api/alerts/unsubscribe', { method: 'POST', body: { token: params.get('token') } });
    if (me) me = (await api('/api/me')).account;
    view.innerHTML = `
      <div class="narrow card" style="text-align:center">
        <h1>You're unsubscribed</h1>
        <p>You won't get new-request alert emails anymore. You'll still get emails about your own account.</p>
        <p class="muted">Changed your mind? Turn alerts back on from <a href="#/alerts">Alerts</a> after logging in.</p>
      </div>`;
  } catch (err) {
    view.innerHTML = `<div class="narrow card" style="text-align:center"><h1>Something's not right</h1><p>${esc(err.message)}</p></div>`;
  }
}

// Reminder for signed-in people who haven't confirmed their email yet.
function renderBanner() {
  if (!me || me.emailVerified) {
    banner.innerHTML = '';
    return;
  }
  banner.innerHTML = `
    <div class="verify-banner">
      <span>Please confirm your email — we sent a link to <strong>${esc(me.email)}</strong>. ${
        me.role === 'dealer' ? "You'll need to confirm before responding to buyers." : "You'll need to confirm before posting a request."
      }</span>
      <button class="secondary small" id="resend">Resend email</button>
    </div>`;
  banner.querySelector('#resend').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await api('/api/verify/resend', { method: 'POST' });
      b.textContent = 'Sent — check your inbox';
    } catch (err) {
      b.textContent = err.message;
    }
  });
}

// The vehicle request form, used by buyers to post and by admins to edit.
function requestForm({ initial = {}, edit = null, prefilled = false } = {}) {
  const thisYear = new Date().getFullYear();
  const v = (k) => `value="${esc(initial[k] ?? '')}"`;
  view.innerHTML = `
    <div class="card" style="max-width:720px;margin:0 auto">
      ${
        edit
          ? `<h1>Edit request</h1><p class="muted">Editing as admin. Changes are visible to the buyer and dealers right away.</p>`
          : `<h1>What are you hunting for?</h1>
             <p class="muted">The more specific, the better — options, gearbox, paint, mileage, provenance. Dealers see everything here except your contact details.</p>
             ${prefilled ? '<p class="prefill-note">We started this from what you typed — check the make, model and year, then add the details.</p>' : ''}`
      }
      <form>
        <div class="grid-2">
          <div class="make-field">
            <label>Make <input name="make" placeholder="Porsche" required autocomplete="off" ${v('make')}></label>
            <div class="did-you-mean" id="did-you-mean" hidden></div>
          </div>
          <label>Model <input name="model" placeholder="911 Carrera" required autocomplete="off" ${v('model')}></label>
          <label>Year from <input name="yearMin" type="number" min="1885" max="${thisYear + 2}" placeholder="1987" ${v('yearMin')}></label>
          <label>Year to <input name="yearMax" type="number" min="1885" max="${thisYear + 2}" placeholder="1987" ${v('yearMax')}></label>
          <label>Trim / variant <input name="trim" placeholder="Targa, G50 gearbox, Sport Seats" ${v('trim')}></label>
          <label>Color <input name="color" placeholder="Guards Red" ${v('color')}></label>
          <label>Max budget (USD) <input name="maxBudget" type="number" min="0" step="500" placeholder="85000" ${v('maxBudget')}></label>
          <label>Condition
            <select name="condition">
              ${Object.entries(CONDITION_LABELS)
                .map(([c, l]) => `<option value="${c}" ${initial.condition === c ? 'selected' : ''}>${l}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        <label>${edit ? 'Location' : 'Your location'} <span class="hint">city / state — helps dealers estimate shipping</span><input name="location" placeholder="Austin, TX" ${v('location')}></label>
        <label>Notes <textarea name="notes" placeholder="Matching numbers, under 80k miles, service records preferred…">${esc(initial.notes ?? '')}</textarea></label>
        <p class="error"></p>
        <div class="row"><button type="submit">${edit ? 'Save changes' : 'Post request'}</button><a href="${edit ? edit.cancelHref : '#/my'}">Cancel</a></div>
      </form>
    </div>`;
  const form = view.querySelector('form');
  const makeCheck = setupMakeField(form);
  bindForm(form, async (data) => {
    if (makeCheck.pending()) throw new Error('Please check the make above — tap the suggestion or keep what you typed.');
    if (edit) {
      await api(`/api/admin/requests/${edit.id}`, { method: 'PATCH', body: data });
      return go(edit.cancelHref);
    }
    const { request } = await api('/api/requests', { method: 'POST', body: data });
    storage('take');
    go(`#/request/${request.id}`);
  });
}

// ---------- make & model helpers ----------

// "porshe 911" found nothing → offer "porsche 911".
function didYouMeanSearch(q) {
  if (!q) return '';
  let changed = false;
  const fixed = q.split(/\s+/).map((word) => {
    const suggestion = suggestMake(word);
    if (!suggestion) return word;
    changed = true;
    return suggestion;
  });
  if (!changed) return '';
  const next = new URLSearchParams({ q: fixed.join(' ') });
  return ` Did you mean <a href="#/browse?${next}">${esc(fixed.join(' '))}</a>?`;
}

// Autocomplete for the make and model inputs, plus a "Did you mean …?" prompt for likely typos.
function setupMakeField(form) {
  const make = form.make;
  const model = form.model;
  const prompt = form.querySelector('#did-you-mean');
  let kept = null; // a make the person chose to keep even though we didn't recognise it

  attachSuggestions(make, (text) => matchMakes(text), () => check());
  attachSuggestions(model, (text) => matchModels(make.value, text));

  function check() {
    const typed = make.value.trim();
    const standard = normalizeMake(typed);
    if (standard) {
      make.value = standard; // "porsche" → "Porsche", "vw" → "Volkswagen"
      return hide();
    }
    const suggestion = typed && typed !== kept ? suggestMake(typed) : null;
    if (!suggestion) return hide();
    prompt.innerHTML = `<span>Did you mean <strong>${esc(suggestion)}</strong>?</span>
      <button type="button" class="small" data-use>Yes, use ${esc(suggestion)}</button>
      <button type="button" class="secondary small" data-keep>No, keep “${esc(typed)}”</button>`;
    prompt.hidden = false;
    prompt.querySelector('[data-use]').addEventListener('click', () => {
      make.value = suggestion;
      hide();
      model.focus();
    });
    prompt.querySelector('[data-keep]').addEventListener('click', () => {
      kept = typed;
      hide();
    });
  }
  function hide() {
    prompt.hidden = true;
  }
  make.addEventListener('change', check);
  return { pending: () => (check(), !prompt.hidden) };
}

// A small dropdown of suggestions under an input. Typing anything else is always allowed.
function attachSuggestions(input, getOptions, onPick = () => {}) {
  const list = document.createElement('ul');
  list.className = 'suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  let options = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const draw = () => {
    list.innerHTML = options
      .map((o, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}" aria-selected="${i === active}">${esc(o)}</li>`)
      .join('');
    list.hidden = !options.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const open = () => {
    options = getOptions(input.value).filter((o) => o.toLowerCase() !== input.value.trim().toLowerCase() || input.value === '');
    active = -1;
    draw();
  };
  const pick = (i) => {
    input.value = options[i];
    close();
    onPick();
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      draw();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  // mousedown (not click) so it fires before the input loses focus
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) {
      e.preventDefault();
      pick(Number(li.dataset.i));
    }
  });
}

// Fills the homepage ticker with the latest requests (vehicle basics only).
async function loadTicker() {
  const ticker = view.querySelector('#ticker');
  if (!ticker) return;
  let requests = [];
  try {
    ({ requests } = await api('/api/public/recent-requests'));
  } catch {
    return; // the homepage is fine without it
  }
  if (!requests.length) return;
  const items = requests
    .map(
      (r) => `
      <span class="ticker-item"><span class="ticker-label">Wanted</span>${esc(
        [r.yearMin && r.yearMin === r.yearMax ? r.yearMin : years(r).replace('Any year', ''), r.make, r.model, r.trim].filter(Boolean).join(' '),
      )}<span class="ticker-time">${ago(r.createdAt)}</span></span>`,
    )
    .join('');
  // The list is repeated so the scroll can loop without a gap; the copy is hidden from screen readers.
  ticker.innerHTML = `
    <div class="ticker-head">Latest requests</div>
    <div class="ticker-window">
      <div class="ticker-track" style="--duration:${Math.max(30, requests.length * 6)}s">
        <div class="ticker-group">${items}</div>
        <div class="ticker-group" aria-hidden="true">${items}</div>
      </div>
    </div>`;
  ticker.hidden = false;
}

// The buyer's new-request form, prefilled from the homepage quick-start box when they came from there.
function newRequestPage() {
  const text = storage('peek'); // kept until the request is posted, in case they confirm their email first
  requestForm({ initial: text ? parseCarText(text) : {}, prefilled: Boolean(text) });
}

async function adminEditRequest(id) {
  const { request } = await api(`/api/requests/${id}`);
  requestForm({ initial: request, edit: { id, cancelHref: `#/request/${id}` } });
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
                <span>${r.hidden ? '<span class="pill closed">hidden</span> ' : ''}<span class="pill ${r.status}">${r.status}</span></span>
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
        : `<div class="card empty">No requests match those filters.${didYouMeanSearch(state.q)}</div>`
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
  const { viewer, request: r, responses } = await api(`/api/requests/${id}`);
  const isOwner = viewer === 'owner';
  const isAdminView = viewer === 'admin';
  const seesContacts = isOwner || isAdminView;

  const responseHtml = responses.length
    ? responses
        .map(
          (x) => `
        <div class="card response">
          <div class="row spread">
            <strong class="with-avatar">${avatar({ ...x.dealer, role: 'dealer' }, 40)}<span>${esc(x.dealer.businessName || x.dealer.name)}</span>${x.dealer.verified ? verifiedBadge(x.dealer.type) : ''}${
              isAdminView ? ` <a class="muted" href="#/admin/account/${x.dealer.id}">view dealer</a>` : ''
            }${x.dealerFrozen ? ' <span class="pill closed">frozen — hidden from buyer</span>' : ''}</strong>
            <span class="muted">${ago(x.createdAt)}</span>
          </div>
          ${x.price != null ? `<div>Asking: <strong>${money(x.price)}</strong></div>` : ''}
          <p style="white-space:pre-wrap">${esc(x.message)}</p>
          ${
            x.photos?.length
              ? `<div class="photo-grid">${x.photos
                  .map((src, i) => `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Photo ${i + 1}" loading="lazy"></a>`)
                  .join('')}</div>`
              : ''
          }
          ${
            seesContacts
              ? `<div class="muted">Contact: ${esc(x.dealer.name)} · <a href="mailto:${esc(x.dealer.email)}">${esc(x.dealer.email)}</a>${
                  x.dealer.phone ? ` · <a href="tel:${esc(x.dealer.phone)}">${esc(x.dealer.phone)}</a>` : ''
                }</div>`
              : ''
          }
          ${
            isOwner
              ? x.reportedByMe
                ? '<div class="report-row"><span class="muted">Reported — thanks, we\'re looking into it.</span></div>'
                : `<div class="report-row"><button type="button" class="link-button" data-report="${x.id}">Report this dealer</button></div>
                   <form class="report-form" data-report-form="${x.id}" hidden>
                     <label>What happened?
                       <select name="reason" required>
                         <option value="">Choose a reason…</option>
                         ${Object.entries(REPORT_REASONS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                       </select>
                     </label>
                     <label>Details <span class="hint">optional — anything that helps us check</span><textarea name="details" rows="3"></textarea></label>
                     <p class="error"></p>
                     <div class="row"><button type="submit">Send report</button><button type="button" class="secondary" data-report-cancel="${x.id}">Cancel</button></div>
                   </form>`
              : ''
          }
        </div>`,
        )
        .join('')
    : `<div class="card empty">${
        isOwner ? 'No dealer responses yet. Check back soon.' : isAdminView ? 'No responses yet.' : "You haven't responded to this request yet."
      }</div>`;

  const statusButtons = (s) =>
    [
      s !== 'fulfilled' && `<button class="secondary" data-status="fulfilled">Mark as found</button>`,
      s === 'open' && `<button class="secondary" data-status="closed">Close request</button>`,
      s !== 'open' && `<button class="secondary" data-status="open">Reopen</button>`,
    ]
      .filter(Boolean)
      .join('');

  const back = isAdminView
    ? '#/admin/requests'
    : isOwner
      ? '#/my'
      : '#/browse';

  view.innerHTML = `
    <p><a href="${back}">← Back</a></p>
    <div class="card">
      <div class="row spread">
        <h1 style="margin:0">${esc(vehicleTitle(r))}</h1>
        <span class="pill ${r.status}">${r.status}</span>
      </div>
      <p class="muted">Posted ${ago(r.createdAt)}${
        isAdminView
          ? ` by <a href="#/admin/account/${r.requester.id}">${esc(r.requester.name)}</a> (${esc(r.requester.email)})${
              r.requester.frozen ? ' <span class="pill closed">account frozen — hidden from dealers</span>' : ''
            }`
          : !isOwner && r.requesterName
            ? ` by <span class="inline-avatar">${avatar({ name: r.requesterName, avatarUrl: r.requesterAvatarUrl }, 22)}</span> ${esc(r.requesterName)}`
            : ''
      }</p>
      <dl class="facts">
        <dt>Years</dt><dd>${esc(years(r))}</dd>
        <dt>Budget</dt><dd>${r.maxBudget != null ? `up to ${money(r.maxBudget)}` : 'Not specified'}</dd>
        <dt>Condition</dt><dd>${esc(CONDITION_LABELS[r.condition])}</dd>
        ${r.color ? `<dt>Color</dt><dd>${esc(r.color)}</dd>` : ''}
        ${r.location ? `<dt>Location</dt><dd>${esc(r.location)}</dd>` : ''}
        ${r.notes ? `<dt>Notes</dt><dd style="white-space:pre-wrap">${esc(r.notes)}</dd>` : ''}
      </dl>
      ${
        isAdminView && r.hidden
          ? `<p class="frozen-note">Hidden from dealers ${ago(r.hiddenAt)}${r.hiddenReason ? `: “${esc(r.hiddenReason)}”` : ''}. The buyer still sees it in their list, marked hidden.</p>`
          : ''
      }
      ${isOwner && r.hidden ? '<p class="frozen-note">This request has been hidden from dealers by CarsFindMe. Contact us if you have questions.</p>' : ''}
      ${seesContacts ? `<div class="row">${isAdminView ? '<span class="muted">Status:</span>' : ''}${statusButtons(r.status)}</div>` : ''}
      ${
        isAdminView
          ? `<div class="row" style="margin-top:10px"><span class="muted">Admin:</span>
              <a class="button secondary" href="#/admin/request/${r.id}/edit">Edit</a>
              ${r.hidden ? '<button class="secondary" id="unhide">Unhide</button>' : '<button class="secondary" id="hide">Hide from dealers</button>'}
              <button class="danger" id="delete">Delete</button>
            </div>
            <p class="error" id="admin-error"></p>`
          : ''
      }
    </div>
    <h2 style="margin-top:24px">${seesContacts ? `Dealer responses (${responses.length})` : 'Your responses'}</h2>
    ${
      isOwner && responses.length
        ? '<p class="safety-tip"><strong>Stay safe:</strong> never wire money or pay a deposit before you\'ve seen the car (or had it inspected) and checked the title. If a dealer pressures you to pay up front, please report them.</p>'
        : ''
    }
    ${responseHtml}
    ${
      viewer === 'dealer' && r.status === 'open'
        ? `<div class="card">
            <h3>Respond to this buyer</h3>
            <p class="muted">Your business name, email${me.phone ? ', and phone' : ''} will be shared with the buyer.</p>
            <form id="response-form">
              <label>Asking price (USD) <span class="hint">optional</span><input name="price" type="number" min="0" step="500"></label>
              <label>Message <textarea name="message" required placeholder="I have a 1987 Carrera Targa in Guards Red, 64k miles, full records…"></textarea></label>
              <div class="photo-picker">
                <label class="button secondary small" for="photo-input">Add photos</label>
                <input id="photo-input" type="file" accept="image/*" multiple hidden>
                <span class="muted" id="photo-hint">Up to ${MAX_PHOTOS} photos</span>
                <div class="photo-grid" id="photo-previews"></div>
              </div>
              <p class="error"></p>
              <button type="submit">Send response</button>
            </form>
          </div>`
        : ''
    }`;

  if (isAdminView) {
    const adminPatch = async (body) => {
      try {
        await api(`/api/admin/requests/${r.id}`, { method: 'PATCH', body });
        render();
      } catch (err) {
        view.querySelector('#admin-error').textContent = err.message;
      }
    };
    view.querySelector('#hide')?.addEventListener('click', () => {
      const reason = prompt(
        'Hide this request from dealers?\n\nThe buyer still sees it, marked hidden. You can unhide it any time.\n\nOptional reason (only admins see it):',
      );
      if (reason !== null) adminPatch({ hidden: true, reason });
    });
    view.querySelector('#unhide')?.addEventListener('click', () => adminPatch({ hidden: false }));
    view.querySelector('#delete').addEventListener('click', async () => {
      const n = responses.length;
      if (!confirm(`Permanently delete "${vehicleTitle(r)}"${n ? ` and its ${n} dealer ${n === 1 ? 'response' : 'responses'}` : ''}?\n\nThis can't be undone. Consider hiding it instead.`)) return;
      await api(`/api/admin/requests/${r.id}`, { method: 'DELETE' });
      go('#/admin/requests');
    });
  }

  view.querySelectorAll('[data-report]').forEach((b) =>
    b.addEventListener('click', () => {
      view.querySelector(`[data-report-form="${b.dataset.report}"]`).hidden = false;
      b.hidden = true;
    }),
  );
  view.querySelectorAll('[data-report-cancel]').forEach((b) =>
    b.addEventListener('click', () => {
      view.querySelector(`[data-report-form="${b.dataset.reportCancel}"]`).hidden = true;
      view.querySelector(`[data-report="${b.dataset.reportCancel}"]`).hidden = false;
    }),
  );
  view.querySelectorAll('[data-report-form]').forEach((f) =>
    bindForm(f, async (data) => {
      await api(`/api/responses/${f.dataset.reportForm}/reports`, { method: 'POST', body: data });
      f.outerHTML = '<p class="muted">Thanks — we\'ve been notified and will look into it. You don\'t need to do anything else.</p>';
    }),
  );

  view.querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', async () => {
      const path = isAdminView ? `/api/admin/requests/${r.id}` : `/api/requests/${r.id}`;
      await api(path, { method: 'PATCH', body: { status: b.dataset.status } });
      render();
    }),
  );
  const form = view.querySelector('#response-form');
  if (form) {
    const photos = []; // shrunk data URLs, in the order they'll be sent
    const previews = view.querySelector('#photo-previews');
    const hint = view.querySelector('#photo-hint');
    const drawPreviews = () => {
      previews.innerHTML = photos
        .map((src, i) => `<div class="photo-preview"><img src="${src}" alt=""><button type="button" data-remove="${i}" aria-label="Remove photo">×</button></div>`)
        .join('');
      hint.textContent = photos.length ? `${photos.length} of ${MAX_PHOTOS} photos` : `Up to ${MAX_PHOTOS} photos`;
    };
    previews.addEventListener('click', (e) => {
      const i = e.target.dataset.remove;
      if (i !== undefined) {
        photos.splice(Number(i), 1);
        drawPreviews();
      }
    });
    view.querySelector('#photo-input').addEventListener('change', async (e) => {
      const files = [...e.target.files].slice(0, MAX_PHOTOS - photos.length);
      e.target.value = '';
      hint.textContent = 'Preparing photos…';
      for (const file of files) {
        try {
          photos.push(await shrinkPhoto(file));
        } catch {
          form.querySelector('.error').textContent = `Couldn't read ${file.name}. Try a JPEG or PNG.`;
        }
      }
      drawPreviews();
    });
    bindForm(form, async (data) => {
      await api(`/api/requests/${r.id}/responses`, { method: 'POST', body: { ...data, photos } });
      render();
    });
  }
}

const MAX_PHOTOS = 6;

const REPORT_REASONS = {
  deposit: 'Asked for a deposit, wire or payment up front',
  misleading: 'Misleading or fake car or details',
  conduct: 'Rude, pushy or inappropriate',
  spam: 'Spam or unrelated to my request',
  other: 'Something else',
};

// Resizes a photo on the device (max 1600px, JPEG) so uploads are quick even on mobile data.
async function shrinkPhoto(file, maxSide = 1600) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

function dealerNotApproved() {
  const rejected = me.status === 'rejected';
  view.innerHTML = `
    <div class="narrow card" style="text-align:center">
      <h1>${rejected ? 'Account not approved' : 'Thanks for signing up!'}</h1>
      ${
        rejected
          ? `<p class="muted">Your dealer account for ${esc(me.businessName)} wasn't approved. If you think this is a mistake, reply to any CarsFindMe email or contact us.</p>`
          : `<p>We review every dealer and broker before they can see buyer requests, to keep buyers safe. Here's what happens next:</p>
             <ol class="next-steps">
               <li>We look up ${me.dealerType === 'broker' ? 'any license you gave us' : 'your dealer license'} with the issuing state.</li>
               <li>We check your website, Google listing or references.</li>
               <li>We may call <strong>${esc(me.businessName)}</strong> at its publicly listed number to confirm you work there.</li>
             </ol>
             <p class="muted">Most reviews take 1–2 business days. You'll get an email at <strong>${esc(me.email)}</strong> as soon as you're approved.${
               me.emailVerified ? '' : ' Meanwhile, please confirm your email using the link we sent.'
             }</p>
             <button class="secondary" id="recheck">Check again</button>`
      }
    </div>`;
  view.querySelector('#recheck')?.addEventListener('click', async () => {
    me = (await api('/api/me')).account;
    render();
  });
}

// ---------- admin ----------

const ADMIN_STATUS_FILTERS = {
  dealer: [
    ['all', 'All'],
    ['pending', 'Waiting for approval'],
    ['active', 'Approved'],
    ['rejected', 'Rejected'],
    ['frozen', 'Frozen'],
  ],
  user: [
    ['all', 'All'],
    ['active', 'Active'],
    ['frozen', 'Frozen'],
  ],
};

const ADMIN_SORTS = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['name', 'Name A–Z'],
  ['last_login', 'Last login'],
  ['activity', 'Most active'],
];

// One badge that sums up an account's state for the admin lists.
function accountBadge(a) {
  if (a.frozen) return '<span class="pill closed">frozen</span>';
  if (a.role === 'dealer' && a.status === 'pending') return '<span class="pill pending">waiting</span>';
  if (a.role === 'dealer' && a.status === 'rejected') return '<span class="pill fulfilled">rejected</span>';
  return `<span class="pill open">${a.role === 'dealer' ? 'approved' : 'active'}</span>`;
}

const unverifiedBadge = (a) => (a.emailVerified ? '' : ' <span class="pill pending">email not confirmed</span>');

const when = (d) => (d ? ago(d) : '<span class="muted">never</span>');

// Stat tiles and the Dealers / Users / Requests tabs shared by the admin list pages.
function adminHeader(stats, tab) {
  const tile = (n, label, href, extra = '') =>
    `<a class="card stat ${extra}" href="${href}"><span class="stat-n">${n}</span><span class="muted">${label}</span></a>`;
  return `
    <h1>Admin</h1>
    <div class="stats">
      ${tile(stats.dealersPending, 'Dealers waiting', '#/admin?role=dealer&status=pending')}
      ${tile(stats.dealersApproved, 'Approved dealers', '#/admin?role=dealer&status=active')}
      ${tile(stats.users, 'Users', '#/admin?role=user&status=all')}
      ${tile(stats.openRequests, 'Open requests', '#/admin/requests')}
      ${tile(stats.responsesLast7Days, 'Responses (7 days)', '#/admin?role=dealer&status=active&sort=activity')}
      ${tile(stats.openReports, 'Open reports', '#/admin/reports', stats.openReports ? 'alert' : '')}
      ${tile(stats.frozen, 'Frozen accounts', '#/admin?role=user&status=frozen')}
    </div>
    <p class="muted" style="margin-top:-4px">Last 7 days: ${stats.newAccountsLast7Days} new accounts · ${stats.requestsLast7Days} new requests${
      stats.hiddenRequests ? ` · ${stats.hiddenRequests} open ${stats.hiddenRequests === 1 ? 'request' : 'requests'} hidden` : ''
    }</p>
    <div class="row" style="margin:20px 0 12px">
      <a class="button ${tab === 'dealer' ? '' : 'secondary'}" href="#/admin?role=dealer">Dealers</a>
      <a class="button ${tab === 'user' ? '' : 'secondary'}" href="#/admin?role=user&status=all">Users</a>
      <a class="button ${tab === 'requests' ? '' : 'secondary'}" href="#/admin/requests">Requests</a>
      <a class="button ${tab === 'reports' ? '' : 'secondary'}" href="#/admin/reports">Reports${stats.openReports ? ` (${stats.openReports})` : ''}</a>
      <a class="backup-link" href="/api/admin/backup" download title="Download a copy of the whole database">Download backup</a>
    </div>`;
}

const ADMIN_REQUEST_STATUSES = [
  ['open', 'Open'],
  ['fulfilled', 'Found'],
  ['closed', 'Closed'],
  ['all', 'Any status'],
];
const ADMIN_REQUEST_VISIBILITY = [
  ['all', 'Visible & hidden'],
  ['visible', 'Visible to dealers'],
  ['hidden', 'Hidden from dealers'],
];
const ADMIN_REQUEST_SORTS = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['budget_desc', 'Budget: high to low'],
  ['budget_asc', 'Budget: low to high'],
  ['make', 'Make A–Z'],
  ['responses', 'Most responses'],
];
const pick = (options, value, fallback) => (options.some(([v]) => v === value) ? value : fallback);

function reportCard(rep, { showDealer = true } = {}) {
  return `
    <div class="card report ${rep.status}">
      <div class="row spread">
        <strong>${esc(rep.reasonLabel)}</strong>
        <span>${rep.status === 'open' ? '<span class="pill closed">open</span>' : '<span class="pill fulfilled">resolved</span>'} <span class="muted">${ago(rep.createdAt)}</span></span>
      </div>
      ${showDealer ? `<div>Dealer: <a href="#/admin/account/${rep.dealer.id}">${esc(rep.dealer.businessName || rep.dealer.name)}</a>${rep.dealer.frozen ? ' <span class="pill closed">frozen</span>' : ''}</div>` : ''}
      <div class="muted">Reported by <a href="#/admin/account/${rep.reporter.id}">${esc(rep.reporter.name)}</a> (${esc(rep.reporter.email)}) about their request <a href="#/request/${rep.request.id}">${esc(vehicleTitle(rep.request))}</a></div>
      ${rep.details ? `<p style="white-space:pre-wrap">“${esc(rep.details)}”</p>` : ''}
      <blockquote class="quoted">Dealer's response${rep.response.price != null ? ` (${money(rep.response.price)})` : ''}: ${esc(rep.response.message.slice(0, 400))}</blockquote>
      <div class="row">
        ${
          rep.status === 'open'
            ? `<button class="small" data-resolve="${rep.id}">Mark resolved</button>`
            : `<span class="muted">Resolved by ${esc(rep.resolvedBy ?? '')} ${rep.resolvedAt ? ago(rep.resolvedAt) : ''}</span><button class="secondary small" data-reopen="${rep.id}">Reopen</button>`
        }
        ${showDealer ? `<a href="#/admin/account/${rep.dealer.id}">Open dealer to freeze or review</a>` : ''}
      </div>
    </div>`;
}

function bindReportButtons() {
  const set = async (id, status) => {
    await api(`/api/admin/reports/${id}`, { method: 'PATCH', body: { status } });
    render();
  };
  view.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => set(b.dataset.resolve, 'resolved')));
  view.querySelectorAll('[data-reopen]').forEach((b) => b.addEventListener('click', () => set(b.dataset.reopen, 'open')));
}

async function adminReports(params) {
  const status = pick([['open'], ['resolved'], ['all']], params.get('status'), 'open');
  const [{ stats }, { reports }] = await Promise.all([api('/api/admin/stats'), api(`/api/admin/reports?status=${status}`)]);
  view.innerHTML = `
    ${adminHeader(stats, 'reports')}
    <div class="row" style="margin-bottom:12px">
      ${[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']]
        .map(([v, l]) => `<a class="button small ${v === status ? '' : 'secondary'}" href="#/admin/reports?status=${v}">${l}</a>`)
        .join('')}
    </div>
    ${
      reports.length
        ? `<div class="list">${reports.map((rep) => reportCard(rep)).join('')}</div>`
        : `<div class="card empty">${status === 'open' ? 'No open reports. 🎉' : 'No reports.'}</div>`
    }`;
  bindReportButtons();
}

async function adminRequests(params) {
  const state = {
    q: params.get('q') ?? '',
    status: pick(ADMIN_REQUEST_STATUSES, params.get('status'), 'open'),
    visibility: pick(ADMIN_REQUEST_VISIBILITY, params.get('visibility'), 'all'),
    sort: pick(ADMIN_REQUEST_SORTS, params.get('sort'), 'newest'),
  };
  const [{ stats }, { requests }] = await Promise.all([
    api('/api/admin/stats'),
    api(`/api/admin/requests?${new URLSearchParams(state)}`),
  ]);
  const options = (list, current) =>
    list.map(([v, l]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${l}</option>`).join('');

  view.innerHTML = `
    ${adminHeader(stats, 'requests')}
    <form class="filters admin-filters admin-request-filters" id="filters">
      <input class="search" name="q" type="search" placeholder="Search vehicle, notes, location, buyer name or email, #id…" value="${esc(state.q)}">
      <select name="status">${options(ADMIN_REQUEST_STATUSES, state.status)}</select>
      <select name="visibility">${options(ADMIN_REQUEST_VISIBILITY, state.visibility)}</select>
      <select name="sort">${options(ADMIN_REQUEST_SORTS, state.sort)}</select>
      <button type="submit" hidden>Search</button>
    </form>
    ${
      requests.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Vehicle</th><th>Years</th><th>Budget</th><th>Buyer</th><th>Status</th><th>Responses</th><th>Posted</th><th></th></tr></thead>
            <tbody>${requests
              .map(
                (r) => `
              <tr data-id="${r.id}">
                <td class="muted">${r.id}</td>
                <td><strong>${esc(r.make)} ${esc(r.model)}</strong>${r.trim ? `<br><span class="muted">${esc(r.trim)}</span>` : ''}</td>
                <td>${esc(years(r))}</td>
                <td>${money(r.maxBudget)}</td>
                <td><a href="#/admin/account/${r.requester.id}">${esc(r.requester.name)}</a><br><span class="muted">${esc(r.requester.email)}</span></td>
                <td><span class="pill ${r.status}">${r.status === 'fulfilled' ? 'found' : r.status}</span>${
                  r.hidden ? ' <span class="pill closed">hidden</span>' : ''
                }${r.requester.frozen ? ' <span class="pill closed">buyer frozen</span>' : ''}</td>
                <td>${r.responseCount}</td>
                <td>${ago(r.createdAt)}</td>
                <td><div class="row">
                  <a href="#/admin/request/${r.id}/edit">Edit</a>
                  ${r.hidden ? `<button class="secondary small" data-unhide="${r.id}">Unhide</button>` : `<button class="secondary small" data-hide="${r.id}">Hide</button>`}
                </div></td>
              </tr>`,
              )
              .join('')}</tbody>
          </table></div>
          <p class="muted">${requests.length} ${requests.length === 1 ? 'request' : 'requests'}. Open one to change its status or delete it.</p>`
        : '<div class="card empty">No requests match.</div>'
    }`;

  const form = view.querySelector('#filters');
  const update = () => go(`#/admin/requests?${new URLSearchParams(formData(form))}`);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    update();
  });
  form.addEventListener('change', (e) => e.target.name !== 'q' && update());
  view.querySelectorAll('tbody tr').forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (!e.target.closest('button, a')) go(`#/request/${tr.dataset.id}`);
    }),
  );
  const patch = async (id, body) => {
    await api(`/api/admin/requests/${id}`, { method: 'PATCH', body });
    render();
  };
  view.querySelectorAll('[data-hide]').forEach((b) =>
    b.addEventListener('click', () => {
      const reason = prompt('Hide this request from dealers?\n\nOptional reason (only admins see it):');
      if (reason !== null) patch(b.dataset.hide, { hidden: true, reason });
    }),
  );
  view.querySelectorAll('[data-unhide]').forEach((b) => b.addEventListener('click', () => patch(b.dataset.unhide, { hidden: false })));
}

async function admin(params) {
  const role = params.get('role') === 'user' ? 'user' : 'dealer';
  const filters = ADMIN_STATUS_FILTERS[role];
  const fallbackStatus = role === 'dealer' && !params.get('status') ? 'pending' : 'all';
  const state = {
    role,
    status: filters.some(([s]) => s === params.get('status')) ? params.get('status') : fallbackStatus,
    q: params.get('q') ?? '',
    sort: ADMIN_SORTS.some(([s]) => s === params.get('sort')) ? params.get('sort') : 'newest',
  };

  const [{ stats }, { accounts }] = await Promise.all([
    api('/api/admin/stats'),
    api(`/api/admin/accounts?${new URLSearchParams(state)}`),
  ]);
  // With no dealers waiting, open on all dealers rather than an empty list.
  if (role === 'dealer' && !params.get('status') && stats.dealersPending === 0 && state.status === 'pending') {
    return go('#/admin?role=dealer&status=all');
  }

  view.innerHTML = `
    ${adminHeader(stats, role)}

    <form class="filters admin-filters" id="filters">
      <input class="search" name="q" type="search" placeholder="Search name, email, ${role === 'dealer' ? 'business, ' : ''}phone…" value="${esc(state.q)}">
      <select name="status">${filters
        .map(([v, l]) => `<option value="${v}" ${state.status === v ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>
      <select name="sort">${ADMIN_SORTS.map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="submit" hidden>Search</button>
    </form>

    ${
      accounts.length
        ? `<div class="table-wrap"><table>
            <thead><tr>
              <th>${role === 'dealer' ? 'Business' : 'Name'}</th><th>Contact</th><th>Status</th>
              ${role === 'dealer' ? '<th>Responses</th>' : '<th>Requests</th><th>Open</th>'}
              <th>Signed up</th><th>Last login</th><th></th>
            </tr></thead>
            <tbody>${accounts
              .map(
                (a) => `
              <tr data-id="${a.id}">
                <td><div class="with-avatar">${avatar(a, 32)}<div><strong>${esc(role === 'dealer' ? a.businessName || a.name : a.name)}</strong>${
                  role === 'dealer' ? `<br><span class="muted">${esc(a.name)}</span>` : ''
                }${a.isAdmin ? ' <span class="pill open">admin</span>' : ''}</div></div></td>
                <td>${esc(a.email)}${a.phone ? `<br><span class="muted">${esc(a.phone)}</span>` : ''}</td>
                <td>${accountBadge(a)}${unverifiedBadge(a)}${
                  a.dealer?.openReports ? ` <span class="pill closed">${a.dealer.openReports} report${a.dealer.openReports === 1 ? '' : 's'}</span>` : ''
                }</td>
                ${role === 'dealer' ? `<td>${a.responseCount}</td>` : `<td>${a.requestCount}</td><td>${a.openRequestCount}</td>`}
                <td>${ago(a.createdAt)}</td>
                <td>${when(a.lastLoginAt)}</td>
                <td><div class="row">${
                  role === 'dealer' && a.status === 'pending' && !a.frozen
                    ? a.dealer.missingChecks.length
                      ? `<a class="button secondary small" href="#/admin/account/${a.id}">Verify (${a.dealer.requiredChecks.length - a.dealer.missingChecks.length}/${a.dealer.requiredChecks.length})</a>`
                      : `<button data-approve="${a.id}">Approve</button>`
                    : role === 'dealer' && a.dealer.verified
                      ? verifiedBadge(a.dealer.type)
                      : ''
                }<a href="#/admin/account/${a.id}">Details</a></div></td>
              </tr>`,
              )
              .join('')}</tbody>
          </table></div>
          <p class="muted">${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}</p>`
        : `<div class="card empty">No ${role === 'dealer' ? 'dealers' : 'users'} match.</div>`
    }`;

  const form = view.querySelector('#filters');
  const update = () => go(`#/admin?${new URLSearchParams({ role, ...formData(form) })}`);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    update();
  });
  form.addEventListener('change', (e) => e.target.name !== 'q' && update());
  view.querySelectorAll('tbody tr').forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (!e.target.closest('button, a')) go(`#/admin/account/${tr.dataset.id}`);
    }),
  );
  view.querySelectorAll('[data-approve]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      await api(`/api/admin/accounts/${b.dataset.approve}`, { method: 'PATCH', body: { status: 'active' } });
      render();
    }),
  );
}

async function adminAccount(id) {
  const { account: a, requests, responses, reports } = await api(`/api/admin/accounts/${id}`);
  const isDealer = a.role === 'dealer';
  const listHref = `#/admin?role=${a.role}${isDealer ? '&status=all' : ''}`;

  const actions = [
    isDealer && a.status !== 'active' && !a.dealer.missingChecks.length && `<button data-patch='{"status":"active"}'>Approve dealer</button>`,
    isDealer && a.status === 'pending' && `<button class="secondary" data-patch='{"status":"rejected"}' data-confirm="Reject this dealer? They won't be able to see buyer requests.">Reject</button>`,
    isDealer && a.status === 'active' && `<button class="secondary" data-patch='{"status":"rejected"}' data-confirm="Revoke this dealer's approval? They'll lose access to buyer requests.">Revoke approval</button>`,
    !a.isAdmin && !a.frozen && `<button class="danger" id="freeze">Freeze account</button>`,
    a.frozen && `<button data-patch='{"frozen":false}'>Unfreeze account</button>`,
    !a.emailVerified && `<button class="secondary" data-patch='{"verified":true}' data-confirm="Mark this email as confirmed without the user clicking the link?">Mark email confirmed</button>`,
  ]
    .filter(Boolean)
    .join('');

  const activity = isDealer
    ? responses.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Request</th><th>Price</th><th>Message</th><th>Sent</th></tr></thead>
          <tbody>${responses
            .map(
              (x) => `<tr data-href="#/request/${x.requestId}">
                <td><strong>${esc(vehicleTitle(x.request))}</strong><br><span class="pill ${x.request.status}">${x.request.status}</span></td>
                <td>${money(x.price)}</td>
                <td class="wrap muted">${esc(x.message.slice(0, 160))}</td>
                <td>${ago(x.createdAt)}</td>
              </tr>`,
            )
            .join('')}</tbody></table></div>`
      : '<div class="card empty">No responses yet.</div>'
    : requests.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Vehicle</th><th>Years</th><th>Budget</th><th>Status</th><th>Responses</th><th>Posted</th></tr></thead>
          <tbody>${requests
            .map(
              (r) => `<tr data-href="#/request/${r.id}">
                <td><strong>${esc(r.make)} ${esc(r.model)}</strong>${r.trim ? `<br><span class="muted">${esc(r.trim)}</span>` : ''}</td>
                <td>${esc(years(r))}</td>
                <td>${money(r.maxBudget)}</td>
                <td><span class="pill ${r.status}">${r.status}</span></td>
                <td>${r.responseCount}</td>
                <td>${ago(r.createdAt)}</td>
              </tr>`,
            )
            .join('')}</tbody></table></div>`
      : '<div class="card empty">No requests yet.</div>';

  view.innerHTML = `
    <p><a href="${listHref}">← All ${isDealer ? 'dealers' : 'users'}</a></p>
    <div class="card">
      <div class="row spread">
        <h1 class="with-avatar" style="margin:0">${avatar(a, 52)}<span>${esc(isDealer ? a.businessName || a.name : a.name)}</span></h1>
        <span>${accountBadge(a)}${a.isAdmin ? ' <span class="pill open">admin</span>' : ''}</span>
      </div>
      ${
        a.frozen
          ? `<p class="frozen-note">Frozen ${ago(a.frozenAt)}${a.frozenReason ? `: “${esc(a.frozenReason)}”` : ''}. This account can't sign in, and its ${
              isDealer ? 'responses are hidden from buyers' : 'requests are hidden from dealers'
            }.</p>`
          : ''
      }
      <dl class="facts">
        <dt>Type</dt><dd>${isDealer ? 'Dealer' : 'User (buyer)'}</dd>
        ${isDealer ? `<dt>Contact name</dt><dd>${esc(a.name)}</dd>` : ''}
        <dt>Email</dt><dd><a href="mailto:${esc(a.email)}">${esc(a.email)}</a> ${
          a.emailVerified ? '<span class="pill open">confirmed</span>' : '<span class="pill pending">not confirmed</span>'
        }</dd>
        <dt>Phone</dt><dd>${a.phone ? `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : '<span class="muted">—</span>'}</dd>
        <dt>Signed up</dt><dd>${new Date(`${a.createdAt.replace(' ', 'T')}Z`).toLocaleString()} (${ago(a.createdAt)})</dd>
        <dt>Last login</dt><dd>${when(a.lastLoginAt)}</dd>
        <dt>Accepted terms</dt><dd>${a.termsAcceptedAt ? ago(a.termsAcceptedAt) : '<span class="muted">before terms existed</span>'}</dd>
        ${
          isDealer
            ? `<dt>Responses sent</dt><dd>${a.responseCount}</dd>`
            : `<dt>Requests</dt><dd>${a.requestCount} total · ${a.openRequestCount} open</dd>`
        }
      </dl>
      ${actions ? `<div class="row">${actions}</div>` : ''}
      ${a.isAdmin ? '<p class="muted">Admin accounts can\'t be frozen. Admins are set with ADMIN_EMAILS in Render.</p>' : ''}
      <p class="error" id="admin-error"></p>
    </div>
    ${isDealer ? verificationSection(a) : ''}
    ${
      isDealer && reports.length
        ? `<h2 style="margin-top:24px">Reports from buyers (${a.dealer.openReports} open)</h2><div class="list">${reports.map((rep) => reportCard(rep, { showDealer: false })).join('')}</div>`
        : ''
    }
    <h2 style="margin-top:24px">${isDealer ? 'Responses' : 'Requests'}</h2>
    ${activity}`;

  const fail = (err) => (view.querySelector('#admin-error').textContent = err.message);
  const patch = async (body) => {
    try {
      await api(`/api/admin/accounts/${a.id}`, { method: 'PATCH', body });
      render();
    } catch (err) {
      fail(err);
    }
  };
  view.querySelectorAll('[data-patch]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
      b.disabled = true;
      patch(JSON.parse(b.dataset.patch));
    }),
  );
  view.querySelector('#freeze')?.addEventListener('click', () => {
    const reason = prompt(
      `Freeze ${a.businessName || a.name}?\n\nThey'll be signed out immediately and can't sign back in. ${
        isDealer ? 'Their responses will be hidden from buyers.' : 'Their requests will be hidden from dealers.'
      }\n\nOptional reason (only admins see it):`,
    );
    if (reason === null) return; // cancelled
    patch({ frozen: true, reason });
  });
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => go(tr.dataset.href)));
  bindReportButtons();
  view.querySelectorAll('[data-check]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.done === 'false') return patch({ check: b.dataset.check, done: false });
      const note = prompt(`${CHECK_LABELS[b.dataset.check]}\n\nOptional note (e.g. "License #V123 active, exp. 2027" or "Spoke to Maria at front desk"):`);
      if (note !== null) patch({ check: b.dataset.check, done: true, note });
    }),
  );
}

const CHECK_LABELS = {
  license: 'Dealer license looked up with the state',
  web: 'Website, Google listing or references match',
  call: 'Called the publicly listed business number and confirmed',
};

const EMAIL_SIGNAL_LABELS = {
  match: ['open', 'Email matches their website domain'],
  free: ['pending', 'Free email provider — check more carefully'],
  other: ['fulfilled', "Email doesn't match their website"],
};

// What the dealer told us, quick-lookup links, and the checklist an admin works through before approving.
function verificationSection(a) {
  const d = a.dealer;
  const q = (text) => encodeURIComponent(text);
  const site = d.website ? (/^https?:\/\//i.test(d.website) ? d.website : `https://${d.website}`) : null;
  const [signalClass, signalText] = EMAIL_SIGNAL_LABELS[d.emailSignal];
  const lookups = [
    site && `<a href="${esc(site)}" target="_blank" rel="noopener">Open website</a>`,
    `<a href="https://www.google.com/search?q=${q(`"${a.businessName}" ${d.businessAddress ?? ''}`)}" target="_blank" rel="noopener">Google the business</a>`,
    `<a href="https://www.google.com/maps/search/${q(`${a.businessName} ${d.businessAddress ?? ''}`)}" target="_blank" rel="noopener">Find on Google Maps</a>`,
    d.licenseState &&
      `<a href="https://www.google.com/search?q=${q(`${d.licenseState} motor vehicle dealer license lookup`)}" target="_blank" rel="noopener">${esc(d.licenseState)} license lookup</a>`,
  ].filter(Boolean);

  const rows = ['license', 'web', 'call'].map((key) => {
    const done = d.checks[key];
    const required = d.requiredChecks.includes(key);
    return `
      <li class="check ${done ? 'done' : ''}">
        <span class="check-box">${done ? '✓' : ''}</span>
        <div>
          <strong>${CHECK_LABELS[key]}</strong>${required ? '' : ' <span class="muted">(optional for brokers without a license)</span>'}
          ${done ? `<div class="muted">${esc(done.by)} · ${ago(done.at.replace('T', ' ').slice(0, 19))}${done.note ? ` — “${esc(done.note)}”` : ''}</div>` : ''}
          ${key === 'call' && !done ? '<div class="muted">Call the number on their website or Google listing, not the one they typed in.</div>' : ''}
        </div>
        <button class="secondary small" data-check="${key}" data-done="${done ? 'false' : 'true'}">${done ? 'Undo' : 'Mark done'}</button>
      </li>`;
  });

  return `
    <div class="card" style="margin-top:16px">
      <div class="row spread">
        <h2 style="margin:0">Verification</h2>
        ${d.verified ? verifiedBadge(d.type) : `<span class="muted">${d.missingChecks.length ? `${d.requiredChecks.length - d.missingChecks.length} of ${d.requiredChecks.length} required checks done` : 'Checks complete — ready to approve'}</span>`}
      </div>
      <dl class="facts">
        <dt>Applied as</dt><dd>${d.type === 'broker' ? 'Broker / independent specialist' : 'Licensed dealer'}</dd>
        <dt>Their role</dt><dd>${esc(d.jobTitle ?? '—')}</dd>
        <dt>Email check</dt><dd><span class="pill ${signalClass}">${signalText}</span></dd>
        <dt>Business phone</dt><dd>${a.phone ? esc(a.phone) : '—'} <span class="muted">(as entered — verify independently)</span></dd>
        <dt>Address</dt><dd>${esc(d.businessAddress ?? '—')}</dd>
        <dt>Website</dt><dd>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(d.website)}</a>` : '—'}</dd>
        <dt>License</dt><dd>${d.licenseNumber ? `${esc(d.licenseNumber)} · ${esc(d.licenseState)}` : '—'}</dd>
        ${d.experience ? `<dt>Track record</dt><dd style="white-space:pre-wrap">${esc(d.experience)}</dd>` : ''}
      </dl>
      <p class="row lookups">${lookups.join('')}</p>
      <ul class="checklist">${rows.join('')}</ul>
      ${a.status !== 'active' && d.missingChecks.length ? '<p class="muted">The Approve button appears once the required checks are done.</p>' : ''}
    </div>`;
}

// ---------- router ----------

const home = () => (!me ? '#/' : me.role === 'dealer' ? '#/browse' : '#/my');
const dealerBlocked = () => me.role === 'dealer' && me.status !== 'active';

async function render() {
  const [path, search = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(search);
  renderNav();
  renderBanner();

  // Pages anyone can open, signed in or not.
  const openRoutes = {
    '': landing,
    '/': landing,
    '/terms': () => legalPage('Terms of Service', TERMS_HTML),
    '/privacy': () => legalPage('Privacy Policy', PRIVACY_HTML),
    '/verify': verifyEmailPage,
    '/reset': resetPassword,
    '/unsubscribe': unsubscribePage,
    '/signup': signup,
    '/contact': contactPage,
  };
  if (path in openRoutes) return openRoutes[path](params);

  // Pages for signed-out visitors only.
  const guestRoutes = { '/login': login, '/forgot': forgotPassword };
  if (path in guestRoutes) {
    if (me) return go(home());
    return guestRoutes[path](params);
  }
  if (!me) return go('#/login');

  try {
    if (me.isAdmin && path === '/admin') return await admin(params);
    if (me.role === 'dealer' && path === '/alerts') return alertSettingsPage();
    if (path === '/profile') return profilePage();
    const adminDetail = path.match(/^\/admin\/account\/(\d+)$/);
    if (me.isAdmin && adminDetail) return await adminAccount(adminDetail[1]);
    if (me.isAdmin && path === '/admin/requests') return await adminRequests(params);
    if (me.isAdmin && path === '/admin/reports') return await adminReports(params);
    const adminEdit = path.match(/^\/admin\/request\/(\d+)\/edit$/);
    if (me.isAdmin && adminEdit) return await adminEditRequest(adminEdit[1]);
    if (dealerBlocked()) return dealerNotApproved();
    const detail = path.match(/^\/request\/(\d+)$/);
    if (detail) return await requestDetail(detail[1]);
    if (me.role === 'user' && path === '/my') return await myRequests();
    if (me.role === 'user' && path === '/new') return newRequestPage();
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
