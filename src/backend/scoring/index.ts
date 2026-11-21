/**
 * Server-side scoring. Pure functions, no I/O. Convention: src/shared/constants.ts (SCORE_DECIMALS etc).
 */
import {
  RESPONSE_KIND_BY_TYPE,
  responseValueSchema,
  type ResponseValue,
} from '../../shared/validation';
import { SKILL_CATEGORIES, type SkillCategory } from '../../shared/types';
import { ResponseValidationError, ScoringError } from './errors';
import { roundTo } from './round';
import { scorers, type Scorer } from './scorers';
import type { ScoredResponse, ScoringInput, ScoringQuestion, ScoringResult } from './types';

export { ResponseValidationError, ScoringError } from './errors';
export type { ResponseValidationCode } from './errors';
export { scorers } from './scorers';
export type { Scorer, ScorerResult } from './scorers';
export { toPublicQuestion, shuffleItems } from './public';
export type { PublicQuestionSource } from './public';
export { normalizeText, shortAnswerMatches } from './normalize';
export { roundTo } from './round';
export type { ScoringInput, ScoringQuestion, ScoringResult, ScoredResponse } from './types';

const SKIPPED: ResponseValue = { kind: 'skipped' };

function isAnswered(r: ResponseValue): boolean {
  switch (r.kind) {
    case 'skipped':
      return false;
    case 'text':
      return r.text.trim().length > 0;
    case 'multi':
      return r.optionIds.length > 0;
    case 'order':
      return r.itemIds.length > 0;
    default:
      return true;
  }
}

export function scoreAttempt(input: ScoringInput): ScoringResult {
  // 1. Prepare every question (validates config + answer key even if the student skipped it).
  const byId = new Map<string, { q: ScoringQuestion; scorer: Scorer; prepared: unknown }>();
  for (const q of input.questions) {
    if (byId.has(q.id)) throw new ScoringError(`Duplicate question id ${q.id}`, q.id);
    if (!Number.isFinite(q.points) || q.points < 0)
      throw new ScoringError(`Invalid points for question ${q.id}`, q.id);
    const scorer = scorers[q.type];
    if (!scorer)
      throw new ScoringError(`No scorer registered for question type ${String(q.type)}`, q.id);
    byId.set(q.id, { q, scorer, prepared: scorer.prepare(q) });
  }

  // 2. Validate responses: known, unique, well-formed, right kind, valid option/item ids.
  const responseById = new Map<string, ResponseValue>();
  for (const item of input.responses) {
    const entry = byId.get(item.questionId);
    if (!entry)
      throw new ResponseValidationError(
        'unknown_question',
        'Response references a question not in this assessment',
        item.questionId,
      );
    if (responseById.has(item.questionId))
      throw new ResponseValidationError(
        'duplicate_question',
        'Duplicate response for question',
        item.questionId,
      );
    const parsed = responseValueSchema.safeParse(item.response);
    if (!parsed.success)
      throw new ResponseValidationError(
        'invalid_value',
        'Malformed response value',
        item.questionId,
      );
    const response = parsed.data;
    const expected = RESPONSE_KIND_BY_TYPE[entry.q.type];
    if (expected === null)
      throw new ResponseValidationError(
        'not_answerable',
        'Question cannot be answered by students',
        item.questionId,
      );
    if (response.kind !== 'skipped') {
      if (response.kind !== expected) {
        throw new ResponseValidationError(
          'kind_mismatch',
          `Expected a "${expected}" response`,
          item.questionId,
        );
      }
      entry.scorer.validateResponse(entry.q, entry.prepared, response);
    }
    responseById.set(item.questionId, response);
  }

  // 3. Score.
  const scored: ScoredResponse[] = [];
  const skillTotals = new Map<SkillCategory, { earned: number; max: number }>();
  const likertValues: number[] = [];
  let raw = 0;
  let max = 0;
  let answered = 0;

  for (const { q, scorer, prepared } of byId.values()) {
    if (scorer.category === 'excluded') continue;
    const response = responseById.get(q.id) ?? SKIPPED;
    const didAnswer = isAnswered(response);
    if (didAnswer) answered += 1;

    if (scorer.category === 'likert') {
      if (response.kind === 'likert') likertValues.push(response.value);
      scored.push({
        questionId: q.id,
        responseData: response,
        isCorrect: null,
        earnedPoints: 0,
        maxPoints: 0,
      });
      continue;
    }

    let earned = 0;
    let isCorrect = false;
    if (didAnswer) {
      const r = scorer.score(q, prepared, response);
      earned = roundTo(q.points * r.fraction, 2);
      isCorrect = r.isCorrect ?? false;
    }
    const points = roundTo(q.points, 2);
    raw += earned;
    max += points;
    const totals = skillTotals.get(q.skillCategory) ?? { earned: 0, max: 0 };
    totals.earned += earned;
    totals.max += points;
    skillTotals.set(q.skillCategory, totals);
    scored.push({
      questionId: q.id,
      responseData: response,
      isCorrect,
      earnedPoints: earned,
      maxPoints: points,
    });
  }

  const rawScore = roundTo(raw, 2);
  const maxScore = roundTo(max, 2);
  const skills = collectSkills(skillTotals);

  return {
    rawScore,
    maxScore,
    percentageScore: maxScore > 0 ? roundTo((100 * rawScore) / maxScore, 2) : 0,
    selfReportedConfidence: likertValues.length
      ? roundTo(likertValues.reduce((a, b) => a + b, 0) / likertValues.length, 2)
      : null,
    answeredCount: answered,
    responses: scored,
    skills,
  };
}

function collectSkills(
  totals: Map<SkillCategory, { earned: number; max: number }>,
): ScoringResult['skills'] {
  const out: ScoringResult['skills'] = [];
  for (const skillCategory of SKILL_CATEGORIES) {
    const t = totals.get(skillCategory);
    if (!t || t.max <= 0) continue;
    out.push({ skillCategory, earnedPoints: roundTo(t.earned, 2), maxPoints: roundTo(t.max, 2) });
  }
  return out;
}
