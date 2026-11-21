import type { QuestionType, SkillCategory } from '../../shared/types';
import type { ResponseValue } from '../../shared/validation';

export interface ScoringQuestion {
  id: string;
  type: QuestionType;
  points: number;
  skillCategory: SkillCategory;
  config: Record<string, unknown>;
  answerKey: Record<string, unknown> | null;
}

export interface ScoringInput {
  questions: ScoringQuestion[];
  responses: { questionId: string; response: ResponseValue }[];
}

export interface ScoredResponse {
  questionId: string;
  responseData: ResponseValue;
  /** null for likert. For auto-scored items that were skipped/unanswered this is false. */
  isCorrect: boolean | null;
  earnedPoints: number;
  maxPoints: number;
}

export interface ScoringResult {
  rawScore: number;
  maxScore: number;
  /** round(100 * raw / max, 2); 0 when max is 0 */
  percentageScore: number;
  /** mean of answered likert items (1..5), 2 dp; null when none answered */
  selfReportedConfidence: number | null;
  /** questions (excluding project_rubric) with a non-empty, non-skipped response */
  answeredCount: number;
  /** one entry per scored question (project_rubric excluded), in question order */
  responses: ScoredResponse[];
  /** auto-scored items only; skills with zero max points are omitted; SKILL_CATEGORIES order */
  skills: { skillCategory: SkillCategory; earnedPoints: number; maxPoints: number }[];
}
