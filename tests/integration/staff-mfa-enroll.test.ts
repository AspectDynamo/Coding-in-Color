import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, freshState, makeEnv } from './helpers';
import { parseConfig } from '../../src/backend/config';
import { getMemoryStore } from '../../src/backend/repositories/memory-store';
import { qrToDataUri } from '../../src/backend/services/supabase-auth';

/** First-time TOTP enrollment against a faked Supabase Auth REST API (memory data store). */
const AUTH_USER = '11111111-2222-4333-8444-555555555555';
const SECRET = 'JBSWY3DPEHPK3PXPSECRETSECRET234';
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="QRMARKER"/></svg>';
const jwt = (aal: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ aal })).replace(/=+$/, '')}.sig`;

const env = () =>
  makeEnv({
    SUPABASE_URL: 'https://proj.supabase.test',
    SUPABASE_ANON_KEY: 'anon-key-for-tests',
    REQUIRE_ADMIN_MFA: 'true',
  });

interface Call {
  method: string;
  url: string;
  body: string;
  auth: string | null;
}
let calls: Call[] = [];

function fakeSupabase(
  opts: {
    verifiedFactor?: boolean;
    staleFactors?: boolean; // an abandoned unverified factor holds the friendly name
    rawQrPrefix?: boolean; // qr_code comes back as "data:image/svg+xml;utf-8,<svg..."
    enrollStatus?: number;
  } = {},
) {
  let stale = !!opts.staleFactors;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = String(init.body ?? '');
      const headers = init.headers as Record<string, string>;
      const method = init.method ?? 'GET';
      calls.push({ method, url, body, auth: headers.Authorization ?? null });
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/auth/v1/token'))
        return json(200, { access_token: jwt('aal1'), user: { id: AUTH_USER } });
      if (url.endsWith('/auth/v1/user'))
        return json(200, {
          factors: [
            ...(opts.verifiedFactor
              ? [{ id: 'verified-1', factor_type: 'totp', status: 'verified' }]
              : []),
            ...(stale ? [{ id: 'stale-1', factor_type: 'totp', status: 'unverified' }] : []),
          ],
        });
      if (method === 'POST' && url.endsWith('/auth/v1/factors')) {
        if (opts.enrollStatus) return json(opts.enrollStatus, {});
        if (stale)
          return json(422, { error_code: 'mfa_factor_name_conflict', msg: 'name already exists' });
        return json(200, {
          id: 'new-factor',
          type: 'totp',
          totp: {
            qr_code: opts.rawQrPrefix ? `data:image/svg+xml;utf-8,${QR_SVG}` : QR_SVG,
            secret: SECRET,
            uri: `otpauth://totp/x?secret=${SECRET}`,
          },
        });
      }
      if (method === 'DELETE' && url.endsWith('/auth/v1/factors/stale-1')) {
        stale = false;
        return json(200, {});
      }
      if (url.endsWith('/new-factor/challenge')) return json(200, { id: 'challenge-1' });
      if (url.endsWith('/new-factor/verify'))
        return JSON.parse(body).code === '123456'
          ? json(200, { access_token: jwt('aal2') })
          : json(400, {});
      return json(404, {});
    }),
  );
}

async function seedStaff(e: ReturnType<typeof env>, role: 'owner' | 'admin' = 'owner') {
  const store = await getMemoryStore(parseConfig(e));
  return store.createStaff({
    authUserId: AUTH_USER,
    displayName: 'First Owner',
    role,
    status: 'invited',
    isSynthetic: false,
    programIds: [],
  });
}

const creds = { email: 'owner@example.org', password: 'right-password' };

