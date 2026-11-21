/**
 * Rate limiting. Uses the Cloudflare binding (`env.X.limit({key})`) when present and an in-memory
 * sliding window otherwise. The caller key (connecting IP, or 'local') is HMAC'd with SESSION_SECRET
 * before use, so the raw value is never stored in our memory structures or logs.
 */
import type { Context } from 'hono';
import type { AppEnv, RateLimitBinding } from '../env';
import { HttpError } from '../utils/errors';
import { hmacSha256Hex } from './crypto';

export type LimiterName = 'STUDENT_LOGIN_LIMITER' | 'STAFF_LOGIN_LIMITER' | 'AI_LIMITER';

/** Fallback windows used when the binding is absent (dev/tests). */
export const FALLBACK_LIMITS: Record<LimiterName, { limit: number; windowMs: number }> = {
  // Looser than the staff limit: classrooms commonly share one NAT'd IP. Codes carry ~80 bits, so
  // guessing is infeasible regardless; this only blunts abuse.
  STUDENT_LOGIN_LIMITER: { limit: 30, windowMs: 60_000 },
  STAFF_LOGIN_LIMITER: { limit: 10, windowMs: 60_000 },
  AI_LIMITER: { limit: 5, windowMs: 60_000 },
};

const windows = new Map<string, number[]>();
const MAX_KEYS = 5_000;

export function resetRateLimits(): void {
  windows.clear();
}

function slidingWindowAllow(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const cutoff = now - windowMs;
  const hits = (windows.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > MAX_KEYS) {
    for (const [k, v] of windows) {
      if (!v.some((t) => t > cutoff)) windows.delete(k);
    }
    if (windows.size > MAX_KEYS) windows.clear(); // pathological: fail open on memory rather than grow
  }
  return true;
}

/**
 * @param subject  who is being limited; defaults to the connecting IP ('local' when absent).
 */
export async function enforceRateLimit(
  c: Context<AppEnv>,
  name: LimiterName,
  subject?: string,
): Promise<void> {
  const raw = subject ?? c.req.header('cf-connecting-ip') ?? 'local';
  const secret = c.get('config').sessionSecret || 'rate-limit';
  const key = `${name}:${(await hmacSha256Hex(secret, raw)).slice(0, 32)}`;
  const binding = c.env?.[name] as RateLimitBinding | undefined;
  let allowed: boolean;
  if (binding && typeof binding.limit === 'function') {
    try {
      allowed = (await binding.limit({ key })).success;
    } catch {
      // Binding failure: fall back to the local window rather than failing open entirely.
      const f = FALLBACK_LIMITS[name];
      allowed = slidingWindowAllow(key, f.limit, f.windowMs);
    }
  } else {
    const f = FALLBACK_LIMITS[name];
    allowed = slidingWindowAllow(key, f.limit, f.windowMs);
  }
  if (!allowed) {
    throw new HttpError(
      429,
      'rate_limited',
      'Too many attempts. Please wait a minute and try again.',
      undefined,
      {
        'Retry-After': '60',
      },
    );
  }
}

/** Per-account limiter subject: HMAC of the lowercased email, so the address itself is never a key. */
export async function accountSubject(c: Context<AppEnv>, email: string): Promise<string> {
  const secret = c.get('config').sessionSecret || 'rate-limit';
  return `acct:${await hmacSha256Hex(secret, email.trim().toLowerCase())}`;
}
