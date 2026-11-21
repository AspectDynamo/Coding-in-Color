import type { QuestionType } from '../../shared/types';
import {
  choiceConfigSchema,
  debuggingConfigSchema,
  debuggingKeySchema,
  likertConfigSchema,
  multiKeySchema,
  orderingConfigSchema,
  orderingKeySchema,
  shortLogicConfigSchema,
  shortLogicKeySchema,
  singleKeySchema,
  type ResponseValue,
} from '../../shared/validation';
import { ResponseValidationError, ScoringError } from './errors';
import { shortAnswerMatches } from './normalize';
import type { ScoringQuestion } from './types';

export interface ScorerResult {
  /** null only for non-gradable items (likert). */
  isCorrect: boolean | null;
  /** Fraction of the question's points earned, 0..1. */
  fraction: number;
}

/**
 * Scorer contract. `category`:
 *  - auto:     contributes to max_score and raw_score
 *  - likert:   0 points, excluded from max, averaged into self-reported confidence
 *  - excluded: ignored entirely (project_rubric)
 * `prepare` validates config + answer key (throws ScoringError). `validateResponse` and `score`
 * only ever see a non-skipped response whose `kind` already matches RESPONSE_KIND_BY_TYPE.
 */
export interface Scorer<P = unknown> {
  category: 'auto' | 'likert' | 'excluded';
  prepare(q: ScoringQuestion): P;
  validateResponse(q: ScoringQuestion, prepared: P, response: ResponseValue): void;
  score(q: ScoringQuestion, prepared: P, response: ResponseValue): ScorerResult;
}

function define<P>(s: Scorer<P>): Scorer {
  return s as unknown as Scorer;
}

function parseOrThrow<T>(
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  q: ScoringQuestion,
  what: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first
      ? `${first.path.map(String).join('.') || '(root)'}: ${first.message}`
      : 'invalid';
    throw new ScoringError(`Malformed ${what} for ${q.type} question ${q.id} (${where})`, q.id);
  }
  return r.data;
}

function requireKey(q: ScoringQuestion): Record<string, unknown> {
  if (!q.answerKey)
    throw new ScoringError(`Missing answer key for ${q.type} question ${q.id}`, q.id);
  return q.answerKey;
}

function uniqueIds(ids: string[], q: ScoringQuestion, what: string): Set<string> {
  const set = new Set(ids);
  if (set.size !== ids.length)
    throw new ScoringError(`Duplicate ${what} ids in ${q.type} question ${q.id}`, q.id);
  return set;
}

function bad(
  code: 'unknown_option' | 'unknown_item' | 'duplicate_value' | 'invalid_value',
  msg: string,
  q: ScoringQuestion,
): never {
  throw new ResponseValidationError(code, msg, q.id);
}

/* ---------------- single choice (multiple_choice, code_comprehension, predict_output) ---------------- */

interface ChoicePrepared {
  optionIds: Set<string>;
  correct: string;
}
const singleChoice = define<ChoicePrepared>({
  category: 'auto',
  prepare(q) {
    const config = parseOrThrow(choiceConfigSchema, q.config, q, 'config');
    const key = parseOrThrow(singleKeySchema, requireKey(q), q, 'answer key');
    const optionIds = uniqueIds(
      config.options.map((o) => o.id),
      q,
      'option',
    );
    if (!optionIds.has(key.correctOptionId)) {
      throw new ScoringError(`Answer key references unknown option in question ${q.id}`, q.id);
    }
    return { optionIds, correct: key.correctOptionId };
  },
  validateResponse(q, p, r) {
    if (r.kind !== 'single') return;
    if (!p.optionIds.has(r.optionId)) bad('unknown_option', 'Unknown option id', q);
  },
  score(_q, p, r) {
    const ok = r.kind === 'single' && r.optionId === p.correct;
    return { isCorrect: ok, fraction: ok ? 1 : 0 };
  },
});

/* ---------------- multiple_select ---------------- */

interface MultiPrepared {
  optionIds: Set<string>;
  correct: Set<string>;
}
const multipleSelect = define<MultiPrepared>({
  category: 'auto',
  prepare(q) {
    const config = parseOrThrow(choiceConfigSchema, q.config, q, 'config');
    const key = parseOrThrow(multiKeySchema, requireKey(q), q, 'answer key');
    const optionIds = uniqueIds(
      config.options.map((o) => o.id),
      q,
      'option',
    );
    const correct = uniqueIds(key.correctOptionIds, q, 'correct option');
    for (const id of correct) {
      if (!optionIds.has(id))
        throw new ScoringError(`Answer key references unknown option in question ${q.id}`, q.id);
    }
    return { optionIds, correct };
  },
  validateResponse(q, p, r) {
    if (r.kind !== 'multi') return;
    const seen = new Set<string>();
    for (const id of r.optionIds) {
      if (!p.optionIds.has(id)) bad('unknown_option', 'Unknown option id', q);
      if (seen.has(id)) bad('duplicate_value', 'Duplicate option id', q);
      seen.add(id);
    }
  },
  score(_q, p, r) {
    if (r.kind !== 'multi') return { isCorrect: false, fraction: 0 };
    let correctSelected = 0;
    let incorrectSelected = 0;
    for (const id of r.optionIds) {
      if (p.correct.has(id)) correctSelected += 1;
      else incorrectSelected += 1;
    }
    const fraction = Math.max(0, (correctSelected - incorrectSelected) / p.correct.size);
    return { isCorrect: correctSelected === p.correct.size && incorrectSelected === 0, fraction };
  },
});

