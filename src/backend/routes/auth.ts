import { Hono, type Context } from 'hono';
import type { LoginResult, MfaEnrollment, StaffProfile } from '@shared/api';
import {
  demoLoginBody,
  mfaVerifyBody,
  passwordResetBody,
  staffLoginBody,
} from '@shared/validation';
import type { AppEnv, StaffAuth } from '../env';
import { requireStaff, toStaffAuth } from '../middleware/auth';
import { accountSubject, enforceRateLimit } from '../services/rate-limit';
import { openString, randomToken, sealString } from '../services/crypto';
import { signToken, verifyToken } from '../services/session-token';
import {
  MFA_COOKIE,
  MFA_TTL_SECONDS,
  STAFF_COOKIE,
  clearSessionCookie,
  readCookie,
  setSessionCookie,
  staffCookieMaxAge,
} from '../services/cookies';
import {
  aalOfAccessToken,
  authConfigured,
  enrollTotp,
  listTotpFactors,
  passwordGrant,
  requestPasswordRecovery,
  verifyTotp,
} from '../services/supabase-auth';
import { audit } from '../services/audit';
import { HttpError, forbidden, notFound, unauthenticated } from '../utils/errors';
import { ok, parseBody } from '../utils/http';

export const authRoutes = new Hono<AppEnv>();

const BAD_LOGIN = 'Email or password is incorrect.';

const MFA_INFO = 'cic-mfa-v1';

/**
 * Single-use MFA tokens (jti). Best effort only: the set lives in this isolate's memory, so a replay
 * routed to another isolate is not caught here. Supabase's own TOTP verification limits (and the
 * per-subject limiter plus the 5-minute token lifetime) back it up.
 */
const usedMfaJtis = new Map<string, number>();
const MAX_USED_JTIS = 2_000;

export function resetUsedMfaTokens(): void {
  usedMfaJtis.clear();
}
function isMfaJtiUsed(jti: string, now = Date.now()): boolean {
  const exp = usedMfaJtis.get(jti);
  return exp !== undefined && exp > now;
}
function markMfaJtiUsed(jti: string, expiresAtMs: number, now = Date.now()): void {
  usedMfaJtis.set(jti, expiresAtMs);
  if (usedMfaJtis.size > MAX_USED_JTIS) {
    for (const [k, v] of usedMfaJtis) if (v <= now) usedMfaJtis.delete(k);
    if (usedMfaJtis.size > MAX_USED_JTIS) usedMfaJtis.clear();
  }
}

export function toProfile(s: StaffAuth): StaffProfile {
  return {
    id: s.id,
    displayName: s.displayName,
    role: s.role,
    permissions: s.permissions,
    programIds: s.programIds,
    isSynthetic: s.isSynthetic,
  };
}

authRoutes.post('/auth/login', async (c) => {
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER');
  const body = await parseBody(c, staffLoginBody);
  // Per-account limit in addition to the per-IP one, so credential stuffing spread over many IPs is slowed too.
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER', await accountSubject(c, body.email));
  const cfg = c.get('config');
  if (!authConfigured(cfg)) {
    throw new HttpError(
      503,
      'not_configured',
      'Staff sign-in is not configured for this deployment.',
    );
  }
  const store = c.get('store');

  const grant = await passwordGrant(cfg, body.email, body.password);
  if (!grant.ok) {
    if (grant.reason === 'rate_limited')
      throw new HttpError(
        429,
        'rate_limited',
        'Too many attempts. Please wait a minute and try again.',
      );
    if (grant.reason === 'unavailable')
      throw new HttpError(503, 'internal', 'Sign-in is temporarily unavailable.');
    throw unauthenticated(BAD_LOGIN);
  }
  const found = await store.getStaffByAuthUserId(grant.value.userId);
  // Unknown auth user, no staff row and disabled accounts all look like a bad login.
  if (!found || found.staff.status === 'disabled') throw unauthenticated(BAD_LOGIN);

  const needsMfa =
    cfg.requireAdminMfa &&
    (found.staff.role === 'owner' || found.staff.role === 'admin') &&
    aalOfAccessToken(grant.value.accessToken) !== 'aal2';
  if (needsMfa) {
    const factors = await listTotpFactors(cfg, grant.value.accessToken);
    if (!factors.ok) throw new HttpError(503, 'internal', 'Sign-in is temporarily unavailable.');
    // No verified factor yet: the user enrolls one (POST /auth/mfa/enroll), then verifies it like any other.
    const enrolling = factors.value.length === 0;
    await setMfaCookie(c, found.staff.id, grant.value.accessToken, enrolling);
    const result: LoginResult = enrolling
      ? { status: 'mfa_enroll_required' }
      : { status: 'mfa_required', factors: factors.value };
    return ok(c, result);
  }

  const profile = await issueStaffSession(c, found.staff, found.programIds);
  await audit(store, {
    actorType: 'staff',
    actorId: found.staff.id,
    action: 'staff.login',
    targetType: 'staff',
    targetId: found.staff.id,
  });
  const result: LoginResult = { status: 'ok', staff: profile };
  return ok(c, result);
});

