/**
 * Session loaders and authorization helpers. Every request re-reads the credential/student or the
 * staff row, so revocation, withdrawal, role changes and disabling take effect immediately.
 */
import type { MiddlewareHandler } from 'hono';
import { ROLE_PERMISSIONS, PROGRAM_SCOPED_ROLES } from '@shared/constants';
import type { Permission } from '@shared/types';
import type { AppEnv, StaffAuth } from '../env';
import { STAFF_COOKIE, STUDENT_COOKIE, readCookie } from '../services/cookies';
import { verifyToken } from '../services/session-token';
import { HttpError, forbidden, unauthenticated } from '../utils/errors';

export const requireStudent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cfg = c.get('config');
  const token = await verifyToken(readCookie(c, STUDENT_COOKIE), cfg.sessionSecret, 'student');
  if (!token || !token.cid) throw unauthenticated();
  const found = await c.get('store').getCredentialWithStudent(token.cid);
  if (
    !found ||
    found.student.id !== token.sub ||
    found.credential.revoked_at ||
    found.student.status === 'withdrawn'
  ) {
    throw unauthenticated();
  }
  c.set('student', {
    id: found.student.id,
    credentialId: found.credential.id,
    publicCode: found.student.public_code,
    ageBand: found.student.age_band,
    status: found.student.status,
  });
  await next();
};

export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cfg = c.get('config');
  const token = await verifyToken(readCookie(c, STAFF_COOKIE), cfg.sessionSecret, 'staff');
  if (!token) throw unauthenticated();
  const row = await c.get('store').getStaff(token.sub);
  if (!row || row.staff.status !== 'active') throw unauthenticated();
  c.set('staff', toStaffAuth(row.staff, row.programIds));
  await next();
};

export function toStaffAuth(
  staff: { id: string; display_name: string; role: StaffAuth['role']; is_synthetic: boolean },
  programIds: string[],
): StaffAuth {
  return {
    id: staff.id,
    displayName: staff.display_name,
    role: staff.role,
    permissions: [...ROLE_PERMISSIONS[staff.role]],
    programIds,
    isSynthetic: staff.is_synthetic,
  };
}

export const requirePermission =
  (...perms: Permission[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const staff = c.get('staff');
    if (!staff) throw unauthenticated();
    if (!perms.every((p) => staff.permissions.includes(p))) throw forbidden();
    await next();
  };

/** True when the staff member's programs are limited to assignments (instructors). */
export function isProgramScoped(staff: StaffAuth): boolean {
  return PROGRAM_SCOPED_ROLES.includes(staff.role);
}

/** Throws 403 unless the staff member may act on this program. */
export function assertProgramAccess(staff: StaffAuth, programId: string): void {
  if (isProgramScoped(staff) && !staff.programIds.includes(programId)) {
    throw new HttpError(403, 'forbidden', 'You do not have access to this program.');
  }
}

/** Program ids to restrict queries to, or null when unrestricted. */
export function programScope(staff: StaffAuth): string[] | null {
  return isProgramScoped(staff) ? staff.programIds : null;
}
