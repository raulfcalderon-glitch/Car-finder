// Web Push (the standard behind browser and home-screen-app notifications) without extra packages.
// Messages are encrypted for each device (RFC 8291, "aes128gcm") and signed with our VAPID key
// (RFC 8292) so Apple's, Google's and Mozilla's push services accept them.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// A new P-256 key pair for signing, as base64url strings (public key uncompressed, 65 bytes).
export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidSigningKey({ publicKey, privateKey }) {
  const pub = fromB64u(publicKey);
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(fromB64u(privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

// The Authorization header that proves the message comes from us (valid for 12 hours).
export function vapidHeader(endpoint, keys, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidSigningKey(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// Encrypts the payload so only the subscribed device can read it.
export function encryptPayload(subscription, payload) {
  const uaPublic = fromB64u(subscription.keys.p256dh);
  const authSecret = fromB64u(subscription.keys.auth);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// Sends one notification. Resolves to { ok, gone } — `gone` means the device unsubscribed
// (or the subscription expired) and should be forgotten.
export async function sendPush(subscription, payload, { keys, subject, fetchImpl = fetch, ttl = 24 * 3600 }) {
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(subscription.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body: encryptPayload(subscription, JSON.stringify(payload)),
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}
