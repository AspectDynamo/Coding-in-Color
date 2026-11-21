/**
 * Small LOCAL scorer used only by the synthetic demo generator, so the generated attempts,
 * responses and skill scores are internally consistent. It implements the single scoring
 * convention documented in src/shared/constants.ts. Production scoring lives in
 * src/backend/scoring/ and is intentionally NOT imported here.
 */
import type { QuestionType, SkillCategory } from '../../shared/types';

export type DemoResponse =
  | { kind: 'single'; optionId: string }
  | { kind: 'multi'; optionIds: string[] }
  | { kind: 'line'; line: number }
  | { kind: 'order'; itemIds: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'likert'; value: number }
  | { kind: 'skipped' };

export interface ScorableQuestion {
  id: string;
  type: QuestionType;
  skill: SkillCategory;
  points: number;
  key: Record<string, unknown> | null;
}

export interface ScoredResponse {
  question_id: string;
  response_data: DemoResponse;
  is_correct: boolean | null;
  earned_points: number;
  max_points: number;
}

export interface ScoredAttempt {
  raw: number;
  max: number;
  percentage: number;
  confidence: number | null;
  responses: ScoredResponse[];
  skills: { skill_category: SkillCategory; earned_points: number; max_points: number }[];
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const AUTO = new Set<QuestionType>([
  'multiple_choice',
  'multiple_select',
  'code_comprehension',
  'predict_output',
  'debugging',
  'ordering',
  'short_logic',
]);

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function earnedFor(q: ScorableQuestion, r: DemoResponse): number {
  const key = q.key ?? {};
  switch (q.type) {
    case 'multiple_choice':
    case 'code_comprehension':
    case 'predict_output':
      return r.kind === 'single' && r.optionId === key['correctOptionId'] ? q.points : 0;
    case 'multiple_select': {
      if (r.kind !== 'multi') return 0;
      const correct = key['correctOptionIds'] as string[];
      const picked = new Set(r.optionIds);
      let good = 0;
      let bad = 0;
      for (const id of picked) {
        if (correct.includes(id)) good += 1;
        else bad += 1;
      }
      return round2(q.points * Math.max(0, (good - bad) / correct.length));
    }
    case 'debugging':
      return r.kind === 'line' && r.line === key['bugLine'] ? q.points : 0;
    case 'ordering': {
      if (r.kind !== 'order') return 0;
      const correct = key['correctOrder'] as string[];
      return r.itemIds.length === correct.length && r.itemIds.every((id, i) => id === correct[i])
        ? q.points
        : 0;
    }
    case 'short_logic': {
      if (r.kind !== 'text') return 0;
      const accepted = (key['acceptedAnswers'] as string[]).map(norm);
      return accepted.includes(norm(r.text)) ? q.points : 0;
    }
    default:
      return 0;
  }
}

/** Score one complete set of responses (one per question; skipped items must be explicit). */
export function scoreAttempt(
  questions: ScorableQuestion[],
  answers: Map<string, DemoResponse>,
): ScoredAttempt {
  const responses: ScoredResponse[] = [];
  const skillTotals = new Map<SkillCategory, { earned: number; max: number }>();
  const likert: number[] = [];
  let raw = 0;
  let max = 0;

  for (const q of questions) {
    const r: DemoResponse = answers.get(q.id) ?? { kind: 'skipped' };
    if (q.type === 'confidence_likert') {
      if (r.kind === 'likert') likert.push(r.value);
      responses.push({
        question_id: q.id,
        response_data: r,
        is_correct: null,
        earned_points: 0,
        max_points: 0,
      });
      continue;
    }
    if (!AUTO.has(q.type)) continue; // project_rubric is never part of an assessment score
    const earned = r.kind === 'skipped' ? 0 : earnedFor(q, r);
    raw += earned;
    max += q.points;
    const t = skillTotals.get(q.skill) ?? { earned: 0, max: 0 };
    t.earned += earned;
    t.max += q.points;
    skillTotals.set(q.skill, t);
    responses.push({
      question_id: q.id,
      response_data: r,
      is_correct: earned === q.points,
      earned_points: earned,
      max_points: q.points,
    });
  }

  raw = round2(raw);
  max = round2(max);
  return {
    raw,
    max,
    percentage: max > 0 ? round2((100 * raw) / max) : 0,
    confidence: likert.length ? round2(likert.reduce((a, b) => a + b, 0) / likert.length) : null,
    responses,
    skills: [...skillTotals.entries()].map(([skill_category, t]) => ({
      skill_category,
      earned_points: round2(t.earned),
      max_points: round2(t.max),
    })),
  };
}
