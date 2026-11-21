/**
 * Coding in Color Impact — Worker entry. Hono app under /api/v1; everything else is served by
 * Workers Static Assets (the SPA) before the Worker runs.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ApiError } from '@shared/api';
import type { AppEnv, Bindings } from './env';
import { csrf } from './middleware/csrf';
import { requestContext, requireConfigured, securityHeaders } from './middleware/request';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { configRoutes } from './routes/config';
import { instructorRoutes } from './routes/instructor';
import { reportRoutes } from './routes/reports';
import { studentRoutes } from './routes/student';
import { HttpError } from './utils/errors';
import { errorSummary, log } from './utils/logger';

export const app = new Hono<AppEnv>().basePath('/api/v1');

app.use('*', requestContext, securityHeaders, csrf);

// Public, store-independent routes.
app.route('/', configRoutes);

// Everything below needs secrets + a data store (503 not_configured otherwise).
app.use('*', requireConfigured);
app.route('/', authRoutes);
app.route('/', studentRoutes);
app.route('/', instructorRoutes);
app.route('/', adminRoutes);
app.route('/', reportRoutes);

const envelope = (
  code: ApiError['error']['code'],
  message: string,
  details?: unknown,
): ApiError => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

app.notFound((c) => c.json(envelope('not_found', 'Not found.'), 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
    return c.json(envelope(err.code, err.message, err.details), err.status as 400);
  }
  if (err instanceof ZodError) {
    // Field paths and issue codes only: never echo submitted values.
    const details = err.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
    return c.json(envelope('bad_request', 'Some fields are invalid.', details), 400);
  }
  if (err instanceof HTTPException) {
    const status = err.status;
    const code =
      status === 401
        ? 'unauthenticated'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : status === 429
              ? 'rate_limited'
              : status >= 500
                ? 'internal'
                : 'bad_request';
    return c.json(
      envelope(code, status >= 500 ? 'Something went wrong.' : 'Invalid request.'),
      status as 400,
    );
  }
  log('error', 'http.unhandled', { requestId: c.get('requestId'), ...errorSummary(err) });
  return c.json(envelope('internal', 'Something went wrong.'), 500);
});

export { DemoStore } from './repositories/demo-store-do';

export default {
  async fetch(
    request: Request,
    env: Bindings & { ASSETS?: { fetch(r: Request): Promise<Response> } },
    ctx: ExecutionContext,
  ) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/') && env.ASSETS) return env.ASSETS.fetch(request);
    return app.fetch(request, env, ctx);
  },
};
