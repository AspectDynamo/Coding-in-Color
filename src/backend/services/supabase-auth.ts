/**
 * Minimal Supabase Auth REST client (staff sign-in only). Passwords and tokens never appear in logs;
 * failures are mapped to coarse outcomes so callers can return identical errors.
 */
import { base64urlDecode, utf8, utf8Decode } from './crypto';
import type { AppConfig } from '../config';
import { log } from '../utils/logger';

const TIMEOUT_MS = 10_000;

export type AuthOutcome<T> =
  { ok: true; value: T } | { ok: false; reason: 'rejected' | 'rate_limited' | 'unavailable' };

async function call(
  url: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<{ status: number; json: unknown } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    log('warn', 'supabase_auth.network_error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function classify(status: number): 'rejected' | 'rate_limited' | 'unavailable' {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'rejected';
}

/** Reads the `aal` claim of a Supabase access token (no signature check: it came straight from Supabase over TLS). */
export function aalOfAccessToken(accessToken: string): 'aal1' | 'aal2' | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const claims = JSON.parse(utf8Decode(base64urlDecode(part))) as { aal?: string };
    return claims.aal === 'aal2' ? 'aal2' : claims.aal === 'aal1' ? 'aal1' : null;
  } catch {
    return null;
  }
}

export interface PasswordGrant {
  accessToken: string;
  userId: string;
}

export async function passwordGrant(
  cfg: AppConfig,
  email: string,
  password: string,
): Promise<AuthOutcome<PasswordGrant>> {
  const res = await call(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status !== 200) return { ok: false, reason: classify(res.status) };
  const j = res.json as { access_token?: string; user?: { id?: string } } | null;
  if (!j?.access_token || !j.user?.id) return { ok: false, reason: 'unavailable' };
  return { ok: true, value: { accessToken: j.access_token, userId: j.user.id } };
}

export interface AuthFactor {
  id: string;
  type: string;
  status: string;
}

