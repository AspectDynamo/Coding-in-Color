import { describe, expect, it } from 'vitest';
import { formatCode, isCompleteCode, normalizeCode, readCodeFromHash } from './accessCode';

describe('access code formatting', () => {
  it('formats as XXXX-XXXX-XXXX-XXXX while typing', () => {
    expect(formatCode('')).toBe('');
    expect(formatCode('abc')).toBe('ABC');
    expect(formatCode('abcd5')).toBe('ABCD-5');
    expect(formatCode('7kq2m9x4abcd0123')).toBe('7KQ2-M9X4-ABCD-0123');
  });

  it('is forgiving: spaces, dashes, lowercase, look-alike letters, and U', () => {
    expect(formatCode(' 7kq2 m9x4-abcd  0123 ')).toBe('7KQ2-M9X4-ABCD-0123');
    expect(normalizeCode('ILOu')).toBe('110'); // I→1, L→1, O→0, U dropped
    expect(formatCode('oooo-iiii-llll-0000')).toBe('0000-1111-1111-0000');
  });

  it('never grows past 16 characters', () => {
    expect(formatCode('A'.repeat(40))).toBe('AAAA-AAAA-AAAA-AAAA');
  });

  it('knows when a code is complete', () => {
    expect(isCompleteCode('7KQ2-M9X4-ABCD-012')).toBe(false);
    expect(isCompleteCode('7KQ2-M9X4-ABCD-0123')).toBe(true);
  });

  it('reads #code= from a URL fragment', () => {
    expect(readCodeFromHash('#code=7kq2-m9x4-abcd-0123')).toBe('7KQ2-M9X4-ABCD-0123');
    expect(readCodeFromHash('#foo=1&code=7KQ2M9X4ABCD0123')).toBe('7KQ2-M9X4-ABCD-0123');
    expect(readCodeFromHash('')).toBeNull();
    expect(readCodeFromHash('#other=1')).toBeNull();
    expect(readCodeFromHash('#code=')).toBeNull();
  });
});