authRoutes.post('/auth/mfa/verify', async (c) => {
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER');
  const body = await parseBody(c, mfaVerifyBody);
  const cfg = c.get('config');
  const store = c.get('store');
  if (!authConfigured(cfg))
    throw new HttpError(
      503,
      'not_configured',
      'Staff sign-in is not configured for this deployment.',
    );

  const mfa = await verifyToken(readCookie(c, MFA_COOKIE), cfg.sessionSecret, 'mfa');
  if (!mfa?.at || !mfa.jti || isMfaJtiUsed(mfa.jti))
    throw unauthenticated('Your sign-in expired. Start again.');
  // Throttle guesses per staff member regardless of source IP.
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER', `mfa:${mfa.sub}`);
  const accessToken = await openString(cfg.sessionSecret, MFA_INFO, mfa.at, mfa.sub);
  if (!accessToken) throw unauthenticated('Your sign-in expired. Start again.');
  const found = await store.getStaff(mfa.sub);
  if (!found || found.staff.status === 'disabled')
    throw unauthenticated('Your sign-in expired. Start again.');

  const result = await verifyTotp(cfg, accessToken, body.factorId, body.code);
  if (!result.ok) {
    if (result.reason === 'unavailable')
      throw new HttpError(503, 'internal', 'Verification is temporarily unavailable.');
    throw new HttpError(
      401,
      'mfa_required',
      "That code didn't work. Check your authenticator app and try again.",
    );
  }
  // Consumed only on success so a mistyped code can be retried within the 5-minute window.
  markMfaJtiUsed(mfa.jti, mfa.exp * 1000);
  clearSessionCookie(c, MFA_COOKIE);
  const profile = await issueStaffSession(c, found.staff, found.programIds);
  await audit(store, {
    actorType: 'staff',
    actorId: found.staff.id,
    action: 'staff.login',
    targetType: 'staff',
    targetId: found.staff.id,
    metadata: { mfa: true },
  });
  if (mfa.enr) {
    // The new factor just verified: enrollment is complete.
    await audit(store, {
      actorType: 'staff',
      actorId: found.staff.id,
      action: 'staff.mfa_enrolled',
      targetType: 'staff',
      targetId: found.staff.id,
    });
  }
  return ok(c, { staff: profile });
});

/**
 * The Supabase access token is AES-GCM encrypted (key = HKDF(SESSION_SECRET, "cic-mfa-v1"), random IV,
 * bound to the staff id), so the cookie never exposes it even to its holder. jti makes it single-use.
 * `enr` marks a token issued to an account with no verified factor, the only kind allowed to enroll.
 */
async function setMfaCookie(
  c: Context<AppEnv>,
  staffId: string,
  accessToken: string,
  enroll: boolean,
): Promise<void> {
  const cfg = c.get('config');
  const sealed = await sealString(cfg.sessionSecret, MFA_INFO, accessToken, staffId);
  const mfaToken = await signToken(
    {
      sub: staffId,
      typ: 'mfa',
      at: sealed,
      jti: randomToken(16),
      ...(enroll ? { enr: true } : {}),
    },
    cfg.sessionSecret,
    MFA_TTL_SECONDS,
  );
  setSessionCookie(c, MFA_COOKIE, mfaToken, MFA_TTL_SECONDS);
}

