import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { isConfigured, parseConfig } from '../config';
import { getStore } from '../repositories';
import { HttpError } from '../utils/errors';
import { log } from '../utils/logger';

/** request id + config + structured access log (path only: no query string, headers or bodies). */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId =
    incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', requestId);
  c.set('config', parseConfig(c.env ?? {}));
  const started = Date.now();
  await next();
  c.header('X-Request-Id', requestId);
  log('info', 'http.request', {
    requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    ms: Date.now() - started,
  });
};

/** API responses are never cacheable and carry conservative security headers. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
};

/** Data routes need secrets + a store; otherwise 503 not_configured. Attaches the store. */
export const requireConfigured: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = c.get('config');
  if (!isConfigured(config)) {
    throw new HttpError(503, 'not_configured', 'This service is not configured yet.');
  }
  c.set('store', await getStore(c.env ?? {}, config));
  await next();
};
