/** Thrown when a question's config / answer key / points are malformed (a server-side data problem). */
export class ScoringError extends Error {
  readonly questionId: string | null;
  constructor(message: string, questionId: string | null = null) {
    super(message);
    this.name = 'ScoringError';
    this.questionId = questionId;
  }
}

export type ResponseValidationCode =
  | 'unknown_question'
  | 'duplicate_question'
  | 'kind_mismatch'
  | 'unknown_option'
  | 'unknown_item'
  | 'duplicate_value'
  | 'invalid_value'
  | 'not_answerable';

/** Thrown when a student's submitted response is invalid for its question (a client error: 400). */
export class ResponseValidationError extends Error {
  readonly questionId: string | null;
  readonly code: ResponseValidationCode;
  constructor(code: ResponseValidationCode, message: string, questionId: string | null) {
    super(message);
    this.name = 'ResponseValidationError';
    this.code = code;
    this.questionId = questionId;
  }
}
