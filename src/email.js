// Sends email through Resend (https://resend.com) using its HTTP API, so no extra packages are needed.
// Without an API key, emails are printed to the server log instead — handy for local development.

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// `replyTo` is the default reply address (e.g. hello@yourdomain.com); emails that name their own,
// like a dealer's response, keep theirs.
export function createMailer({ apiKey, from, replyTo: defaultReplyTo, log = console } = {}) {
  return async function sendEmail({ to, subject, text, html, replyTo = defaultReplyTo, headers }) {
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
        <blockquote style="margin:0;padding:8px 14px;border-left:3px solid #c8102e;background:#f6f7f9;white-space:pre-wrap">${esc(response.message)}</blockquote>
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
  `<a href="${esc(href)}" style="display:inline-block;background:#c8102e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(label)}</a>`;

const wrap = (body) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1b1f24;line-height:1.5">${body}</div>`;

// Email to an admin when a new dealer signs up and needs approval.
const EMAIL_SIGNALS = {
  match: '✓ Matches their website domain',
  free: 'Free email provider (e.g. Gmail) — check more carefully',
  other: "Doesn't match their website",
};

export function newDealerEmail({ dealer, to, appUrl, emailSignal }) {
  const link = `${appUrl}/#/admin/account/${dealer.id}`;
  const details = [
    ['Type', dealer.dealer_type === 'broker' ? 'Broker / independent specialist' : 'Licensed dealer'],
    ['Business', dealer.business_name],
    ['Name', [dealer.name, dealer.job_title].filter(Boolean).join(' — ')],
    ['Email', dealer.email],
    ['Email check', EMAIL_SIGNALS[emailSignal]],
    ['Phone', dealer.phone],
    ['Address', dealer.business_address],
    ['Website', dealer.website],
    ['License', dealer.license_number ? `${dealer.license_number} (${dealer.license_state})` : null],
    ['Track record', dealer.experience],
  ].filter(([, v]) => v);

  return {
    to,
    replyTo: dealer.email,
    subject: `New dealer waiting for approval: ${dealer.business_name || dealer.name}`,
    text:
      `A new dealer signed up for CarsFindMe and is waiting for approval.\n\n` +
      details.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nVerify and approve: ${link}\n— CarsFindMe`,
    html: wrap(`
      <p>A new dealer signed up for CarsFindMe and is waiting for approval.</p>
      <table style="border-collapse:collapse;margin:12px 0">${details
        .map(([k, v]) => `<tr><td style="color:#5f6b7a;padding:2px 16px 2px 0">${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join('')}</table>
      <p>${button(link, 'Verify this dealer')}</p>`),
  };
}

// A new chat message on a response. Sent for the first unread message only, so a burst of messages is one email.
export function newMessageEmail({ to, recipientName, senderName, request, body, link }) {
  const vehicle = vehicleName(request);
  const first = recipientName.split(/\s+/)[0];
  const snippet = body.length > 400 ? `${body.slice(0, 400)}…` : body;
  return {
    to,
    subject: `New message from ${senderName} about the ${vehicle}`,
    text:
      `Hi ${first},\n\n${senderName} sent you a message on CarsFindMe about the ${vehicle}:\n\n"${snippet}"\n\n` +
      `Reply on CarsFindMe: ${link}\n\nReplying to this email won't reach them; use the link above.\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(first)},</p>
      <p><strong>${esc(senderName)}</strong> sent you a message about the <strong>${esc(vehicle)}</strong>:</p>
      <blockquote style="margin:0 0 12px;padding:8px 14px;border-left:3px solid #c8102e;background:#f6f7f9;white-space:pre-wrap">${esc(snippet)}</blockquote>
      <p>${button(link, 'Reply on CarsFindMe')}</p>
      <p style="color:#5f6b7a;font-size:13px">Replying to this email won't reach them; use the button above.<br>— CarsFindMe</p>`),
  };
}

// Confirmation after someone deletes their own account.
export function accountDeletedEmail({ account }) {
  const first = account.name.split(/\s+/)[0];
  return {
    to: account.email,
    subject: 'Your CarsFindMe account has been deleted',
    text:
      `Hi ${first},\n\n` +
      `As you asked, we've deleted your CarsFindMe account and everything in it${account.role === 'dealer' ? ', including your profile and responses' : ', including your requests'}.\n\n` +
      `If this wasn't you, reply to this email right away.\n\nThanks for trying CarsFindMe. You're welcome back any time.\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(first)},</p>
      <p>As you asked, we've deleted your CarsFindMe account and everything in it${account.role === 'dealer' ? ', including your profile and responses' : ', including your requests'}.</p>
      <p>If this wasn't you, reply to this email right away.</p>
      <p style="color:#5f6b7a;font-size:13px">Thanks for trying CarsFindMe. You're welcome back any time.<br>— CarsFindMe</p>`),
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
      `Browse requests: ${link}\n\n` +
      `Tip: buyers can tap your name to see your public profile. Add a cover photo, a short bio, your specialties and a few showroom photos so they know who they're dealing with: ${appUrl}/#/dealer-profile\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(dealer.name.split(/\s+/)[0])},</p>
      <p>Your dealer account${dealer.business_name ? ` for <strong>${esc(dealer.business_name)}</strong>` : ''} has been approved.
        You can now browse buyer requests and respond with what you have.</p>
      <p>${button(link, 'Browse requests')}</p>
      <p><strong>Tip:</strong> buyers can tap your name to see your public profile. Add a cover photo, a short bio, your specialties and a few showroom photos so they know who they're dealing with. <a href="${esc(`${appUrl}/#/dealer-profile`)}">Set up your profile</a></p>
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
      ${request.notes ? `<blockquote style="margin:0 0 12px;padding:8px 14px;border-left:3px solid #c8102e;background:#f6f7f9;white-space:pre-wrap">${esc(request.notes)}</blockquote>` : ''}
      <p>${button(link, 'View and respond')}</p>
      <p style="color:#5f6b7a;font-size:13px"><a href="${esc(settingsLink)}" style="color:#5f6b7a">Change which requests you hear about</a> · <a href="${esc(unsubscribeLink)}" style="color:#5f6b7a">Unsubscribe</a><br>— CarsFindMe</p>`),
  };
}

// Email to admins when a buyer reports a dealer's response.
export function dealerReportEmail({ to, report, dealer, reporter, request, response, reasonLabel, openReports, appUrl }) {
  const link = `${appUrl}/#/admin/account/${dealer.id}`;
  const details = [
    ['Dealer', `${dealer.business_name || dealer.name} (${dealer.email})`],
    ['Reported by', `${reporter.name} (${reporter.email})`],
    ['Reason', reasonLabel],
    ['Details', report.details],
    ['Request', vehicleName(request)],
    ['Their response', response.message],
    ['Open reports on this dealer', String(openReports)],
  ].filter(([, v]) => v);
  return {
    to,
    replyTo: reporter.email,
    subject: `Dealer reported: ${dealer.business_name || dealer.name} — ${reasonLabel}`,
    text:
      `A buyer reported a dealer on CarsFindMe.\n\n` +
      details.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nReview the dealer (you can freeze them from there): ${link}\n— CarsFindMe`,
    html: wrap(`
      <p>A buyer reported a dealer on CarsFindMe.</p>
      <table style="border-collapse:collapse;margin:12px 0">${details
        .map(([k, v]) => `<tr><td style="color:#5f6b7a;padding:2px 16px 2px 0;vertical-align:top">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`)
        .join('')}</table>
      <p>${button(link, 'Review this dealer')}</p>
      <p style="color:#5f6b7a;font-size:13px">You can freeze the dealer from their page if needed.<br>— CarsFindMe</p>`),
  };
}

// A message from the Contact us page, sent to admins. Replying goes straight to the sender.
export function contactEmail({ to, name, email, topicLabel, message, account, appUrl }) {
  const who = account ? `${name} (${email}) — signed in as a ${account.role === 'dealer' ? 'dealer' : 'buyer'}` : `${name} (${email})`;
  return {
    to,
    replyTo: email,
    subject: `Contact form: ${topicLabel} — ${name}`,
    text:
      `New message from the CarsFindMe contact page.\n\nFrom: ${who}\nTopic: ${topicLabel}\n\n${message}\n\n` +
      `Reply to this email to answer them directly.${account ? `\nTheir account: ${appUrl}/#/admin/account/${account.id}` : ''}\n— CarsFindMe`,
    html: wrap(`
      <p>New message from the CarsFindMe contact page.</p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="color:#5f6b7a;padding:2px 16px 2px 0">From</td><td>${esc(who)}</td></tr>
        <tr><td style="color:#5f6b7a;padding:2px 16px 2px 0">Topic</td><td>${esc(topicLabel)}</td></tr>
      </table>
      <blockquote style="margin:0 0 12px;padding:8px 14px;border-left:3px solid #c8102e;background:#f6f7f9;white-space:pre-wrap">${esc(message)}</blockquote>
      <p style="color:#5f6b7a;font-size:13px">Reply to this email to answer them directly.${
        account ? `<br><a href="${esc(`${appUrl}/#/admin/account/${account.id}`)}">View their account</a>` : ''
      }<br>— CarsFindMe</p>`),
  };
}

const longDate = (sqlDate) =>
  new Date(`${sqlDate.replace(' ', 'T')}Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

// Reminder to a buyer a week before their request closes itself.
export function requestExpiringEmail({ buyer, request, responseCount, renewLink, link }) {
  const vehicle = vehicleName(request);
  const first = buyer.name.split(/\s+/)[0];
  const closes = longDate(request.expires_at);
  const got = responseCount
    ? `You've had ${responseCount} dealer ${responseCount === 1 ? 'response' : 'responses'} so far.`
    : "Dealers haven't responded yet, but new ones join all the time.";
  return {
    to: buyer.email,
    subject: `Still looking for a ${vehicle}?`,
    text:
      `Hi ${first},\n\n` +
      `Your request for a ${vehicle} closes on ${closes}. ${got}\n\n` +
      `Still looking? Keep it open for another 60 days: ${renewLink}\n\n` +
      `Found one or changed your mind? You don't need to do anything — it will close by itself so dealers stop sending offers.\n\n` +
      `See your request: ${link}\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(first)},</p>
      <p>Your request for a <strong>${esc(vehicle)}</strong> closes on <strong>${esc(closes)}</strong>. ${esc(got)}</p>
      <p>${button(renewLink, 'Still looking — keep it open')}</p>
      <p>Found one or changed your mind? You don't need to do anything. It will close by itself so dealers stop sending offers.</p>
      <p style="color:#5f6b7a;font-size:13px"><a href="${esc(link)}" style="color:#5f6b7a">See your request</a><br>— CarsFindMe</p>`),
  };
}

// Tells a buyer their request closed because it expired, with a one-click way to reopen it.
export function requestExpiredEmail({ buyer, request, renewLink }) {
  const vehicle = vehicleName(request);
  const first = buyer.name.split(/\s+/)[0];
  return {
    to: buyer.email,
    subject: `Your ${vehicle} request has closed`,
    text:
      `Hi ${first},\n\n` +
      `Your request for a ${vehicle} was open for 60 days and has now closed, so dealers won't see it anymore.\n\n` +
      `Still looking? Reopen it for another 60 days: ${renewLink}\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(first)},</p>
      <p>Your request for a <strong>${esc(vehicle)}</strong> was open for 60 days and has now closed, so dealers won't see it anymore.</p>
      <p>${button(renewLink, 'Still looking — reopen it')}</p>
      <p style="color:#5f6b7a;font-size:13px">— CarsFindMe</p>`),
  };
}

// Tells a dealer the buyer marked their response "Interested".
export function responseInterestEmail({ dealer, buyerFirstName, request, response, link }) {
  const vehicle = vehicleName(request);
  const first = dealer.name.split(/\s+/)[0];
  const offer = response.price != null ? ` at ${money(response.price)}` : '';
  return {
    to: dealer.email,
    subject: `${buyerFirstName} is interested in your ${vehicle}`,
    text:
      `Hi ${first},\n\n` +
      `Good news: ${buyerFirstName} marked your response${offer} to their ${vehicle} request as "Interested".\n\n` +
      `They have your contact details and may reach out. Make sure you're easy to reach, and keep your response up to date if anything changes (you can edit it or withdraw it if the car sells).\n\n` +
      `See the request: ${link}\n— CarsFindMe`,
    html: wrap(`
      <p>Hi ${esc(first)},</p>
      <p>Good news: <strong>${esc(buyerFirstName)}</strong> marked your response${esc(offer)} to their <strong>${esc(vehicle)}</strong> request as <strong>Interested</strong>.</p>
      <p>They have your contact details and may reach out. Make sure you're easy to reach, and keep your response up to date if anything changes. You can edit it, or withdraw it if the car sells.</p>
      <p>${button(link, 'See the request')}</p>
      <p style="color:#5f6b7a;font-size:13px">— CarsFindMe</p>`),
  };
}
