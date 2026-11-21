import { describe, expect, it } from 'vitest';
import { buildImpactDashboard, suppressForExternal } from '../../../src/backend/analytics';
import { STANDARD_LIMITATIONS } from '../../../src/shared/constants';
import { dashboardInput, pair, pairsFromDiffs } from './fixtures';

describe('buildImpactDashboard', () => {
  it('fills kpis, metrics, period, cohorts and trend', () => {
    const d = buildImpactDashboard(dashboardInput());
    expect(d.kpis).toMatchObject({
      totalStudentRecords: 20,
      enrolledStudents: 16,
      preCompletions: 14,
      postCompletions: 12,
      retentionCompletions: 0,
      matchedPairs: 12,
      completionRate: 75,
      matchRate: 85.7,
    });
    expect(d.metrics.n).toBe(12);
    expect(d.metrics.averageChangePoints).toBe(20);
    expect(d.assessmentPeriod).toEqual({ from: '2026-03-15', to: '2026-03-15' });
    expect(d.cohorts).toEqual([
      expect.objectContaining({
        cohortId: 'c1',
        matched: 12,
        enrolled: 16,
        averageChangePoints: 20,
        suppressed: false,
      }),
    ]);
    expect(d.trend).toEqual([
      {
        period: '2026-02',
        preCompletions: 14,
        postCompletions: 0,
        averageChangePoints: null,
        matched: 0,
      },
      {
        period: '2026-03',
        preCompletions: 0,
        postCompletions: 12,
        averageChangePoints: 20,
        matched: 12,
      },
    ]);
    expect(d.skills.map((s) => s.skill)).toEqual(['variables', 'loops']);
    expect(d.scoreDistribution).toHaveLength(5);
    expect(d.changeDistribution).toHaveLength(6);
    expect(d.generatedAt).toBe('2026-11-21T12:00:00.000Z');
  });

  it('stage filter zeroes counts for other stages', () => {
    const d = buildImpactDashboard(dashboardInput({ filters: { stage: 'POST' } }));
    expect(d.kpis.preCompletions).toBe(0);
    expect(d.kpis.postCompletions).toBe(12);
    expect(d.kpis.retentionCompletions).toBe(0);
    expect(d.kpis.matchRate).toBeNull();
    expect(d.trend.every((t) => t.preCompletions === 0)).toBe(true);
    const pre = buildImpactDashboard(dashboardInput({ filters: { stage: 'PRE' } }));
    expect(pre.kpis.postCompletions).toBe(0);
    expect(pre.kpis.completionRate).toBeNull();
    expect(pre.kpis.preCompletions).toBe(14);
  });

  it('rates are null with no enrolment / no pre completions', () => {
    const d = buildImpactDashboard(dashboardInput({ pairs: [], attempts: [], cohorts: [] }));
    expect(d.kpis.completionRate).toBeNull();
    expect(d.kpis.matchRate).toBeNull();
    expect(d.metrics.n).toBe(0);
    expect(d.assessmentPeriod).toEqual({ from: null, to: null });
    expect(d.trend).toEqual([]);
    expect(d.limitations.join(' ')).toMatch(/No matched pre\/post pairs/);
  });

  it('adds dynamic limitations', () => {
    const small = buildImpactDashboard(dashboardInput({ pairs: pairsFromDiffs([10, 20, 30]) }));
    expect(small.limitations.slice(0, STANDARD_LIMITATIONS.length)).toEqual([
      ...STANDARD_LIMITATIONS,
    ]);
    expect(
      small.limitations.some((l) => l.startsWith('Sample too small for reliable conclusions')),
    ).toBe(true);

    const lowMatch = buildImpactDashboard(
      dashboardInput({
        attempts: Array.from({ length: 30 }, () => ({
          stage: 'PRE' as const,
          cohort_id: 'c1',
          submitted_at: '2026-02-01T00:00:00Z',
        })),
      }),
    );
    expect(lowMatch.kpis.matchRate).toBe(40);
    expect(lowMatch.limitations.some((l) => /attrition/.test(l))).toBe(true);

    const skill = buildImpactDashboard(dashboardInput({ filters: { skill: 'loops' } }));
    expect(skill.limitations.some((l) => l.includes('Loops'))).toBe(true);

    const ok = buildImpactDashboard(dashboardInput({ isSyntheticData: false }));
    expect(ok.limitations).toHaveLength(STANDARD_LIMITATIONS.length);
    expect(
      buildImpactDashboard(dashboardInput()).limitations.some((l) => /synthetic/i.test(l)),
    ).toBe(true);
  });

  it('skill filter drives headline metrics, cohort rows and trend', () => {
    const d = buildImpactDashboard(dashboardInput({ filters: { skill: 'loops' } }));
    expect(d.metrics.averagePre).toBe(40);
    expect(d.metrics.averagePost).toBe(60);
    expect(d.cohorts[0]!.averageChangePoints).toBe(20);
    expect(d.kpis.matchedPairs).toBe(12);
    const none = buildImpactDashboard(dashboardInput({ filters: { skill: 'debugging' } }));
    expect(none.metrics.n).toBe(0);
    expect(none.cohorts[0]!.suppressed).toBe(true);
  });

  it('cohort suppressed flag keeps internal values', () => {
    const pairs = [
      ...pairsFromDiffs([10, 20, 30], { cohort_id: 'small' }),
      ...pairsFromDiffs(Array(10).fill(5), { cohort_id: 'big' }),
    ];
    const d = buildImpactDashboard(
      dashboardInput({
        pairs,
        cohorts: [
          { id: 'small', name: 'Small', programName: 'P', courseName: 'C', enrolled: 5 },
          { id: 'big', name: 'Big', programName: 'P', courseName: 'C', enrolled: 12 },
        ],
      }),
    );
    expect(d.cohorts[0]).toMatchObject({
      cohortName: 'Small',
      matched: 3,
      suppressed: true,
      averageChangePoints: 20,
    });
    expect(d.cohorts[1]).toMatchObject({
      cohortName: 'Big',
      matched: 10,
      suppressed: false,
      averageChangePoints: 5,
    });
  });

  it('assessment period spans min/max post dates; trend splits by post month', () => {
    const pairs = [
      pair(50, 60, { post_submitted_at: '2026-01-31T23:00:00Z' }),
      pair(50, 80, { post_submitted_at: '2026-04-02T01:00:00Z' }),
      pair(50, 70, { post_submitted_at: '2026-04-20T01:00:00Z' }),
    ];
    const d = buildImpactDashboard(dashboardInput({ pairs, attempts: [] }));
    expect(d.assessmentPeriod).toEqual({ from: '2026-01-31', to: '2026-04-20' });
    expect(d.trend).toEqual([
      {
        period: '2026-01',
        preCompletions: 0,
        postCompletions: 0,
        averageChangePoints: 10,
        matched: 1,
      },
      {
        period: '2026-04',
        preCompletions: 0,
        postCompletions: 0,
        averageChangePoints: 25,
        matched: 2,
      },
    ]);
  });
});