/** All MFA factors of the signed-in user, verified or not (GET /auth/v1/user returns them under `factors`). */
export async function listFactors(
  cfg: AppConfig,
  accessToken: string,
): Promise<AuthOutcome<AuthFactor[]>> {
  const res = await call(`${cfg.supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: cfg.supabaseAnonKey ?? '', Authorization: `Bearer ${accessToken}` },
  });
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status !== 200) return { ok: false, reason: classify(res.status) };
  const factors =
    (res.json as { factors?: { id?: string; factor_type?: string; status?: string }[] } | null)
      ?.factors ?? [];
  return {
    ok: true,
    value: factors
      .filter((f) => typeof f.id === 'string')
      .map((f) => ({
        id: f.id as string,
        type: String(f.factor_type ?? ''),
        status: String(f.status ?? ''),
      })),
  };
}

/** Verified TOTP factors of the signed-in user. */
export async function listTotpFactors(
  cfg: AppConfig,
  accessToken: string,
): Promise<AuthOutcome<{ id: string; type: 'totp' }[]>> {
  const all = await listFactors(cfg, accessToken);
  if (!all.ok) return all;
  return {
    ok: true,
    value: all.value
      .filter((f) => f.type === 'totp' && f.status === 'verified')
      .map((f) => ({ id: f.id, type: 'totp' as const })),
  };
}

export const TOTP_FRIENDLY_NAME = 'Coding in Color Impact';

/**
 * Supabase returns the QR code as raw SVG text (older/newer versions: prefixed with
 * `data:image/svg+xml;utf-8,`). Normalise to a base64 data URI that an <img> can render, and refuse
 * anything that is not an SVG document.
 */
export function qrToDataUri(raw: string): string | null {
  let svg = raw.trim();
  if (/^data:image\/svg\+xml/i.test(svg)) {
    if (/^data:image\/svg\+xml;base64,/i.test(svg)) return svg;
    const comma = svg.indexOf(',');
    if (comma < 0) return null;
    svg = svg.slice(comma + 1);
    try {
      svg = decodeURIComponent(svg);
    } catch {
      /* already raw SVG that contains a literal percent sign */
    }
  }
  if (!/^<(\?xml|svg)\b/i.test(svg) || svg.length > 100_000) return null;
  let bin = '';
  for (const b of utf8(svg)) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

function userHeaders(cfg: AppConfig, accessToken: string): Record<string, string> {
  return {
    apikey: cfg.supabaseAnonKey ?? '',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/** Deletes the user's unverified factors (stale, abandoned enrollments). Verified factors are never touched. */
async function deleteUnverifiedFactors(cfg: AppConfig, accessToken: string): Promise<boolean> {
  const all = await listFactors(cfg, accessToken);
  if (!all.ok) return false;
  for (const f of all.value.filter((x) => x.status !== 'verified')) {
    const res = await call(`${cfg.supabaseUrl}/auth/v1/factors/${encodeURIComponent(f.id)}`, {
      method: 'DELETE',
      headers: userHeaders(cfg, accessToken),
    });
    if (!res || res.status >= 300) return false;
  }
  return true;
}

/**
 * Starts TOTP enrollment (POST /auth/v1/factors). The factor stays unverified until the user submits
 * a code through the normal challenge + verify step. If Supabase rejects a duplicate friendly name (an
 * abandoned earlier attempt), the stale unverified factors are removed and the call retried once.
 * The returned secret and QR are never logged here.
 */
export async function enrollTotp(
  cfg: AppConfig,
  accessToken: string,
): Promise<AuthOutcome<TotpEnrollment>> {
  const attempt = () =>
    call(`${cfg.supabaseUrl}/auth/v1/factors`, {
      method: 'POST',
      headers: userHeaders(cfg, accessToken),
      body: JSON.stringify({ factor_type: 'totp', friendly_name: TOTP_FRIENDLY_NAME }),
    });
  let res = await attempt();
  if (res && (res.status === 422 || res.status === 409 || res.status === 400)) {
    const code = (res.json as { error_code?: string } | null)?.error_code;
    if (code === 'mfa_factor_name_conflict' || code === 'too_many_enrolled_mfa_factors') {
      if (await deleteUnverifiedFactors(cfg, accessToken)) res = await attempt();
    }
  }
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status !== 200 && res.status !== 201) return { ok: false, reason: classify(res.status) };
  const j = res.json as { id?: string; totp?: { qr_code?: string; secret?: string } } | null;
  const qrCode = j?.totp?.qr_code ? qrToDataUri(j.totp.qr_code) : null;
  if (!j?.id || !j.totp?.secret || !qrCode) return { ok: false, reason: 'unavailable' };
  return { ok: true, value: { factorId: j.id, qrCode, secret: j.totp.secret } };
}

/** Challenge + verify a TOTP code; success means Supabase issued an aal2 session. */
export async function verifyTotp(
  cfg: AppConfig,
  accessToken: string,
  factorId: string,
  code: string,
): Promise<AuthOutcome<true>> {
  const headers = {
    apikey: cfg.supabaseAnonKey ?? '',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const base = `${cfg.supabaseUrl}/auth/v1/factors/${encodeURIComponent(factorId)}`;
  const challenge = await call(`${base}/challenge`, { method: 'POST', headers, body: '{}' });
  if (!challenge) return { ok: false, reason: 'unavailable' };
  if (challenge.status !== 200) return { ok: false, reason: classify(challenge.status) };
  const challengeId = (challenge.json as { id?: string } | null)?.id;
  if (!challengeId) return { ok: false, reason: 'unavailable' };
  const verify = await call(`${base}/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  if (!verify) return { ok: false, reason: 'unavailable' };
  if (verify.status !== 200) return { ok: false, reason: classify(verify.status) };
  return { ok: true, value: true };
}

export async function requestPasswordRecovery(cfg: AppConfig, email: string): Promise<void> {
  await call(`${cfg.supabaseUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

/** Admin invite (service role). Returns the new auth user id. */
export async function inviteUser(
  cfg: AppConfig,
  email: string,
): Promise<AuthOutcome<{ userId: string }>> {
  const key = cfg.supabaseServiceKey ?? '';
  const res = await call(`${cfg.supabaseUrl}/auth/v1/invite`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status !== 200) return { ok: false, reason: classify(res.status) };
  const id = (res.json as { id?: string } | null)?.id;
  if (!id) return { ok: false, reason: 'unavailable' };
  return { ok: true, value: { userId: id } };
}

export const authConfigured = (cfg: AppConfig): boolean =>
  !!cfg.supabaseUrl && !!cfg.supabaseAnonKey;
