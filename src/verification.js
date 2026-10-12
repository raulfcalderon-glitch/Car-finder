// Rules for vetting dealers before they can see buyer requests.

export const DEALER_TYPES = ['dealer', 'broker'];

export const CHECKS = {
  license: 'Dealer license looked up with the state',
  web: 'Website, Google listing or references match',
  call: 'Called the publicly listed business number and confirmed',
};

// Licensed dealers need all three checks; brokers skip the license check unless they gave a license.
export function requiredChecks({ dealer_type, license_number }) {
  return dealer_type === 'broker' && !license_number ? ['web', 'call'] : ['license', 'web', 'call'];
}

export function parseChecks(account) {
  try {
    return JSON.parse(account.verification_checks || '{}') ?? {};
  } catch {
    return {};
  }
}

export function missingChecks(account) {
  const done = parseChecks(account);
  return requiredChecks(account).filter((k) => !done[k]);
}

// Shown to buyers as a "Verified" badge: approved and every required check done.
export function isVerifiedDealer(account) {
  return account.role === 'dealer' && account.status === 'active' && !account.frozen_at && missingChecks(account).length === 0;
}

const FREE_EMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'yandex.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net',
]);

export function websiteHost(website) {
  if (!website) return null;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// A quick signal for admins: does the signup email belong to the business's own domain?
export function emailDomainSignal(email, website) {
  const domain = String(email).split('@')[1]?.toLowerCase() ?? '';
  const host = websiteHost(website);
  if (host && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`))) return 'match';
  if (FREE_EMAIL.has(domain)) return 'free';
  return 'other';
}
