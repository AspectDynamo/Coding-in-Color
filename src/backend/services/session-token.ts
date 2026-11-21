/**
 * Signed session tokens: base64url(payload JSON) + "." + base64url(HMAC-SHA256(secret, "v1." + payload)).
 * Signed, NOT encrypted: never put secrets in the payload. The cic_mfa token carries a Supabase access
 * token only as AES-GCM ciphertext (see routes/auth.ts, crypto.sealString) and is HttpOnly + 5 minutes.
 */
import {
  base64urlDecode,
  base64urlEncode,
  hmacSha256,
  timingSafeEqual,
  utf8,
  utf8Decode,
} from './crypto';

export type TokenType = 'student' | 'staff' | 'mfa';

export interface TokenPayload {
  sub: string;
  typ: TokenType;
  cid?: string; // credential id (students)
  role?: string; // informational only; authorization reloads the staff row
  at?: string; // supabase access token, AES-GCM ciphertext (mfa tokens only)
  jti?: string; // random token id (mfa tokens only): single-use, best effort
  enr?: boolean; // mfa tokens only: the account had no verified TOTP factor, so POST /auth/mfa/enroll is allowed
  iat: number;
  exp: number;
}

const VERSION = 'v1.';

export async function signToken(
  claims: Omit<TokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const payload: TokenPayload = { ...claims, iat, exp: iat + ttlSeconds };
  const body = base64urlEncode(utf8(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, VERSION + body);
  return `${body}.${base64urlEncode(sig)}`;
}

export async function verifyToken(
  token: string | undefined | null,
  secret: string,
  expectedType: TokenType,
  nowMs = Date.now(),
): Promise<TokenPayload | null> {
  if (!token || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  let given: Uint8Array;
  try {
    given = base64urlDecode(sig);
  } catch {
    return null;
  }
  const expected = await hmacSha256(secret, VERSION + body);
  if (!timingSafeEqual(expected, given)) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(utf8Decode(base64urlDecode(body))) as TokenPayload;
  } catch {
    return null;
  }
  if (!payload || payload.typ !== expectedType) return null;
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.exp !== 'number' ||
    typeof payload.iat !== 'number'
  )
    return null;
  if (payload.exp <= Math.floor(nowMs / 1000)) return null;
  return payload;
}
