/** Assembles the admin ImpactDashboard from already-scoped matched pairs, attempts and cohorts. */
import type {
  CohortComparisonRow,
  ImpactDashboard,
  ImpactKpis,
  RecentActivityItem,
  TrendPoint,
} from '../../shared/api';
import { STANDARD_LIMITATIONS } from '../../shared/constants';
import type { MatchedPairRow } from '../../shared/db';
import { SKILL_LABELS, type AssessmentStage } from '../../shared/types';
import type { DashboardFilters } from '../../shared/validation';
import { roundTo } from '../scoring/round';
import {
  changeDistribution,
  computeImpactMetrics,
  computeSkillImpacts,
  pairValues,
  scoreDistribution,
} from './metrics';
import { mean } from './stats';

export interface DashboardInput {
  filters: DashboardFilters;
  /** Already restricted to cohorts in scope and the date range. */
  pairs: MatchedPairRow[];
  /** Submitted, non-PRACTICE attempts in scope. */
  attempts: { stage: AssessmentStage; cohort_id: string; submitted_at: string }[];
  cohorts: {
    id: string;
    name: string;
    programName: string;
    courseName: string;
    enrolled: number;
  }[];
  totalStudentRecords: number;
  /** Participation counts only, newest first, at most 6 (built by the store). */
  recentActivity: RecentActivityItem[];
  suppressionThreshold: number;
  isSyntheticData: boolean;
  generatedAt: string;
}

const r1 = (x: number) => roundTo(x, 1);

function isoDate(s: string): string | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function isoMonth(s: string): string | null {
  const d = isoDate(s);
  return d ? d.slice(0, 7) : null;
}

export const MATCH_RATE_WARNING_PERCENT = 60;

export function buildImpactDashboard(input: DashboardInput): ImpactDashboard {
  const { filters, pairs, attempts, cohorts, suppressionThreshold } = input;
  const skill = filters.skill;
  const stageCounts = (stage: AssessmentStage) =>
    filters.stage && filters.stage !== stage ? 0 : attempts.filter((a) => a.stage === stage).length;

  const metrics = computeImpactMetrics(pairs, { skill });
  const enrolled = cohorts.reduce((s, c) => s + c.enrolled, 0);
  const pre = stageCounts('PRE');
  const post = stageCounts('POST');
  const retention = stageCounts('RETENTION');
  const matchedPairs = pairs.length;

  // Rates are null when not measurable (denominator 0, or the stage filter hides the numerator).
  // Match rate is clamped to 100: with a date filter, a pair's PRE can fall outside the window.
  const completionRate =
    enrolled > 0 && (!filters.stage || filters.stage === 'POST')
      ? r1(Math.min(100, (post / enrolled) * 100))
      : null;
  const matchRate = pre > 0 ? r1(Math.min(100, (matchedPairs / pre) * 100)) : null;

  const kpis: ImpactKpis = {
    totalStudentRecords: input.totalStudentRecords,
    enrolledStudents: enrolled,
    preCompletions: pre,
    postCompletions: post,
    retentionCompletions: retention,
    matchedPairs,
    completionRate,
    matchRate,
  };

  // Cohort comparison rows.
  const cohortRows: CohortComparisonRow[] = cohorts.map((c) => {
    const m = computeImpactMetrics(
      pairs.filter((p) => p.cohort_id === c.id),
      { skill },
    );
    return {
      cohortId: c.id,
      cohortName: c.name,
      programName: c.programName,
      courseName: c.courseName,
      enrolled: c.enrolled,
      matched: m.n,
      averagePre: m.averagePre,
      averagePost: m.averagePost,
      averageChangePoints: m.averageChangePoints,
      improvedPercent: m.improvedPercent,
      suppressed: m.n < suppressionThreshold,
    };
  });

  // Monthly trend: completions by attempt month; change by the month of the POST attempt.
  const months = new Map<string, TrendPoint>();
  const point = (period: string): TrendPoint => {
    let p = months.get(period);
    if (!p) {
      p = { period, preCompletions: 0, postCompletions: 0, averageChangePoints: null, matched: 0 };
      months.set(period, p);
    }
    return p;
  };
  for (const a of attempts) {
    if (a.stage !== 'PRE' && a.stage !== 'POST') continue;
    if (filters.stage && filters.stage !== a.stage) continue;
    const period = isoMonth(a.submitted_at);
    if (!period) continue;
    const p = point(period);
    if (a.stage === 'PRE') p.preCompletions += 1;
    else p.postCompletions += 1;
  }
  const changesByMonth = new Map<string, number[]>();
  for (const v of pairValues(pairs, skill)) {
    const period = isoMonth(v.pair.post_submitted_at);
    if (!period) continue;
    point(period);
    const list = changesByMonth.get(period) ?? [];
    list.push(v.post - v.pre);
    changesByMonth.set(period, list);
  }
  for (const [period, diffs] of changesByMonth) {
    const p = point(period);
    p.matched = diffs.length;
    p.averageChangePoints = r1(mean(diffs));
  }
  const trend = [...months.values()].sort((a, b) => a.period.localeCompare(b.period));

  // Assessment period: min/max POST submission date among matched pairs.
  const postDates = pairs
    .map((p) => isoDate(p.post_submitted_at))
    .filter((d): d is string => d !== null)
    .sort();
  const assessmentPeriod = {
    from: postDates[0] ?? null,
    to: postDates[postDates.length - 1] ?? null,
  };

  // Limitations.
  const limitations: string[] = [...STANDARD_LIMITATIONS];
  if (metrics.n === 0) {
    limitations.push(
      'No matched pre/post pairs are available for this selection, so no improvement metrics can be reported.',
    );
  } else if (metrics.n < suppressionThreshold) {
    limitations.push(
      `Sample too small for reliable conclusions: only ${metrics.n} matched ${metrics.n === 1 ? 'student' : 'students'} (reporting threshold is ${suppressionThreshold}).`,
    );
  }
  if (matchRate !== null && matchRate < MATCH_RATE_WARNING_PERCENT) {
    limitations.push(
      `Only ${matchRate}% of students who completed a pre-assessment have a matched post-assessment; attrition may mean results do not represent the whole group.`,
    );
  }
  if (skill) {
    limitations.push(
      `Scores shown are for the skill "${SKILL_LABELS[skill]}" only; students without that skill on both forms are excluded, so n may be smaller than the overall matched count.`,
    );
  }
  if (input.isSyntheticData) {
    limitations.push(
      'These results use synthetic demonstration data and do not describe real students.',
    );
  }

  return {
    filters,
    generatedAt: input.generatedAt,
    isSyntheticData: input.isSyntheticData,
    assessmentPeriod,
    suppressionThreshold,
    kpis,
    metrics,
    skills: computeSkillImpacts(pairs, suppressionThreshold),
    scoreDistribution: scoreDistribution(pairs, { skill }),
    changeDistribution: changeDistribution(pairs, { skill }),
    cohorts: cohortRows,
    trend,
    limitations,
    recentActivity: input.recentActivity.slice(0, 6),
  };
}
