import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../../../src/backend/services/session-token';

const SECRET = 's'.repeat(40);

describe('session tokens', () => {
  it('round-trips claims', async () => {
    const t = await signToken({ sub: 'u1', typ: 'student', cid: 'c1' }, SECRET, 60);
    const p = await verifyToken(t, SECRET, 'student');
    expect(p).toMatchObject({ sub: 'u1', typ: 'student', cid: 'c1' });
    expect(p!.exp - p!.iat).toBe(60);
  });

  it('rejects a wrong secret, wrong type and expiry', async () => {
    const now = Date.now();
    const t = await signToken({ sub: 'u1', typ: 'staff', role: 'admin' }, SECRET, 10, now);
    expect(await verifyToken(t, 'x'.repeat(40), 'staff', now)).toBeNull();
    expect(await verifyToken(t, SECRET, 'student', now)).toBeNull();
    expect(await verifyToken(t, SECRET, 'staff', now + 9_000)).not.toBeNull();
    expect(await verifyToken(t, SECRET, 'staff', now + 11_000)).toBeNull();
  });

  it('rejects tampered payloads and signatures', async () => {
    const t = await signToken({ sub: 'u1', typ: 'staff', role: 'instructor' }, SECRET, 60);
    const [body, sig] = t.split('.') as [string, string];
    const forgedClaims = btoa(
      JSON.stringify({ sub: 'u1', typ: 'staff', role: 'owner', iat: 1, exp: 9999999999 }),
    ).replace(/=+$/, '');
    expect(await verifyToken(`${forgedClaims}.${sig}`, SECRET, 'staff')).toBeNull();
    expect(await verifyToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, 'staff')).toBeNull();
    expect(await verifyToken(`${body}.`, SECRET, 'staff')).toBeNull();
    expect(await verifyToken(body, SECRET, 'staff')).toBeNull();
  });

  it('rejects garbage input', async () => {
    for (const g of [undefined, null, '', 'abc', 'a.b.c', '.', 'x'.repeat(5000)]) {
      expect(await verifyToken(g as string, SECRET, 'student')).toBeNull();
    }
  });
});
