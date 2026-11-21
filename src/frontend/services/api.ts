/**
 * Typed fetch wrapper for /api/v1 (architecture §8).
 *  - same-origin, cookies only (HttpOnly session cookies are never readable here)
 *  - mutations send X-CSRF-Token copied from the readable `cic_csrf` cookie
 *  - unwraps `{ data }` / `{ data, page }` envelopes
 *  - throws ApiRequestError with the contract's error code
 */
import { API_BASE, CSRF_COOKIE, CSRF_HEADER, type ApiErrorCode, type Page } from '@shared/api';

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ApiErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(e: unknown, code?: ApiErrorCode): e is ApiRequestError {
  return e instanceof ApiRequestError && (code === undefined || e.code === code);
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
  503: 'not_configured',
};

const FRIENDLY: Partial<Record<ApiErrorCode, string>> = {
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'You don’t have permission to do that.',
  csrf_failed: 'Your page is out of date. Refresh and try again.',
  not_found: 'We couldn’t find that.',
  rate_limited: 'Too many tries. Please wait a minute and try again.',
  not_configured: 'The data store is not configured yet.',
  internal: 'Something went wrong on our side. Please try again.',
};

/** Human-readable message for any thrown value. Prefers the server's message for validation errors. */
export function errorMessage(
  e: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (e instanceof ApiRequestError) {
    if (e.code === 'internal' || e.code === 'csrf_failed' || e.code === 'rate_limited')
      return FRIENDLY[e.code]!;
    return e.message || FRIENDLY[e.code] || fallback;
  }
  return fallback;
}

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return null;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

async function ensureCsrfToken(): Promise<string | null> {
  let token = readCookie(CSRF_COOKIE);
  if (!token) {
    // The API sets cic_csrf on any response when absent; prime it with a harmless GET.
    await fetch(`${API_BASE}/config`, { credentials: 'same-origin' }).catch(() => undefined);
    token = readCookie(CSRF_COOKIE);
  }
  return token;
}

async function send(method: Method, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (method !== 'GET') {
    const token = await ensureCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }
  try {
    return await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiRequestError(
      'internal',
      'We can’t reach the server. Check your connection and try again.',
      0,
    );
  }
}

async function toError(res: Response): Promise<ApiRequestError> {
  let code: ApiErrorCode = STATUS_CODES[res.status] ?? 'internal';
  let message = FRIENDLY[code] ?? 'Request failed.';
  let details: unknown;
  try {
    const json = (await res.json()) as {
      error?: { code?: ApiErrorCode; message?: string; details?: unknown };
    };
    if (json?.error) {
      if (json.error.code) code = json.error.code;
      if (json.error.message) message = json.error.message;
      details = json.error.details;
    }
  } catch {
    /* non-JSON error body: keep status-derived defaults */
  }
  return new ApiRequestError(code, message, res.status, details);
}

async function json(
  method: Method,
  path: string,
  opts?: RequestOptions,
): Promise<{ data: unknown; page?: Page }> {
  const res = await send(method, path, opts);
  if (!res.ok) throw await toError(res);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new ApiRequestError('internal', 'The server sent an unexpected response.', res.status);
  }
  const payload = (await res.json()) as { data?: unknown; page?: Page };
  if (payload === null || typeof payload !== 'object' || !('data' in payload)) {
    throw new ApiRequestError('internal', 'The server sent an unexpected response.', res.status);
  }
  return payload as { data: unknown; page?: Page };
}

export interface Paged<T> {
  items: T[];
  page: Page;
}

export const api = {
  async get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return (await json('GET', path, { query, signal })).data as T;
  },
  /** List endpoint. Works for both `{data, page}` and plain `{data: []}` responses. */
  async page<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Paged<T>> {
    const r = await json('GET', path, { query, signal });
    const items = Array.isArray(r.data) ? (r.data as T[]) : [];
    return { items, page: r.page ?? { limit: items.length, offset: 0, total: items.length } };
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await json('POST', path, { body })).data as T;
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await json('PATCH', path, { body })).data as T;
  },
  async delete<T>(path: string): Promise<T> {
    return (await json('DELETE', path)).data as T;
  },
  /** Fetches a text resource (CSV) and returns its body and suggested filename. */
  async text(path: string, query?: Query): Promise<{ text: string; filename: string | null }> {
    const res = await send('GET', path, { query });
    if (!res.ok) throw await toError(res);
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) {
      throw new ApiRequestError('internal', 'The server sent an unexpected response.', res.status);
    }
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename="?([^";]+)"?/i.exec(cd);
    return { text: await res.text(), filename: m?.[1] ?? null };
  },
};

/** Downloads a CSV export through fetch (so errors surface as toasts, not a broken tab). */
export async function downloadCsv(
  path: string,
  query: Query | undefined,
  fallbackName: string,
): Promise<string> {
  const { text, filename } = await api.text(path, query);
  const name = filename ?? fallbackName;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
