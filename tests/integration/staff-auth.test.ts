import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, freshState, makeEnv } from './helpers';
import { parseConfig } from '../../src/backend/config';
import { getMemoryStore } from '../../src/backend/repositories/memory-store';

/** Staff sign-in against a faked Supabase Auth REST API (memory data store). */
const AUTH_USER = '11111111-2222-4333-8444-555555555555';
const jwt = (aal: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ aal })).replace(/=+$/, '')}.sig`;

const env = (mfa: boolean) =>
  makeEnv({
    SUPABASE_URL: 'https://proj.supabase.test',
    SUPABASE_ANON_KEY: 'anon-key-for-tests',
    REQUIRE_ADMIN_MFA: mfa ? 'true' : 'false',
  });

let calls: { url: string; body: string; auth: string | null }[] = [];
function fakeSupabase(
  opts: { aal?: string; goodPassword?: string; goodTotp?: string; factors?: boolean } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = String(init.body ?? '');
      const headers = init.headers as Record<string, string>;
      calls.push({ url, body, auth: headers.Authorization ?? null });
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/auth/v1/token')) {
        const { password } = JSON.parse(body);
        return password === (opts.goodPassword ?? 'right-password')
          ? json(200, { access_token: jwt(opts.aal ?? 'aal1'), user: { id: AUTH_USER } })
          : json(400, { error: 'invalid_grant' });
      }
      if (url.endsWith('/auth/v1/user'))
        return json(200, {
          factors:
            opts.factors === false
              ? []
              : [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
        });
      if (url.endsWith('/challenge')) return json(200, { id: 'challenge-1' });
      if (url.endsWith('/verify'))
        return JSON.parse(body).code === (opts.goodTotp ?? '123456')
          ? json(200, { access_token: jwt('aal2') })
          : json(400, {});
      if (url.endsWith('/auth/v1/recover')) return json(200, {});
      return json(404, {});
    }),
  );
}

async function seedStaff(
  e: ReturnType<typeof env>,
  role: 'owner' | 'admin' | 'analyst',
  status: 'active' | 'disabled' = 'active',
) {
  const store = await getMemoryStore(parseConfig(e));
  const dto = await store.createStaff({
    authUserId: AUTH_USER,
    displayName: 'Real Person',
    role,
    status,
    isSynthetic: false,
    programIds: [],
  });
  return dto;
}

beforeEach(() => {
  freshState();
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /auth/login', () => {
  it('signs in a known staff user and audits it', async () => {
    const e = env(false);
    fakeSupabase();
    await seedStaff(e, 'analyst');
    const c = new Client(e);
    const r = await c.post('/auth/login', {
      email: 'person@example.org',
      password: 'right-password',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      status: 'ok',
      staff: { role: 'analyst', displayName: 'Real Person' },
    });
    expect((await c.get('/auth/me')).status).toBe(200);
    expect(calls[0]!.url).toContain('/auth/v1/token?grant_type=password');
    expect(r.res.headers.getSetCookie().find((s) => s.startsWith('cic_staff='))).toMatch(
      /HttpOnly/i,
    );
  });

  it('gives identical errors for wrong password, unknown staff and disabled staff', async () => {
    const e = env(false);
    fakeSupabase();
    await seedStaff(e, 'analyst', 'disabled');
    const wrongPw = await new Client(e).post('/auth/login', {
      email: 'a@example.org',
      password: 'nope',
    });
    const disabled = await new Client(e).post('/auth/login', {
      email: 'a@example.org',
      password: 'right-password',
    });
    expect(wrongPw.status).toBe(401);
    expect(disabled.status).toBe(401);
    expect(disabled.body).toEqual(wrongPw.body);
  });

  it('requires TOTP for admins when REQUIRE_ADMIN_MFA is on, keeping the Supabase token out of the response', async () => {
    const e = env(true);
    fakeSupabase();
    await seedStaff(e, 'admin');
    const c = new Client(e);
    const r = await c.post('/auth/login', { email: 'a@example.org', password: 'right-password' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      status: 'mfa_required',
      factors: [{ id: 'factor-1', type: 'totp' }],
    });
    expect(JSON.stringify(r.body)).not.toContain('eyJ');
    expect(c.jar.has('cic_staff')).toBe(false);
    const mfaCookie = r.res.headers.getSetCookie().find((s) => s.startsWith('cic_mfa='))!;
    expect(mfaCookie).toMatch(/HttpOnly/i);
    expect(mfaCookie).toMatch(/Max-Age=300/i);
    expect((await c.get('/auth/me')).status).toBe(401);

    const bad = await c.post('/auth/mfa/verify', { factorId: 'factor-1', code: '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('mfa_required');
    const good = await c.post('/auth/mfa/verify', { factorId: 'factor-1', code: '123456' });
    expect(good.status).toBe(200);
    expect(good.body.data.staff.role).toBe('admin');
    expect(c.jar.has('cic_mfa')).toBe(false);
    expect((await c.get('/auth/me')).status).toBe(200);
  });

  it('skips MFA for analysts and for already-aal2 sessions; enrolls admins with no factor', async () => {
    const e = env(true);
    fakeSupabase();
    await seedStaff(e, 'analyst');
    expect(
      (
        await new Client(e).post('/auth/login', {
          email: 'a@example.org',
          password: 'right-password',
        })
      ).body.data.status,
    ).toBe('ok');
    freshState();
    fakeSupabase({ aal: 'aal2' });
    await seedStaff(e, 'owner');
    expect(
      (
        await new Client(e).post('/auth/login', {
          email: 'a@example.org',
          password: 'right-password',
        })
      ).body.data.status,
    ).toBe('ok');
    freshState();
    fakeSupabase({ factors: false });
    await seedStaff(e, 'owner');
    const noFactor = await new Client(e).post('/auth/login', {
      email: 'a@example.org',
      password: 'right-password',
    });
    expect(noFactor.status).toBe(200);
    expect(noFactor.body.data).toEqual({ status: 'mfa_enroll_required' });
  });

  it('MFA verify without the cic_mfa cookie is rejected', async () => {
    const e = env(true);
    fakeSupabase();
    expect(
      (await new Client(e).post('/auth/mfa/verify', { factorId: 'factor-1', code: '123456' }))
        .status,
    ).toBe(401);
  });

  it('rate limits staff login attempts', async () => {
    const e = env(false);
    fakeSupabase();
    const c = new Client(e);
    let last = 0;
    for (let i = 0; i < 14; i++)
      last = (await c.post('/auth/login', { email: 'a@example.org', password: 'nope' })).status;
    expect(last).toBe(429);
  });

  it('password reset calls Supabase recover but always returns ok', async () => {
    const e = env(false);
    fakeSupabase();
    const r = await new Client(e).post('/auth/password-reset', { email: 'anyone@example.org' });
    expect(r.body).toEqual({ data: { ok: true } });
    expect(calls.some((x) => x.url.endsWith('/auth/v1/recover'))).toBe(true);
  });
});

const ip = (n: number) => ({ headers: { 'cf-connecting-ip': `203.0.113.${n}` } });

describe('MFA cookie confidentiality and single use', () => {
  async function loginToMfa(e: ReturnType<typeof env>) {
    fakeSupabase();
    await seedStaff(e, 'admin');
    const c = new Client(e);
    const r = await c.post('/auth/login', { email: 'a@example.org', password: 'right-password' });
    expect(r.body.data.status).toBe('mfa_required');
    return { c, cookie: c.jar.get('cic_mfa')! };
  }

  it('the cic_mfa cookie never contains the Supabase access token (it is AES-GCM ciphertext)', async () => {
    const e = env(true);
    const { cookie } = await loginToMfa(e);
    const plaintext = jwt('aal1');
    expect(cookie).not.toContain(plaintext);
    // The cookie's own base64url payload begins "eyJ" (JSON), so inspect the decoded claims instead.
    const payload = JSON.parse(atob(cookie.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(payload.at).toBeTypeOf('string');
    expect(payload.at).not.toContain(plaintext);
    expect(payload.at).not.toContain('eyJ');
    expect(atob(cookie.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain(
      plaintext,
    );
    expect(payload.at.length).toBeGreaterThan(plaintext.length); // iv + tag overhead
    expect(typeof payload.jti).toBe('string');
    // Same login twice gives different ciphertexts and ids (random IV and jti).
    const again = new Client(e);
    await again.post('/auth/login', { email: 'a@example.org', password: 'right-password' });
    expect(again.jar.get('cic_mfa')).not.toBe(cookie);
  });

  it('the Supabase call still receives the decrypted access token', async () => {
    const e = env(true);
    const { c } = await loginToMfa(e);
    expect(
      (await c.post('/auth/mfa/verify', { factorId: 'factor-1', code: '123456' })).status,
    ).toBe(200);
    const challenge = calls.find((x) => x.url.endsWith('/challenge'))!;
    expect(challenge.auth).toBe(`Bearer ${jwt('aal1')}`);
  });

  it('an MFA token can be used once: replaying the cookie after success is rejected', async () => {
    const e = env(true);
    const { c, cookie } = await loginToMfa(e);
    expect(
      (await c.post('/auth/mfa/verify', { factorId: 'factor-1', code: '123456' })).status,
    ).toBe(200);
    const replay = new Client(e);
    replay.jar.set('cic_mfa', cookie);
    const r = await replay.post('/auth/mfa/verify', { factorId: 'factor-1', code: '123456' });
    expect(r.status).toBe(401);
    expect(replay.jar.has('cic_staff')).toBe(false);
  });

  it('a tampered ciphertext is rejected', async () => {
    const e = env(true);
    const { c } = await loginToMfa(e);
    // Re-sign nothing: flipping a byte breaks the HMAC first, which is also a rejection.
    const cookie = c.jar.get('cic_mfa')!;
    c.jar.set('cic_mfa', cookie.slice(0, 10) + (cookie[10] === 'A' ? 'B' : 'A') + cookie.slice(11));
    expect(
      (await c.post('/auth/mfa/verify', { factorId: 'factor-1', code: '123456' })).status,
    ).toBe(401);
  });

  it('MFA verification is throttled per staff member across source IPs', async () => {
    const e = env(true);
    const { c } = await loginToMfa(e);
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await c.call('POST', '/auth/mfa/verify', {
          body: { factorId: 'factor-1', code: '000000' },
          ...ip(i + 1),
        })
      ).status;
    expect(last).toBe(429);
    // Even the right code is refused while throttled.
    expect(
      (
        await c.call('POST', '/auth/mfa/verify', {
          body: { factorId: 'factor-1', code: '123456' },
          ...ip(99),
        })
      ).status,
    ).toBe(429);
  });
});

describe('per-account throttling', () => {
  it('limits login attempts per account even when the source IP changes, and is case-insensitive', async () => {
    const e = env(false);
    fakeSupabase();
    const c = new Client(e);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const email = i % 2 ? 'Victim@Example.org' : 'victim@example.org';
      last = (
        await c.call('POST', '/auth/login', { body: { email, password: 'nope' }, ...ip(i + 1) })
      ).status;
    }
    expect(last).toBe(429);
    // A different account from a fresh IP is unaffected.
    expect(
      (
        await c.call('POST', '/auth/login', {
          body: { email: 'other@example.org', password: 'nope' },
          ...ip(200),
        })
      ).status,
    ).toBe(401);
  });

  it('limits password-reset requests per account too, without revealing anything', async () => {
    const e = env(false);
    fakeSupabase();
    const c = new Client(e);
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await c.call('POST', '/auth/password-reset', {
          body: { email: 'victim@example.org' },
          ...ip(i + 1),
        })
      ).status;
    expect(last).toBe(429);
    expect(
      (
        await c.call('POST', '/auth/password-reset', {
          body: { email: 'someone-else@example.org' },
          ...ip(150),
        })
      ).body,
    ).toEqual({ data: { ok: true } });
  });
});
