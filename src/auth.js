import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

// Email-link tokens are stored hashed; the raw token only ever lives in the email.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
