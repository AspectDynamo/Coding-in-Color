/** Web Crypto helpers only (no Node crypto) so the same code runs in Workers and Vitest. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(s) as Uint8Array<ArrayBuffer>;
}
export function utf8Decode(b: Uint8Array): string {
  return decoder.decode(b);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** Uniform integer in [0, max) by rejection sampling over bytes (no modulo bias). max in 1..256. */
export function randomIndex(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 256)
    throw new RangeError('max must be an integer in 1..256');
  const limit = 256 - (256 % max); // largest multiple of max <= 256
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v < limit) return v % max;
  }
}

export function randomToken(bytes = 32): string {
  return base64urlEncode(randomBytes(bytes));
}

async function importHmacKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256(
  key: string | Uint8Array<ArrayBuffer>,
  message: string | Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const k = await importHmacKey(typeof key === 'string' ? utf8(key) : key);
  const sig = await crypto.subtle.sign(
    'HMAC',
    k,
    typeof message === 'string' ? utf8(message) : message,
  );
  return new Uint8Array(sig);
}
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  return toHex(await hmacSha256(key, message));
}

/** Constant-time comparison. Different lengths return false after a full-length dummy pass. */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = typeof a === 'string' ? utf8(a) : a;
  const y = typeof b === 'string' ? utf8(b) : b;
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/* ---------------------------------------------------------------- AES-GCM sealing */

const HKDF_SALT = utf8('cic-impact-hkdf-salt-v1');

/** AES-256-GCM key derived from the secret with HKDF-SHA256; `info` separates purposes. */
async function deriveAesKey(secret: string, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts `plaintext` with AES-GCM under a key HKDF-derived from `secret` and `info`, using a random
 * 96-bit IV. `aad` (e.g. the staff id) is authenticated but not stored. Output: base64url(iv || ciphertext+tag).
 */
export async function sealString(
  secret: string,
  info: string,
  plaintext: string,
  aad = '',
): Promise<string> {
  const key = await deriveAesKey(secret, info);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(aad) },
      key,
      utf8(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return base64urlEncode(out);
}

/** Inverse of sealString; returns null for any malformed, tampered or wrong-key/wrong-aad input. */
export async function openString(
  secret: string,
  info: string,
  sealed: string,
  aad = '',
): Promise<string | null> {
  try {
    const bytes = base64urlDecode(sealed);
    if (bytes.length < 12 + 16) return null;
    const key = await deriveAesKey(secret, info);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(aad) },
      key,
      bytes.slice(12),
    );
    return utf8Decode(new Uint8Array(pt));
  } catch {
    return null;
  }
}
