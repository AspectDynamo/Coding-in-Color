import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { uuid } from '@shared/validation';
import type { ApiPage, ApiSuccess } from '@shared/api';
import type { AppEnv } from '../env';
import { badRequest, notFound } from './errors';

const MAX_BODY_BYTES = 512 * 1024;

export function ok<T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200): Response {
  return c.json({ data } satisfies ApiSuccess<T>, status);
}

export function paged<T>(
  c: Context<AppEnv>,
  items: T[],
  total: number,
  limit: number,
  offset: number,
): Response {
  return c.json({ data: items, page: { limit, offset, total } } satisfies ApiPage<T>);
}

/** Parse + validate a JSON body. ZodError propagates to the global handler (400 with field paths). */
export async function parseBody<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) throw badRequest('Request body is too large.');
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > MAX_BODY_BYTES) throw badRequest('Request body is too large.');
    raw = text.length ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof Error && e.name === 'HttpError') throw e;
    throw badRequest('Request body must be valid JSON.');
  }
  return schema.parse(raw);
}

export function parseQuery<T>(c: Context<AppEnv>, schema: ZodType<T>): T {
  return schema.parse(c.req.query());
}

/** Route :param that must be a uuid; anything else is a plain 404 (never reaches the database). */
export function idParam(c: Context<AppEnv>, name = 'id'): string {
  const v = c.req.param(name);
  const parsed = uuid.safeParse(v);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export const originOf = (c: Context<AppEnv>): string => new URL(c.req.url).origin;
