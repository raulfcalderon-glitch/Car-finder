// Sends email through Resend (https://resend.com) using its HTTP API, so no extra packages are needed.
// Without an API key, emails are printed to the server log instead — handy for local development.

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer({ apiKey, from, log = console } = {}) {
  return async function sendEmail({ to, subject, text, html, replyTo }) {
    if (!apiKey) {
      log.log(`[email not sent: RESEND_API_KEY not set] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html, reply_to: replyTo }),
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
export function newResponseEmail({ request, response, dealer, buyer, appUrl }) {
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
      `Contact: ${contact}\n\n` +
      `See all responses: ${link}\n\n` +
      `You can reply to this email to reach the dealer directly.\n— Car Finder`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1b1f24;line-height:1.5">
        <p>Hi ${esc(buyer.name.split(/\s+/)[0])},</p>
        <p><strong>${esc(dealerName)}</strong> responded to your request for a <strong>${esc(vehicle)}</strong>.</p>
        ${response.price != null ? `<p style="font-size:18px">Asking price: <strong>${esc(money(response.price))}</strong></p>` : ''}
        <blockquote style="margin:0;padding:8px 14px;border-left:3px solid #b3261e;background:#f6f7f9;white-space:pre-wrap">${esc(response.message)}</blockquote>
        <p style="color:#5f6b7a">Contact: ${esc(contact)}</p>
        <p><a href="${esc(link)}" style="display:inline-block;background:#b3261e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">See all responses</a></p>
        <p style="color:#5f6b7a;font-size:13px">You can reply to this email to reach the dealer directly.<br>— Car Finder</p>
      </div>`,
  };
}
