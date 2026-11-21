import { describe, expect, it } from 'vitest';
import { CROCKFORD_ALPHABET } from '../../../src/shared/constants';
import {
  base64urlDecode,
  base64urlEncode,
  hmacSha256Hex,
  randomBytes,
  randomIndex,
  timingSafeEqual,
} from '../../../src/backend/services/crypto';
import {
  formatAccessCode,
  generateAccessCode,
  generatePublicCode,
  hashAccessCode,
  normalizeAccessCode,
} from '../../../src/backend/services/credentials';

describe('crypto helpers', () => {
  it('HMAC-SHA256 matches the RFC 4231 test vector', async () => {
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('timingSafeEqual compares strings and bytes, including different lengths', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  });

  it('base64url round-trips', () => {
    const b = randomBytes(33);
    const enc = base64urlEncode(b);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...base64urlDecode(enc)]).toEqual([...b]);
  });

  it('randomIndex is within range and roughly uniform (no modulo bias)', () => {
    const max = 32;
    const counts = new Array<number>(max).fill(0);
    const N = 64_000;
    for (let i = 0; i < N; i++) counts[randomIndex(max)]!++;
    const expected = N / max;
    for (const c of counts) expect(Math.abs(c - expected)).toBeLessThan(expected * 0.15);
    // A non-power-of-two alphabet would show bias under naive modulo; check one too.
    const c33 = new Array<number>(33).fill(0);
    for (let i = 0; i < 66_000; i++) c33[randomIndex(33)]!++;
    expect(Math.min(...c33)).toBeGreaterThan(1700);
    expect(Math.max(...c33)).toBeLessThan(2300);
    expect(() => randomIndex(0)).toThrow();
    expect(() => randomIndex(257)).toThrow();
  });
});

describe('access codes', () => {
  it('generates 16 Crockford characters from the alphabet only', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateAccessCode();
      expect(code).toHaveLength(16);
      for (const ch of code) expect(CROCKFORD_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('is unique across many draws and every alphabet character appears', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateAccessCode();
      seen.add(c);
      for (const ch of c) chars.add(ch);
    }
    expect(seen.size).toBe(2000);
    expect(chars.size).toBe(32);
  });

  it('formats as XXXX-XXXX-XXXX-XXXX', () => {
    expect(formatAccessCode('0123456789ABCDEF')).toBe('0123-4567-89AB-CDEF');
    expect(formatAccessCode(generateAccessCode())).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  });

  it('normalizes case, separators and ambiguous characters', () => {
    const canonical = '0123456789ABCDEF';
    expect(normalizeAccessCode('0123-4567-89AB-CDEF')).toBe(canonical);
    expect(normalizeAccessCode('  0123 4567 89ab cdef ')).toBe(canonical);
    expect(normalizeAccessCode('O123-4567-89AB-CDEF')).toBe(canonical); // O -> 0
    expect(normalizeAccessCode('0123-4567-89AB-CDEF'.replace('1', 'l'))).toBe(canonical); // l -> 1
    expect(normalizeAccessCode('0123-4567-89AB-CDEF'.replace('1', 'I'))).toBe(canonical); // I -> 1
    expect(normalizeAccessCode('0123-4567-89AB-CDEFU')).toBe(canonical); // U dropped
  });

  it('rejects wrong length or charset', () => {
    for (const bad of [
      '',
      'short',
      '0123-4567-89AB-CDE',
      '0123-4567-89AB-CDEFG',
      '0123-4567-89AB-CD$F',
      'x'.repeat(100),
      '0123-4567-89AB-CDEF-0123',
    ]) {
      expect(normalizeAccessCode(bad), bad).toBeNull();
    }
    expect(normalizeAccessCode(undefined as unknown as string)).toBeNull();
  });

  it('hash is deterministic, hex, depends on pepper and code', async () => {
    const pepper = 'p'.repeat(40);
    const a = await hashAccessCode('0123456789ABCDEF', pepper);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAccessCode('0123456789ABCDEF', pepper)).toBe(a);
    expect(await hashAccessCode('0123456789ABCDEG', pepper)).not.toBe(a);
    expect(await hashAccessCode('0123456789ABCDEF', 'q'.repeat(40))).not.toBe(a);
    // Matches the documented construction: hex HMAC-SHA256(key=pepper, msg=normalized).
    expect(a).toBe(await hmacSha256Hex(pepper, '0123456789ABCDEF'));
  });

  it('public codes look like S-XXXXXX', () => {
    for (let i = 0; i < 100; i++) expect(generatePublicCode()).toMatch(/^S-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
});

describe('sealString / openString (AES-GCM, HKDF)', () => {
  const SECRET = 'k'.repeat(40);
  it('round-trips, uses a fresh IV each time and never contains the plaintext', async () => {
    const { sealString, openString } = await import('../../../src/backend/services/crypto');
    const a = await sealString(SECRET, 'cic-mfa-v1', 'plain-access-token', 'staff-1');
    const b = await sealString(SECRET, 'cic-mfa-v1', 'plain-access-token', 'staff-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('plain-access-token');
    expect(await openString(SECRET, 'cic-mfa-v1', a, 'staff-1')).toBe('plain-access-token');
  });
  it('fails on wrong secret, info, aad or tampering', async () => {
    const { sealString, openString } = await import('../../../src/backend/services/crypto');
    const a = await sealString(SECRET, 'cic-mfa-v1', 'tok', 'staff-1');
    expect(await openString('x'.repeat(40), 'cic-mfa-v1', a, 'staff-1')).toBeNull();
    expect(await openString(SECRET, 'other', a, 'staff-1')).toBeNull();
    expect(await openString(SECRET, 'cic-mfa-v1', a, 'staff-2')).toBeNull();
    expect(
      await openString(
        SECRET,
        'cic-mfa-v1',
        a.slice(0, -2) + (a.endsWith('AA') ? 'BB' : 'AA'),
        'staff-1',
      ),
    ).toBeNull();
    expect(await openString(SECRET, 'cic-mfa-v1', 'short', 'staff-1')).toBeNull();
  });
});
