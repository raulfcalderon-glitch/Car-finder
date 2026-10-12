// Verifies "Sign in with Google" ID tokens without any extra packages: the token is a JWT signed
// by Google, so we check its RS256 signature against Google's published keys, then its claims.
import { createPublicKey, verify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Google rotates its keys every few weeks; cache them for as long as Google says to.
export function googleCertsFetcher() {
  let cached = null;
  let expires = 0;
  return async function fetchCerts() {
    if (cached && Date.now() < expires) return cached;
    const res = await fetch(CERTS_URL);
    if (!res.ok) throw new Error(`Google certs responded ${res.status}`);
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    cached = await res.json();
    expires = Date.now() + maxAge * 1000;
    return cached;
  };
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

// Returns the token's claims ({ sub, email, name, ... }) or null if it isn't a valid token for us.
export async function verifyGoogleIdToken(token, { clientId, fetchCerts, now = Date.now() }) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = decode(parts[0]);
    claims = decode(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  const jwk = (await fetchCerts()).keys?.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const signed = verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signed) return null;
  if (!ISSUERS.includes(claims.iss) || claims.aud !== clientId) return null;
  if (!claims.exp || claims.exp * 1000 < now - 60_000) return null; // a minute of clock slack
  if (!claims.sub || !claims.email) return null;
  return claims;
}
