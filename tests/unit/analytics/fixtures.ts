import type { DashboardInput } from '../../../src/backend/analytics';
import type { MatchedPairRow } from '../../../src/shared/db';

let counter = 0;
export function pair(
  pre: number,
  post: number,
  over: Partial<MatchedPairRow> = {},
): MatchedPairRow {
  counter += 1;
  return {
    student_id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    cohort_id: 'c1',
    program_id: 'p1',
    course_id: 'k1',
    form_family: 'fam',
    pre_attempt_id: `a-${counter}-pre`,
    post_attempt_id: `a-${counter}-post`,
    pre_percentage: pre,
    post_percentage: post,
    pre_submitted_at: '2026-02-01T10:00:00Z',
    post_submitted_at: '2026-03-15T10:00:00Z',
    pre_confidence: null,
    post_confidence: null,
    retention_attempt_id: null,
    retention_percentage: null,
    pre_skills: {},
    post_skills: {},
    ...over,
  };
}

/** Build n pairs with the given diffs (pre fixed at 50). */
export function pairsFromDiffs(
  diffs: number[],
  over: Partial<MatchedPairRow> = {},
): MatchedPairRow[] {
  return diffs.map((d) => pair(50, 50 + d, over));
}

export function dashboardInput(over: Partial<DashboardInput> = {}): DashboardInput {
  const pairs = over.pairs ?? [
    ...pairsFromDiffs([10, 20, 30, 24, 16, 22, 18, 26, 14, 20, 12, 28], {
      pre_skills: { loops: 40, variables: 50 },
      post_skills: { loops: 60, variables: 80 },
      pre_confidence: 2,
      post_confidence: 4,
    }),
  ];
  return {
    filters: {},
    pairs,
    attempts: [
      ...pairs.map(() => ({
        stage: 'PRE' as const,
        cohort_id: 'c1',
        submitted_at: '2026-02-01T10:00:00Z',
      })),
      ...pairs.map(() => ({
        stage: 'POST' as const,
        cohort_id: 'c1',
        submitted_at: '2026-03-15T10:00:00Z',
      })),
      { stage: 'PRE', cohort_id: 'c1', submitted_at: '2026-02-02T10:00:00Z' },
      { stage: 'PRE', cohort_id: 'c1', submitted_at: '2026-02-02T10:00:00Z' },
    ],
    cohorts: [
      {
        id: 'c1',
        name: 'Spring cohort',
        programName: 'AI Academy',
        courseName: 'Intro to AI',
        enrolled: 16,
      },
    ],
    totalStudentRecords: 20,
    recentActivity: [],
    suppressionThreshold: 10,
    isSyntheticData: true,
    generatedAt: '2026-11-21T12:00:00.000Z',
    ...over,
  };
}
