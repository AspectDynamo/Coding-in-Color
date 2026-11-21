/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../../../src/backend/env';
import { csrf } from '../../../src/backend/middleware/csrf';
import { requestContext } from '../../../src/backend/middleware/request';
import { HttpError } from '../../../src/backend/utils/errors';

function build() {
  const app = new Hono<AppEnv>();
  app.use('*', requestContext, csrf);
  app.get('/x', (c) => c.json({ ok: true }));
  app.post('/x', (c) => c.json({ ok: true }));
  app.delete('/x', (c) => c.json({ ok: true }));
  app.onError((e, c) =>
    e instanceof HttpError
      ? c.json({ error: { code: e.code } }, e.status as 403)
      : c.json({ error: 'x' }, 500),
  );
  return app;
}
const env = {
  SESSION_SECRET: 's'.repeat(40),
  CREDENTIAL_PEPPER: 'p'.repeat(40),
  DEMO_MODE: 'true',
  ALLOWED_ORIGINS: 'https://ok.example',
};
const TOKEN = 'A'.repeat(32);

const post = (headers: Record<string, string>, method = 'POST') =>
  build().request('http://app.test/x', { method, headers }, env);

describe('csrf middleware', () => {
  it('sets a readable cic_csrf cookie when absent', async () => {
    const res = await build().request('http://app.test/x', {}, env);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('cic_csrf='))!;
    expect(sc).toBeTruthy();
    expect(sc).not.toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    expect(sc).toMatch(/Secure/i); // non-localhost host
  });

  it('does not rotate an existing valid cookie', async () => {
    const res = await build().request(
      'http://app.test/x',
      { headers: { cookie: `cic_csrf=${TOKEN}` } },
      env,
    );
    expect(res.headers.getSetCookie().some((c) => c.startsWith('cic_csrf='))).toBe(false);
  });

  it('allows safe methods without a token', async () => {
    expect((await build().request('http://app.test/x', {}, env)).status).toBe(200);
  });

  it('accepts matching cookie + header + own origin', async () => {
    const res = await post({
      cookie: `cic_csrf=${TOKEN}`,
      'x-csrf-token': TOKEN,
      origin: 'http://app.test',
    });
    expect(res.status).toBe(200);
  });

  it('accepts an origin from ALLOWED_ORIGINS', async () => {
    expect(
      (
        await post({
          cookie: `cic_csrf=${TOKEN}`,
          'x-csrf-token': TOKEN,
          origin: 'https://ok.example',
        })
      ).status,
    ).toBe(200);
  });

  it.each([
    ['missing header', { cookie: `cic_csrf=${TOKEN}`, origin: 'http://app.test' }],
    [
      'mismatched header',
      { cookie: `cic_csrf=${TOKEN}`, 'x-csrf-token': 'B'.repeat(32), origin: 'http://app.test' },
    ],
    ['missing cookie', { 'x-csrf-token': TOKEN, origin: 'http://app.test' }],
    [
      'foreign origin',
      { cookie: `cic_csrf=${TOKEN}`, 'x-csrf-token': TOKEN, origin: 'https://evil.example' },
    ],
    ['no origin and not same-origin fetch', { cookie: `cic_csrf=${TOKEN}`, 'x-csrf-token': TOKEN }],
    [
      'scheme downgrade origin',
      { cookie: `cic_csrf=${TOKEN}`, 'x-csrf-token': TOKEN, origin: 'http://ok.example' },
    ],
  ])('rejects %s with 403 csrf_failed', async (_n, headers) => {
    const res = await post(headers as Record<string, string>);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe('csrf_failed');
  });

  it('allows a missing Origin only for same-origin fetches', async () => {
    const res = await post({
      cookie: `cic_csrf=${TOKEN}`,
      'x-csrf-token': TOKEN,
      'sec-fetch-site': 'same-origin',
    });
    expect(res.status).toBe(200);
  });

  it('applies to DELETE too', async () => {
    expect((await post({ origin: 'http://app.test' }, 'DELETE')).status).toBe(403);
  });
});
