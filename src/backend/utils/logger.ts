/**
 * Structured JSON logger with redaction. Never pass bodies, cookies, codes, emails or guardian
 * contacts; the redactor is defence in depth, not permission.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEY =
  /code|cookie|secret|token|password|authorization|email|guardian|body|pepper|credential|hash|key|contact|phone|payload|prompt|response|answer/i;
// Access codes (16 Crockford chars, optionally dashed) and JWT-looking strings.
const CODE_LIKE =
  /(?<![A-Za-z0-9-])(?:[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}|(?=[0-9A-HJKMNP-TV-Z]*[0-9])[0-9A-HJKMNP-TV-Z]{16})(?![A-Za-z0-9-])/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;

function scrub(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.replace(JWT_LIKE, '[redacted]').replace(CODE_LIKE, '[redacted]').slice(0, 300);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return String(typeof value);
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...(scrub(fields) as object),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Describe an unknown thrown value without leaking messages that may embed data. */
export function errorSummary(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: String(scrub(err.message)) };
  return { name: 'NonError', message: 'non-error thrown' };
}
