import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api, buildQuery, errorMessage, isApiError, readCookie } from './api';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
const fetchMock = vi.fn<typeof fetch>();

function clearCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  clearCookies();
});
afterEach(() => vi.unstubAllGlobals());

describe('api wrapper', () => {
  it('reads cookies by name', () => {
    document.cookie = 'cic_csrf=tok%20en; path=/';
    document.cookie = 'other=1; path=/';
    expect(readCookie('cic_csrf')).toBe('tok en');
    expect(readCookie('missing')).toBeNull();
  });

  it('unwraps { data } and does not send a CSRF header on GET', async () => {
    document.cookie = 'cic_csrf=abc123; path=/';
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { hello: 'world' } }));
    await expect(api.get('/config')).resolves.toEqual({ hello: 'world' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/config');
    expect(init?.credentials).toBe('same-origin');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
  });

  it('sends X-CSRF-Token from the cic_csrf cookie on mutations with a JSON body', async () => {
    document.cookie = 'cic_csrf=abc123; path=/';
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    await api.post('/student/session', { code: 'X' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/student/session');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('abc123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ code: 'X' }));
  });

  it('sends the CSRF header on PATCH and DELETE too', async () => {
    document.cookie = 'cic_csrf=t1; path=/';
    fetchMock.mockImplementation(async () => jsonResponse({ data: {} }));
    await api.patch('/x', { a: 1 });
    await api.delete('/x');
    for (const call of fetchMock.mock.calls) {
      expect((call[1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe('t1');
    }
  });

  it('primes the CSRF cookie with GET /config when it is missing', async () => {
    fetchMock.mockImplementationOnce(async () => {
      document.cookie = 'cic_csrf=fresh; path=/';
      return jsonResponse({ data: {} });
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    await api.post('/auth/logout');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/config');
    expect((fetchMock.mock.calls[1]![1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe(
      'fresh',
    );
  });

  it('unwraps paged envelopes and tolerates plain arrays', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [1, 2], page: { limit: 2, offset: 4, total: 9 } }),
    );
    await expect(api.page('/admin/students', { limit: 2, offset: 4, q: '' })).resolves.toEqual({
      items: [1, 2],
      page: { limit: 2, offset: 4, total: 9 },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/admin/students?limit=2&offset=4');

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: ['a', 'b', 'c'] }));
    await expect(api.page('/admin/programs')).resolves.toEqual({
      items: ['a', 'b', 'c'],
      page: { limit: 3, offset: 0, total: 3 },
    });
  });

  it('maps error envelopes to ApiRequestError with code, status and details', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'invalid_code', message: 'Nope' } }, 401),
    );
    const e1 = await api.get('/student/me').catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ApiRequestError);
    expect(isApiError(e1, 'invalid_code')).toBe(true);
    expect((e1 as ApiRequestError).status).toBe(401);

    document.cookie = 'cic_csrf=t; path=/';
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'ai_unavailable',
            message: 'AI down',
            details: { fallback: { id: 'r1' } },
          },
        },
        503,
      ),
    );
    const e2 = (await api
      .post('/admin/reports/summarize', {})
      .catch((e: unknown) => e)) as ApiRequestError;
    expect(e2.code).toBe('ai_unavailable');
    expect(e2.details).toEqual({ fallback: { id: 'r1' } });
  });

  it('falls back to status-derived codes for non-JSON errors and rejects HTML success bodies', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>', { status: 429, headers: { 'content-type': 'text/html' } }),
    );
    const e1 = (await api.get('/x').catch((e: unknown) => e)) as ApiRequestError;
    expect(e1.code).toBe('rate_limited');

    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const e2 = (await api.get('/x').catch((e: unknown) => e)) as ApiRequestError;
    expect(e2.code).toBe('internal');
  });

  it('turns network failures into a friendly internal error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const e = (await api.get('/x').catch((err: unknown) => err)) as ApiRequestError;
    expect(e.code).toBe('internal');
    expect(e.status).toBe(0);
    expect(errorMessage(e)).toMatch(/try again/i);
  });

  it('builds query strings without empty values', () => {
    expect(buildQuery({ a: 'x', b: '', c: undefined, d: null, e: 0, f: false })).toBe(
      '?a=x&e=0&f=false',
    );
    expect(buildQuery({})).toBe('');
  });
});
