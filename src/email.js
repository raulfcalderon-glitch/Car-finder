// Sends email through Resend (https://resend.com) using its HTTP API, so no extra packages are needed.
// Without an API key, emails are printed to the server log instead — handy for local development.

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer({ apiKey, from, log = console } = {}) {
  return async function sendEmail({ to, subject, text, html, replyTo, headers }) {
    if (!apiKey) {
      log.log(`[email not sent: RESEND_API_KEY not set] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html, reply_to: replyTo, headers }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  };
}

const money = (n) => `$${Number(n).toLocaleString('en-US')}`;

function vehicleName(r) {
  const year = r.year_min && r.year_min === r.year_max ? `${r.year_min} ` : '';
  return `${year}${r.make} ${r.model}${r.trim ? ` ${r.trim}` : ''}`;
}

// Email to a buyer when a dealer responds to one of their requests.
export function newResponseEmail({ request, response, dealer, buyer, appUrl, photoUrls = [] }) {
  const vehicle = vehicleName(request);
  const dealerName = dealer.business_name || dealer.name;
  const link = `${appUrl}/#/request/${request.id}`;
  const price = response.price != null ? `Asking price: ${money(response.price)}\n` : '';
  const contact = [dealer.name, dealer.email, dealer.phone].filter(Boolean).join(' · ');

  return {
    to: buyer.email,
    replyTo: dealer.email,
    subject: `${dealerName} responded to your ${vehicle} request`,
    text:
      `Hi ${buyer.name.split(/\s+/)[0]},\n\n` +
      `${dealerName} responded to your request for a ${vehicle}.\n\n` +
      `${price}"${response.message}"\n\n` +
      (photoUrls.length ? `${photoUrls.length} photo${photoUrls.length === 1 ? '' : 's'} attached — see them on CarsFindMe.\n\n` : '') +
      `Contact: ${contact}\n\n` +
      `See all responses: ${link}\n\n` +
      `You can reply to this email to reach the dealer directly.\n— CarsFindMe`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1b1f24;line-height:1.5">
        <p>Hi ${esc(buyer.name.split(/\s+/)[0])},</p>
        <p><strong>${esc(dealerName)}</strong> responded to your request for a <strong>${esc(vehicle)}</strong>.</p>
        ${response.price != null ? `<p style="font-size:18px">Asking price: <strong>${esc(money(response.price))}</strong></p>` : ''}
        <blockquote style="margin:0;padding:8px 14px;border-left:3px solid #b3261e;background:#f6f7f9;white-space:pre-wrap">${esc(response.message)}</blockquote>
        ${
          photoUrls.length
            ? `<p>${photoUrls
                .slice(0, 3)
                .map((u) => `<a href="${esc(link)}"><img src="${esc(u)}" alt="Photo from ${esc(dealerName)}" width="170" style="width:170px;height:120px;object-fit:cover;border-radius:6px;margin:0 6px 6px 0"></a>`)
                .join('')}${photoUrls.length > 3 ? `<br><span style="color:#5f6b7a">+ ${photoUrls.length - 3} more on CarsFindMe</span>` : ''}</p>`
            : ''
        }
        <p style="color:#5f6b7a">Contact: ${esc(contact)}</p>
        <p>${button(link, 'See all responses')}</p>
        <p style="color:#5f6b7a;font-size:13px">You can reply to this email to reach the dealer directly.<br>— CarsFindMe</p>
      </div>`,
  };
}

const button = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#b3261e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(label)}</a>`;

const wrap = (body) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1b1f24;line-height:1.5">${body}</div>`;

// Email to an admin when a new dealer signs up and needs approval.
export function newDealerEmail({ dealer, to, appUrl }) {
  const link = `${appUrl}/#/admin`;
  const details = [
    ['Business', dealer.business_name],
    ['Name', dealer.name],
    ['Email', dealer.email],
    ['Phone', dealer.phone],
  ].filter(([, v]) => v);

  return {
    to,
    replyTo: dealer.email,
    subject: `New dealer waiting for approval: ${dealer.business_name || dealer.name}`,
    text:
      `A new dealer signed up for CarsFindMe and is waiting for approval.\n\n` +
      details.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nReview and approve: ${link}\n— CarsFindMe`,
    html: wrap(`
      <p>A new dealer signed up for CarsFindMe and is waiting for approval.</p>
      <table style="border-collapse:collapse;margin:12px 0">${details
        .map(([k, v]) => `<tr><td style="color:#5f6b7a;padding:2px 16px 2px 0">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join('')}</table>
      <p>${button(link, 'Review dealers')}</p>`),
  };
}

// Email to a dealer once an admin approves their account.
export function dealerApprovedEmail({ dealer, appUrl }) {
  const link = `${appUrl}/#/browse`;
  return {
    to: dealer.email,
    subject: 'Your CarsFindMe dealer account is approved',
    text:
      `Hi ${dealer.name.split(/\s+/)[0]},\n\n` +
      `Your dealer account${dealer.business_name ? ` for ${dealer.business_name}` : ''} has been approved. ` +
      `You can now browse buyer requests and respond with what you have.\n\n` +
      `Browse requests: ${link}\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(dealer.name.split(/\s+/)[0])},</p>
      <p>Your dealer account${dealer.business_name ? ` for <strong>${esc(dealer.business_name)}</strong>` : ''} has been approved.
        You can now browse buyer requests and respond with what you have.</p>
      <p>${button(link, 'Browse requests')}</p>
      <p style="color:#5f6b7a;font-size:13px">— CarsFindMe</p>`),
  };
}

// Email asking a new account to confirm their address.
export function verifyEmail({ account, link }) {
  return {
    to: account.email,
    subject: 'Confirm your CarsFindMe email',
    text:
      `Hi ${account.name.split(/\s+/)[0]},\n\n` +
      `Please confirm your email address to finish setting up your CarsFindMe account:\n${link}\n\n` +
      `This link works for 7 days. If you didn't sign up, you can ignore this email.\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(account.name.split(/\s+/)[0])},</p>
      <p>Please confirm your email address to finish setting up your CarsFindMe account.</p>
      <p>${button(link, 'Confirm email')}</p>
      <p style="color:#5f6b7a;font-size:13px">This link works for 7 days. If you didn't sign up, you can ignore this email.<br>— CarsFindMe</p>`),
  };
}

// Email with a link to choose a new password.
export function passwordResetEmail({ account, link }) {
  return {
    to: account.email,
    subject: 'Reset your CarsFindMe password',
    text:
      `Hi ${account.name.split(/\s+/)[0]},\n\n` +
      `Someone (hopefully you) asked to reset your CarsFindMe password. Choose a new one here:\n${link}\n\n` +
      `This link works for 1 hour and can only be used once. If you didn't ask for this, you can ignore this email — your password won't change.\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(account.name.split(/\s+/)[0])},</p>
      <p>Someone (hopefully you) asked to reset your CarsFindMe password.</p>
      <p>${button(link, 'Choose a new password')}</p>
      <p style="color:#5f6b7a;font-size:13px">This link works for 1 hour and can only be used once. If you didn't ask for this, you can ignore this email — your password won't change.<br>— CarsFindMe</p>`),
  };
}

// Email to a dealer when a buyer posts a request matching their alert settings.
export function newRequestAlertEmail({ dealer, request, link, settingsLink, unsubscribeLink, unsubscribeUrl }) {
  const vehicle = vehicleName(request);
  const years =
    request.year_min && request.year_max && request.year_min !== request.year_max
      ? `${request.year_min}–${request.year_max}`
      : request.year_min || request.year_max || null;
  const facts = [
    ['Years', years],
    ['Trim / variant', request.trim],
    ['Budget', request.max_budget != null ? `up to ${money(request.max_budget)}` : null],
    ['Color', request.color],
    ['Location', request.location],
  ].filter(([, v]) => v);

  return {
    to: dealer.email,
    subject: `New request: ${vehicle}${request.max_budget != null ? ` — up to ${money(request.max_budget)}` : ''}`,
    // Lets mail apps show their own "Unsubscribe" button that works in one click.
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    text:
      `A buyer on CarsFindMe is looking for a ${vehicle}.\n\n` +
      facts.map(([k, v]) => `${k}: ${v}`).join('\n') +
      (request.notes ? `\n\nNotes: ${request.notes}` : '') +
      `\n\nView and respond: ${link}\n\n` +
      `Change which requests you hear about: ${settingsLink}\nUnsubscribe from these alerts: ${unsubscribeLink}\n— CarsFindMe`,
    html: wrap(`
      <p>A buyer on CarsFindMe is looking for a <strong>${esc(vehicle)}</strong>.</p>
      <table style="border-collapse:collapse;margin:12px 0">${facts
        .map(([k, v]) => `<tr><td style="color:#5f6b7a;padding:2px 16px 2px 0">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join('')}</table>
      ${request.notes ? `<blockquote style="margin:0 0 12px;padding:8px 14px;border-left:3px solid #b3261e;background:#f6f7f9;white-space:pre-wrap">${esc(request.notes)}</blockquote>` : ''}
      <p>${button(link, 'View and respond')}</p>
      <p style="color:#5f6b7a;font-size:13px"><a href="${esc(settingsLink)}" style="color:#5f6b7a">Change which requests you hear about</a> · <a href="${esc(unsubscribeLink)}" style="color:#5f6b7a">Unsubscribe</a><br>— CarsFindMe</p>`),
  };
}