/* ---------------- debugging ---------------- */

const debugging = define<{ bugLine: number }>({
  category: 'auto',
  prepare(q) {
    const config = parseOrThrow(debuggingConfigSchema, q.config, q, 'config');
    const key = parseOrThrow(debuggingKeySchema, requireKey(q), q, 'answer key');
    const lineCount = config.code.split(/\r\n|\r|\n/).length;
    if (key.bugLine > lineCount) {
      throw new ScoringError(`Answer key bugLine is outside the code in question ${q.id}`, q.id);
    }
    return { bugLine: key.bugLine };
  },
  validateResponse() {
    // any positive integer line is a legal (if possibly wrong) answer
  },
  score(_q, p, r) {
    const ok = r.kind === 'line' && r.line === p.bugLine;
    return { isCorrect: ok, fraction: ok ? 1 : 0 };
  },
});

/* ---------------- ordering ---------------- */

const ordering = define<{ itemIds: Set<string>; correct: string[] }>({
  category: 'auto',
  prepare(q) {
    const config = parseOrThrow(orderingConfigSchema, q.config, q, 'config');
    const key = parseOrThrow(orderingKeySchema, requireKey(q), q, 'answer key');
    const itemIds = uniqueIds(
      config.items.map((i) => i.id),
      q,
      'item',
    );
    const keyIds = uniqueIds(key.correctOrder, q, 'correct order');
    if (keyIds.size !== itemIds.size || [...keyIds].some((id) => !itemIds.has(id))) {
      throw new ScoringError(
        `Answer key order must be a permutation of the items in question ${q.id}`,
        q.id,
      );
    }
    return { itemIds, correct: key.correctOrder };
  },
  validateResponse(q, p, r) {
    if (r.kind !== 'order') return;
    const seen = new Set<string>();
    for (const id of r.itemIds) {
      if (!p.itemIds.has(id)) bad('unknown_item', 'Unknown item id', q);
      if (seen.has(id)) bad('duplicate_value', 'Duplicate item id', q);
      seen.add(id);
    }
  },
  score(_q, p, r) {
    const ok =
      r.kind === 'order' &&
      r.itemIds.length === p.correct.length &&
      r.itemIds.every((id, i) => id === p.correct[i]);
    return { isCorrect: ok, fraction: ok ? 1 : 0 };
  },
});

/* ---------------- short_logic ---------------- */

const shortLogic = define<{ accepted: string[]; caseSensitive: boolean }>({
  category: 'auto',
  prepare(q) {
    parseOrThrow(shortLogicConfigSchema, q.config, q, 'config');
    const key = parseOrThrow(shortLogicKeySchema, requireKey(q), q, 'answer key');
    return { accepted: key.acceptedAnswers, caseSensitive: key.caseSensitive };
  },
  validateResponse() {},
  score(_q, p, r) {
    const ok = r.kind === 'text' && shortAnswerMatches(r.text, p.accepted, p.caseSensitive);
    return { isCorrect: ok, fraction: ok ? 1 : 0 };
  },
});

/* ---------------- confidence_likert / project_rubric ---------------- */

const likert = define<null>({
  category: 'likert',
  prepare(q) {
    parseOrThrow(likertConfigSchema, q.config, q, 'config');
    return null;
  },
  validateResponse() {},
  score() {
    return { isCorrect: null, fraction: 0 };
  },
});

const rubric = define<null>({
  category: 'excluded',
  prepare: () => null,
  validateResponse() {},
  score() {
    return { isCorrect: null, fraction: 0 };
  },
});

/** Registry keyed by QuestionType. Adding a question type = adding an entry here. */
export const scorers: Record<QuestionType, Scorer> = {
  multiple_choice: singleChoice,
  code_comprehension: singleChoice,
  predict_output: singleChoice,
  multiple_select: multipleSelect,
  debugging,
  ordering,
  short_logic: shortLogic,
  confidence_likert: likert,
  project_rubric: rubric,
};
