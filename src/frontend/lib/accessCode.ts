import { ACCESS_CODE_LENGTH, CROCKFORD_ALPHABET } from '@shared/constants';

/**
 * Forgiving normalization that mirrors the server: uppercase, strip spaces/dashes and anything
 * else that isn't a letter or digit, map I/L → 1 and O → 0, drop U (not in Crockford base32).
 */
export function normalizeCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    let c = ch;
    if (c === 'I' || c === 'L') c = '1';
    else if (c === 'O') c = '0';
    if (CROCKFORD_ALPHABET.includes(c)) out += c;
  }
  return out.slice(0, ACCESS_CODE_LENGTH);
}

/** XXXX-XXXX-XXXX-XXXX as the student types. */
export function formatCode(raw: string): string {
  const n = normalizeCode(raw);
  return n.match(/.{1,4}/g)?.join('-') ?? '';
}

export function isCompleteCode(raw: string): boolean {
  return normalizeCode(raw).length === ACCESS_CODE_LENGTH;
}

/** Reads `#code=XXXX-…` from a URL fragment (the fragment never reaches the server). */
export function readCodeFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h) return null;
  const value = new URLSearchParams(h).get('code');
  if (!value) return null;
  const formatted = formatCode(value);
  return formatted || null;
}

/** One identical message for unknown, revoked and mistyped codes — never hints which it was. */
export const BAD_CODE_MESSAGE =
  'That code didn’t work. Check your card and try again, or ask your instructor for help.';
export const RATE_LIMIT_MESSAGE = 'Too many tries. Take a breath, wait one minute, then try again.';