describe('suppressForExternal', () => {
  const dashboardWith = (n: number) =>
    buildImpactDashboard(
      dashboardInput({
        pairs: pairsFromDiffs(Array(n).fill(10), {
          pre_skills: { loops: 40 },
          post_skills: { loops: 60 },
          pre_confidence: 2,
          post_confidence: 3,
          retention_attempt_id: 'r',
          retention_percentage: 55,
        }),
        cohorts: [{ id: 'c1', name: 'Only', programName: 'P', courseName: 'C', enrolled: 30 }],
      }),
    );

  it('n = 10 is shown; n = 9 is suppressed', () => {
    const ok = suppressForExternal(dashboardWith(10));
    expect(ok.metrics.averageChangePoints).toBe(10);
    expect(ok.skills[0]!.suppressed).toBe(false);
    expect(ok.skills[0]!.averageChangePoints).toBe(20);
    expect(ok.cohorts[0]!.suppressed).toBe(false);
    expect(ok.scoreDistribution).toHaveLength(5);
    expect(ok.metrics.confidence).toEqual({ n: 10, averagePre: 2, averagePost: 3 });
    expect(ok.metrics.retention!.averageRetention).toBe(55);

    const s = suppressForExternal(dashboardWith(9));
    expect(s.metrics.n).toBe(9);
    expect(s.metrics).toMatchObject({
      averagePre: null,
      averagePost: null,
      averageChangePoints: null,
      relativeChangePercent: null,
      relativeChangeUndefined: false,
      improvedPercent: null,
      unchangedPercent: null,
      declinedPercent: null,
      changeCi95: null,
      effectSizeDz: null,
      improvedCount: 0,
      declinedCount: 0,
    });
    expect(s.metrics.confidence).toEqual({ n: 9, averagePre: null, averagePost: null });
    expect(s.metrics.retention).toEqual({ n: 9, averagePost: null, averageRetention: null });
    expect(s.skills[0]).toMatchObject({
      n: 9,
      suppressed: true,
      averagePre: null,
      averagePost: null,
      averageChangePoints: null,
    });
    expect(s.cohorts[0]).toMatchObject({
      matched: 9,
      suppressed: true,
      averagePre: null,
      averageChangePoints: null,
      improvedPercent: null,
    });
    expect(s.scoreDistribution).toEqual([]);
    expect(s.changeDistribution).toEqual([]);
    expect(s.trend.every((t) => t.averageChangePoints === null)).toBe(true);
    expect(s.kpis.matchedPairs).toBe(9);
  });

  it('is idempotent and does not mutate its input', () => {
    const d = dashboardWith(9);
    const before = JSON.parse(JSON.stringify(d));
    const once = suppressForExternal(d);
    expect(d).toEqual(before);
    expect(once).not.toBe(d);
    expect(once.metrics).not.toBe(d.metrics);
    expect(once.kpis).not.toBe(d.kpis);
    expect(suppressForExternal(once)).toEqual(once);
    expect(d.metrics.averageChangePoints).toBe(10); // original still has values
  });

  it('suppresses individual skills and cohorts independently', () => {
    const pairs = [
      ...pairsFromDiffs(Array(12).fill(10), {
        pre_skills: { loops: 40 },
        post_skills: { loops: 60 },
      }),
      ...pairsFromDiffs(Array(4).fill(10), {
        pre_skills: { loops: 40, debugging: 10 },
        post_skills: { loops: 60, debugging: 30 },
      }),
    ];
    const d = suppressForExternal(buildImpactDashboard(dashboardInput({ pairs })));
    expect(d.skills.find((s) => s.skill === 'loops')).toMatchObject({ n: 16, suppressed: false });
    expect(d.skills.find((s) => s.skill === 'debugging')).toMatchObject({
      n: 4,
      suppressed: true,
      averageChangePoints: null,
    });
    expect(d.metrics.n).toBe(16);
  });
});
