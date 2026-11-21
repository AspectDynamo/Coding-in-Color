/**
 * Student access codes. 16 Crockford base32 chars from the CSPRNG (rejection sampling, no modulo
 * bias), stored only as hex HMAC-SHA256(CREDENTIAL_PEPPER, normalized code).
 */
import { ACCESS_CODE_LENGTH, CROCKFORD_ALPHABET } from '@shared/constants';
import type { AppConfig } from '../config';
import type { DataStore } from '../repositories/types';
import { hmacSha256Hex, randomIndex } from './crypto';

export function generateAccessCode(length = ACCESS_CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++)
    out += CROCKFORD_ALPHABET[randomIndex(CROCKFORD_ALPHABET.length)];
  return out;
}

/** XXXX-XXXX-XXXX-XXXX */
export function formatAccessCode(raw: string): string {
  return (raw.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Uppercase, strip whitespace/dashes, I/L→1, O→0, drop U. Returns null when the result is not
 * exactly 16 chars of the Crockford alphabet (caller answers with the same invalid_code error).
 */
export function normalizeAccessCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const n = input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, '');
  if (n.length !== ACCESS_CODE_LENGTH) return null;
  for (const ch of n) if (!CROCKFORD_ALPHABET.includes(ch)) return null;
  return n;
}

export async function hashAccessCode(normalized: string, pepper: string): Promise<string> {
  return hmacSha256Hex(pepper, normalized);
}

/** Non-secret public label, e.g. S-7KQ2M9. Uniqueness is enforced by the store (caller retries). */
export function generatePublicCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CROCKFORD_ALPHABET[randomIndex(CROCKFORD_ALPHABET.length)];
  return `S-${out}`;
}

/**
 * Student sign-in lookup with pepper rotation. New credentials always use the current pepper and
 * key version. While CREDENTIAL_PEPPER_PREVIOUS is set, a code that matches nothing under the current
 * pepper may match a credential hashed with the previous one, but only if that credential's
 * key_version is lower than the current version. Both hashes and both lookups run every time (in
 * parallel), so whether the code is unknown, current or legacy is not observable through timing.
 */
export async function findCredentialForCode(
  store: DataStore,
  normalized: string,
  cfg: Pick<AppConfig, 'credentialPepper' | 'credentialPepperPrevious' | 'keyVersion'>,
) {
  const previousPepper = cfg.credentialPepperPrevious;
  const [currentHash, previousHash] = await Promise.all([
    hashAccessCode(normalized, cfg.credentialPepper),
    previousPepper ? hashAccessCode(normalized, previousPepper) : Promise.resolve(null),
  ]);
  const [current, previous] = await Promise.all([
    store.findCredentialByHash(currentHash),
    previousHash ? store.findCredentialByHash(previousHash) : Promise.resolve(null),
  ]);
  if (current) return current;
  if (previous && previous.credential.key_version < cfg.keyVersion) return previous;
  return null;
}