beforeEach(() => {
  freshState();
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TOTP enrollment', () => {
  it('login answers mfa_enroll_required (not 403) and sets the cic_mfa cookie', async () => {
    const e = env();
    fakeSupabase();
    await seedStaff(e);
    const c = new Client(e);
    const r = await c.post('/auth/login', creds);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ status: 'mfa_enroll_required' });
    expect(r.res.headers.getSetCookie().find((s) => s.startsWith('cic_mfa='))).toMatch(
      /HttpOnly.*Max-Age=300|Max-Age=300.*HttpOnly/is,
    );
    expect(c.jar.has('cic_staff')).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain('eyJ');
  });

  it('enrolls, then the normal verify step issues the staff session, activates the account and audits it', async () => {
    const e = env();
    fakeSupabase();
    await seedStaff(e);
    const c = new Client(e);
    await c.post('/auth/login', creds);

    const enroll = await c.post('/auth/mfa/enroll');
    expect(enroll.status).toBe(200);
    expect(enroll.body.data.factorId).toBe('new-factor');
    expect(enroll.body.data.secret).toBe(SECRET);
    expect(enroll.body.data.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(atob(enroll.body.data.qrCode.split(',')[1])).toBe(QR_SVG);
    expect(enroll.res.headers.get('cache-control')).toBe('no-store');
    expect(c.jar.has('cic_staff')).toBe(false);

    const post = calls.find((x) => x.method === 'POST' && x.url.endsWith('/auth/v1/factors'))!;
    expect(JSON.parse(post.body)).toEqual({
      factor_type: 'totp',
      friendly_name: 'Coding in Color Impact',
    });
    expect(post.auth).toBe(`Bearer ${jwt('aal1')}`);

    const bad = await c.post('/auth/mfa/verify', { factorId: 'new-factor', code: '000000' });
    expect(bad.status).toBe(401);
    const good = await c.post('/auth/mfa/verify', { factorId: 'new-factor', code: '123456' });
    expect(good.status).toBe(200);
    expect(good.body.data.staff.role).toBe('owner');
    expect((await c.get('/auth/me')).status).toBe(200);

    const store = await getMemoryStore(parseConfig(e));
    const audit = await store.listAudit({ limit: 20, offset: 0 });
    expect(audit.items.map((a) => a.action)).toContain('staff.mfa_enrolled');
    const staff = await store.getStaffByAuthUserId(AUTH_USER);
    expect(staff?.staff.status).toBe('active'); // invited -> active on first successful login
  });

  it('accepts a qr_code that already carries the data: prefix', async () => {
    const e = env();
    fakeSupabase({ rawQrPrefix: true });
    await seedStaff(e);
    const c = new Client(e);
    await c.post('/auth/login', creds);
    const enroll = await c.post('/auth/mfa/enroll');
    expect(atob(enroll.body.data.qrCode.split(',')[1])).toBe(QR_SVG);
  });

  it('requires the cic_mfa cookie, CSRF, and a token issued for an account without a factor', async () => {
    const e = env();
    fakeSupabase();
    await seedStaff(e);
    expect((await new Client(e).post('/auth/mfa/enroll')).status).toBe(401);

    const c = new Client(e);
    await c.post('/auth/login', creds);
    expect((await c.call('POST', '/auth/mfa/enroll', { body: {}, csrf: false })).status).toBe(403);
    expect(
      (await c.call('POST', '/auth/mfa/enroll', { body: {}, origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(calls.some((x) => x.url.endsWith('/auth/v1/factors'))).toBe(false);
  });

  it('refuses to add a second factor to an account that already has a verified one', async () => {
    const e = env();
    fakeSupabase({ verifiedFactor: true });
    await seedStaff(e);
    const c = new Client(e);
    const login = await c.post('/auth/login', creds);
    expect(login.body.data.status).toBe('mfa_required'); // existing factor: token is not an enroll token
    expect((await c.post('/auth/mfa/enroll')).status).toBe(403);
    expect(calls.some((x) => x.method === 'POST' && x.url.endsWith('/auth/v1/factors'))).toBe(
      false,
    );
  });

  it('removes stale unverified factors and retries when the friendly name conflicts', async () => {
    const e = env();
    fakeSupabase({ staleFactors: true });
    await seedStaff(e);
    const c = new Client(e);
    await c.post('/auth/login', creds);
    const enroll = await c.post('/auth/mfa/enroll');
    expect(enroll.status).toBe(200);
    expect(enroll.body.data.factorId).toBe('new-factor');
    expect(calls.some((x) => x.method === 'DELETE' && x.url.endsWith('/factors/stale-1'))).toBe(
      true,
    );
    // A verified factor is never deleted.
    expect(calls.filter((x) => x.method === 'DELETE')).toHaveLength(1);
  });

  it('answers 503 when Supabase fails, without leaking details', async () => {
    const e = env();
    fakeSupabase({ enrollStatus: 500 });
    await seedStaff(e);
    const c = new Client(e);
    await c.post('/auth/login', creds);
    const r = await c.post('/auth/mfa/enroll');
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('supabase');
  });

  it('rate limits enrollment per staff member across source IPs', async () => {
    const e = env();
    fakeSupabase();
    await seedStaff(e);
    const c = new Client(e);
    await c.post('/auth/login', creds);
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await c.call('POST', '/auth/mfa/enroll', {
          body: {},
          headers: { 'cf-connecting-ip': `203.0.113.${i + 1}` },
        })
      ).status;
    expect(last).toBe(429);
  });

  it('never logs the secret or the QR code', async () => {
    const e = env();
    fakeSupabase();
    await seedStaff(e);
    const lines: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, m).mockImplementation(
        (...a: unknown[]) => void lines.push(a.map(String).join(' ')),
      );
    const c = new Client(e);
    await c.post('/auth/login', creds);
    const enroll = await c.post('/auth/mfa/enroll');
    await c.post('/auth/mfa/verify', { factorId: 'new-factor', code: '123456' });
    const logged = lines.join('\n');
    expect(logged.length).toBeGreaterThan(0); // the access log did run
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('QRMARKER');
    expect(logged).not.toContain(btoa(QR_SVG));
    expect(logged).not.toContain(enroll.body.data.qrCode);
    const store = await getMemoryStore(parseConfig(e));
    const audit = JSON.stringify(await store.listAudit({ limit: 50, offset: 0 }));
    expect(audit).not.toContain(SECRET);
  });
});

describe('qrToDataUri', () => {
  it('wraps raw SVG, normalises prefixed values and rejects non-SVG', () => {
    expect(qrToDataUri(QR_SVG)).toBe(`data:image/svg+xml;base64,${btoa(QR_SVG)}`);
    expect(qrToDataUri(`data:image/svg+xml;utf-8,${encodeURIComponent(QR_SVG)}`)).toBe(
      `data:image/svg+xml;base64,${btoa(QR_SVG)}`,
    );
    expect(qrToDataUri('<html><script>alert(1)</script></html>')).toBeNull();
    expect(qrToDataUri('javascript:alert(1)')).toBeNull();
  });
});

describe('staff status on login', () => {
  it('a disabled staff member is rejected like a bad login, even with MFA enrollment pending', async () => {
    const e = env();
    fakeSupabase();
    const store = await getMemoryStore(parseConfig(e));
    await store.createStaff({
      authUserId: AUTH_USER,
      displayName: 'Gone',
      role: 'owner',
      status: 'disabled',
      isSynthetic: false,
      programIds: [],
    });
    const r = await new Client(e).post('/auth/login', creds);
    expect(r.status).toBe(401);
    expect(calls.some((x) => x.url.endsWith('/auth/v1/factors'))).toBe(false);
  });
});
