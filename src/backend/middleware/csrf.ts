/**
 * CSRF: double-submit cookie (`cic_csrf` readable) + Origin check on every mutation.
 */
import type { MiddlewareHandler } from 'hono';
import { CSRF_COOKIE, CSRF_HEADER } from '@shared/api';
import type { AppEnv } from '../env';
import { randomToken, timingSafeEqual } from '../services/crypto';
import { readCookie, setCsrfCookie } from '../services/cookies';
import { HttpError } from '../utils/errors';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function fail(): never {
  throw new HttpError(
    403,
    'csrf_failed',
    'Your session check failed. Refresh the page and try again.',
  );
}

export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  let cookie = readCookie(c, CSRF_COOKIE);
  const hadCookie = !!cookie && /^[A-Za-z0-9_-]{22,128}$/.test(cookie);
  if (!hadCookie) {
    cookie = randomToken(24);
    setCsrfCookie(c, cookie);
  }
  c.set('csrfToken', cookie as string);

  if (UNSAFE.has(c.req.method)) {
    const header = c.req.header(CSRF_HEADER);
    if (!hadCookie || !header || !timingSafeEqual(header, cookie as string)) fail();

    const origin = c.req.header('origin');
    const own = new URL(c.req.url).origin;
    const allowed = c.get('config').allowedOrigins;
    if (origin) {
      if (origin !== own && !allowed.includes(origin)) fail();
    } else if (c.req.header('sec-fetch-site') !== 'same-origin') {
      // No Origin header: only same-origin fetches from a browser (Sec-Fetch-Site) are acceptable.
      fail();
    }
  }
  await next();
};