authRoutes.post('/auth/mfa/enroll', async (c) => {
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER');
  const cfg = c.get('config');
  const store = c.get('store');
  if (!authConfigured(cfg))
    throw new HttpError(
      503,
      'not_configured',
      'Staff sign-in is not configured for this deployment.',
    );
  const mfa = await verifyToken(readCookie(c, MFA_COOKIE), cfg.sessionSecret, 'mfa');
  if (!mfa?.at || !mfa.jti || isMfaJtiUsed(mfa.jti))
    throw unauthenticated('Your sign-in expired. Start again.');
  // Per staff member, regardless of source IP (each call creates a factor at Supabase).
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER', `mfa-enroll:${mfa.sub}`);
  const accessToken = await openString(cfg.sessionSecret, MFA_INFO, mfa.at, mfa.sub);
  if (!accessToken) throw unauthenticated('Your sign-in expired. Start again.');
  const found = await store.getStaff(mfa.sub);
  if (!found || found.staff.status === 'disabled')
    throw unauthenticated('Your sign-in expired. Start again.');
  // Only sign-ins that found no verified factor may enroll; otherwise a stolen password alone could
  // add an attacker-controlled second factor to an account that already has one.
  if (!mfa.enr) throw forbidden('This account already has an authenticator app.');
  const existing = await listTotpFactors(cfg, accessToken);
  if (!existing.ok) throw new HttpError(503, 'internal', 'Enrollment is temporarily unavailable.');
  if (existing.value.length > 0) throw forbidden('This account already has an authenticator app.');

  const enrolled = await enrollTotp(cfg, accessToken);
  if (!enrolled.ok) {
    if (enrolled.reason === 'rate_limited')
      throw new HttpError(
        429,
        'rate_limited',
        'Too many attempts. Please wait a minute and try again.',
      );
    throw new HttpError(503, 'internal', 'Enrollment is temporarily unavailable.');
  }
  const result: MfaEnrollment = enrolled.value;
  const res = ok(c, result);
  res.headers.set('Cache-Control', 'no-store');
  return res;
});

authRoutes.post('/auth/demo-login', async (c) => {
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER');
  const store = c.get('store');
  // Demo sign-in exists only for the synthetic in-memory store; it can never reach real data.
  if (store.kind !== 'memory') throw notFound();
  const body = await parseBody(c, demoLoginBody);
  const found = await store.getStaffByRole(body.role, true);
  if (!found) throw notFound();
  const profile = await issueStaffSession(c, found.staff, found.programIds);
  await audit(store, {
    actorType: 'staff',
    actorId: found.staff.id,
    action: 'staff.login',
    targetType: 'staff',
    targetId: found.staff.id,
    metadata: { demo: true },
  });
  return ok(c, { staff: profile });
});

authRoutes.get('/auth/me', requireStaff, (c) => ok(c, toProfile(c.get('staff')!)));

authRoutes.post('/auth/logout', (c) => {
  clearSessionCookie(c, STAFF_COOKIE);
  clearSessionCookie(c, MFA_COOKIE);
  return ok(c, { ok: true });
});

authRoutes.post('/auth/password-reset', async (c) => {
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER');
  const body = await parseBody(c, passwordResetBody);
  await enforceRateLimit(c, 'STAFF_LOGIN_LIMITER', await accountSubject(c, body.email));
  const cfg = c.get('config');
  if (authConfigured(cfg)) {
    try {
      await requestPasswordRecovery(cfg, body.email);
    } catch {
      // Always the same answer: never reveal whether the address exists.
    }
  }
  return ok(c, { ok: true });
});

async function issueStaffSession(
  c: Context<AppEnv>,
  staff: { id: string; display_name: string; role: StaffAuth['role']; is_synthetic: boolean },
  programIds: string[],
): Promise<StaffProfile> {
  const cfg = c.get('config');
  const token = await signToken(
    { sub: staff.id, typ: 'staff', role: staff.role },
    cfg.sessionSecret,
    staffCookieMaxAge,
  );
  setSessionCookie(c, STAFF_COOKIE, token, staffCookieMaxAge);
  await c.get('store').touchStaffLogin(staff.id);
  return toProfile(toStaffAuth(staff, programIds));
}
