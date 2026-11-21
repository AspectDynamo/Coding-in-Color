import type { PublicQuestion } from '../../shared/api';
import type { QuestionType, SkillCategory } from '../../shared/types';
import {
  choiceConfigSchema,
  debuggingConfigSchema,
  likertConfigSchema,
  orderingConfigSchema,
  rubricConfigSchema,
  shortLogicConfigSchema,
} from '../../shared/validation';
import { ScoringError } from './errors';

export interface PublicQuestionSource {
  id: string;
  type: QuestionType;
  prompt: string;
  config: Record<string, unknown>;
  skillCategory: SkillCategory;
  points: number;
  order: number;
  /** Accepted only so callers can pass a full DB row; it is NEVER copied to the output. */
  answerKey?: Record<string, unknown> | null;
}

const CONFIG_SCHEMAS = {
  multiple_choice: choiceConfigSchema,
  multiple_select: choiceConfigSchema,
  code_comprehension: choiceConfigSchema,
  predict_output: choiceConfigSchema,
  debugging: debuggingConfigSchema,
  ordering: orderingConfigSchema,
  short_logic: shortLogicConfigSchema,
  confidence_likert: likertConfigSchema,
  project_rubric: rubricConfigSchema,
} as const;

/** FNV-1a 32-bit hash of a string. */
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sameOrder(a: { id: string }[], ids: string[]): boolean {
  return a.length === ids.length && a.every((x, i) => x.id === ids[i]);
}

/** Deterministic shuffle by seed; guaranteed to differ from the authored order (and the key order, if known). */
export function shuffleItems<T extends { id: string }>(
  items: T[],
  seed: string,
  avoid: string[][] = [],
): T[] {
  const rand = prng(hash32(seed));
  let out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  const forbidden = [items.map((i) => i.id), ...avoid];
  for (let k = 0; k < out.length && forbidden.some((f) => sameOrder(out, f)); k++) {
    out = [...out.slice(1), out[0] as T];
  }
  return out;
}

/**
 * Convert a stored question into the student-facing shape. The public config is re-parsed with the
 * type's config schema, which drops unknown keys, so stray answer-related fields can never leak.
 * Ordering items are shuffled deterministically from `shuffleSeed` (+ question id) so a refresh keeps
 * the same order. `answerKey` is never included.
 */
export function toPublicQuestion(
  q: PublicQuestionSource,
  opts: { shuffleSeed: string },
): PublicQuestion {
  const schema = CONFIG_SCHEMAS[q.type];
  const parsed = schema.safeParse(q.config);
  if (!parsed.success)
    throw new ScoringError(`Malformed config for ${q.type} question ${q.id}`, q.id);
  let config = parsed.data as Record<string, unknown>;

  if (q.type === 'ordering') {
    const items = (config as { items: { id: string; label: string }[] }).items;
    const key =
      q.answerKey && Array.isArray(q.answerKey.correctOrder)
        ? (q.answerKey.correctOrder as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
    config = {
      ...config,
      items: shuffleItems(items, `${opts.shuffleSeed}:${q.id}`, key.length ? [key] : []),
    };
  }

  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    config,
    skillCategory: q.skillCategory,
    points: q.points,
    order: q.order,
  };
}
