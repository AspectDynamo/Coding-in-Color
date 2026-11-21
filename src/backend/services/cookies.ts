import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { CSRF_COOKIE } from '@shared/api';
import { STAFF_SESSION_TTL_SECONDS, STUDENT_SESSION_TTL_SECONDS } from '@shared/constants';

export const STUDENT_COOKIE = 'cic_student';
export const STAFF_COOKIE = 'cic_staff';
export const MFA_COOKIE = 'cic_mfa';
export const MFA_TTL_SECONDS = 5 * 60;

/** Secure everywhere except plain-http localhost development. */
export function isSecureRequest(c: Context): boolean {
  const u = new URL(c.req.url);
  if (u.protocol === 'https:') return true;
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
}

export function setSessionCookie(c: Context, name: string, value: string, maxAge: number): void {
  setCookie(c, name, value, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isSecureRequest(c),
    maxAge,
  });
}
export function clearSessionCookie(c: Context, name: string): void {
  deleteCookie(c, name, { path: '/', secure: isSecureRequest(c), httpOnly: true, sameSite: 'Lax' });
}
export function setCsrfCookie(c: Context, value: string): void {
  setCookie(c, CSRF_COOKIE, value, {
    httpOnly: false,
    sameSite: 'Lax',
    path: '/',
    secure: isSecureRequest(c),
  });
}
export const readCookie = (c: Context, name: string): string | undefined => getCookie(c, name);

export const studentCookieMaxAge = STUDENT_SESSION_TTL_SECONDS;
export const staffCookieMaxAge = STAFF_SESSION_TTL_SECONDS;
