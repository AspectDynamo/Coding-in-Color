import type { ApiErrorCode } from '@shared/api';

/** Thrown anywhere in a handler; the global error handler renders the standard envelope. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message = 'Invalid request.', details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthenticated = (message = 'Sign in required.') =>
  new HttpError(401, 'unauthenticated', message);
export const forbidden = (message = 'You do not have access to this.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message = 'That conflicts with the current state.') =>
  new HttpError(409, 'conflict', message);

export const INVALID_CODE_MESSAGE = "That code didn't work. Check it and try again.";
export const invalidCode = () => new HttpError(401, 'invalid_code', INVALID_CODE_MESSAGE);

/** Errors raised by DataStore implementations for expected business-rule failures. */
export type StoreErrorCode =
  | 'attempt_not_found'
  | 'already_submitted'
  | 'public_code_conflict'
  | 'roster_conflict'
  | 'not_found'
  | 'duplicate';
export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'StoreError';
  }
}
