import { describe, expect, it } from 'vitest';
import {
  changeBucket,
  changeDistribution,
  computeImpactMetrics,
  computeSkillImpacts,
  scoreBucket,
  scoreDistribution,
  tCritical95,
} from '../../../src/backend/analytics';
import { pair, pairsFromDiffs } from './fixtures';

describe('tCritical95', () => {
  it('matches the table and interpolates beyond 30', () => {
    expect(tCritical95(1)).toBe(12.706);
    expect(tCritical95(4)).toBe(2.776);
    expect(tCritical95(30)).toBe(2.042);
    expect(tCritical95(40)).toBeCloseTo(2.021, 6);
    expect(tCritical95(60)).toBeCloseTo(2.0, 6);
    expect(tCritical95(120)).toBeCloseTo(1.98, 6);
    expect(tCritical95(100000)).toBeCloseTo(1.96, 2);
    expect(tCritical95(Infinity)).toBe(1.96);
    const t35 = tCritical95(35);
    expect(t35).toBeLessThan(2.042);
    expect(t35).toBeGreaterThan(2.021);
    const t90 = tCritical95(90);
    expect(t90).toBeLessThan(2.0);
    expect(t90).toBeGreaterThan(1.98);
    expect(tCritical95(200)).toBeLessThan(1.98);
    expect(tCritical95(200)).toBeGreaterThan(1.96);
  });
});

describe('computeImpactMetrics', () => {
  it('spec example: 52 -> 76 is +24 points and +46.2 percent', () => {
    const m = computeImpactMetrics([pair(52, 76)]);
    expect(m).toMatchObject({
      n: 1,
      averagePre: 52,
      averagePost: 76,
      averageChangePoints: 24,
      relativeChangePercent: 46.2,
      relativeChangeUndefined: false,
      improvedPercent: 100,
      improvedCount: 1,
      changeCi95: null,
      effectSizeDz: null,
    });
  });

  it('n = 0 returns nulls and no undefined flag', () => {
    const m = computeImpactMetrics([]);
    expect(m.n).toBe(0);
    expect(m.averagePre).toBeNull();
    expect(m.averageChangePoints).toBeNull();
    expect(m.relativeChangePercent).toBeNull();
    expect(m.relativeChangeUndefined).toBe(false);
    expect(m.improvedPercent).toBeNull();
    expect(m.changeCi95).toBeNull();
    expect(m.confidence).toBeNull();
    expect(m.retention).toBeNull();
    expect([m.improvedCount, m.unchangedCount, m.declinedCount]).toEqual([0, 0, 0]);
  });

  it('zero baseline gives undefined relative change', () => {
    const m = computeImpactMetrics([pair(0, 10), pair(0, 30)]);
    expect(m.averagePre).toBe(0);
    expect(m.averageChangePoints).toBe(20);
    expect(m.relativeChangePercent).toBeNull();
    expect(m.relativeChangeUndefined).toBe(true);
  });

  it('counts improved / unchanged / declined using 2-dp comparison', () => {
    const m = computeImpactMetrics([
      pair(50, 60),
      pair(50, 50),
      pair(50, 50.004),
      pair(50, 40),
      pair(70.33, 70.34),
      pair(60, 59.99),
    ]);
    expect(m.improvedCount).toBe(2); // +10 and +0.01
    expect(m.unchangedCount).toBe(2); // 0 and +0.004
    expect(m.declinedCount).toBe(2);
    expect(m.improvedPercent).toBe(33.3);
    expect(m.unchangedPercent).toBe(33.3);
    expect(m.declinedPercent).toBe(33.3);
  });

  it('known dataset: CI and d_z', () => {
    // diffs 2,4,6,8,10: mean 6, sd sqrt(10), se sqrt(2), t(4)=2.776 -> 6 +/- 3.926; dz = 6/3.1623 = 1.897
    const m = computeImpactMetrics(pairsFromDiffs([2, 4, 6, 8, 10]));
    expect(m.averageChangePoints).toBe(6);
    expect(m.changeCi95).toEqual({ low: 2.1, high: 9.9 });
    expect(m.effectSizeDz).toBe(1.9);
  });

  it('n = 2 uses t(1)', () => {
    // diffs 10, 20: mean 15, sd 7.0711, se 5, t=12.706 -> +/- 63.53
    const m = computeImpactMetrics(pairsFromDiffs([10, 20]));
    expect(m.changeCi95).toEqual({ low: -48.5, high: 78.5 });
    expect(m.effectSizeDz).toBe(2.1);
  });

  it('sd = 0 gives null effect size and a degenerate CI', () => {
    const m = computeImpactMetrics(pairsFromDiffs([10, 10, 10, 10]));
    expect(m.effectSizeDz).toBeNull();
    expect(m.changeCi95).toEqual({ low: 10, high: 10 });
  });

  it('computes on unrounded values and rounds only the output', () => {
    const m = computeImpactMetrics([pair(33.33, 66.67), pair(10.01, 20.02), pair(0.33, 0.66)]);
    // mean pre = 14.5567, mean post = 29.1167, change = 14.56
    expect(m.averagePre).toBe(14.6);
    expect(m.averagePost).toBe(29.1);
    expect(m.averageChangePoints).toBe(14.6);
    expect(m.relativeChangePercent).toBe(100.0);
  });

  it('confidence block uses pairs with both confidences; retention block uses pairs with retention', () => {
    const m = computeImpactMetrics([
      pair(50, 70, {
        pre_confidence: 2,
        post_confidence: 4,
        retention_attempt_id: 'r',
        retention_percentage: 60,
      }),
      pair(50, 80, { pre_confidence: 3, post_confidence: 5 }),
      pair(50, 90, { pre_confidence: null, post_confidence: 5 }),
      pair(40, 60, { retention_attempt_id: 'r2', retention_percentage: 50 }),
    ]);
    expect(m.confidence).toEqual({ n: 2, averagePre: 2.5, averagePost: 4.5 });
    expect(m.retention).toEqual({ n: 2, averagePost: 65, averageRetention: 55 });
  });

  it('skill filter uses skill sub-scores and excludes pairs missing the skill on either side', () => {
    const pairs = [
      pair(50, 60, { pre_skills: { loops: 20 }, post_skills: { loops: 60 } }),
      pair(50, 60, { pre_skills: { loops: 40 }, post_skills: { loops: 80 } }),
      pair(50, 60, { pre_skills: { loops: 40 }, post_skills: {} }),
      pair(50, 60, { pre_skills: {}, post_skills: { loops: 40 } }),
      pair(50, 60, { pre_skills: { variables: 10 }, post_skills: { variables: 20 } }),
    ];
    const m = computeImpactMetrics(pairs, { skill: 'loops' });
    expect(m.n).toBe(2);
    expect(m.averagePre).toBe(30);
    expect(m.averagePost).toBe(70);
    expect(m.averageChangePoints).toBe(40);
    expect(computeImpactMetrics(pairs, { skill: 'debugging' }).n).toBe(0);
    expect(computeImpactMetrics(pairs).n).toBe(5);
  });
});

describe('computeSkillImpacts', () => {
  it('returns every skill in SKILL_CATEGORIES order with suppression flags', () => {
    const pairs = [
      ...Array.from({ length: 3 }, () =>
        pair(50, 60, {
          pre_skills: { loops: 40, variables: 50 },
          post_skills: { loops: 60, variables: 70 },
        }),
      ),
      pair(50, 60, { pre_skills: { debugging: 0 }, post_skills: { debugging: 100 } }),
    ];
    const rows = computeSkillImpacts(pairs, 3);
    expect(rows.map((r) => r.skill)).toEqual(['variables', 'loops', 'debugging']);
    expect(rows[0]).toEqual({
      skill: 'variables',
      n: 3,
      averagePre: 50,
      averagePost: 70,
      averageChangePoints: 20,
      suppressed: false,
    });
    expect(rows[2]).toMatchObject({
      skill: 'debugging',
      n: 1,
      averageChangePoints: 100,
      suppressed: true,
    });
  });

  it('skill appearing on one side only has n 0 and null values', () => {
    const rows = computeSkillImpacts([pair(50, 60, { pre_skills: { logic: 10 } })], 10);
    expect(rows).toEqual([
      {
        skill: 'logic',
        n: 0,
        averagePre: null,
        averagePost: null,
        averageChangePoints: null,
        suppressed: true,
      },
    ]);
  });

  it('empty input gives no rows', () => {
    expect(computeSkillImpacts([], 10)).toEqual([]);
  });
});

describe('distributions', () => {
  it('score bucket edges', () => {
    expect(scoreBucket(0)).toBe('0-19');
    expect(scoreBucket(19.99)).toBe('0-19');
    expect(scoreBucket(20)).toBe('20-39');
    expect(scoreBucket(39.99)).toBe('20-39');
    expect(scoreBucket(40)).toBe('40-59');
    expect(scoreBucket(59.99)).toBe('40-59');
    expect(scoreBucket(60)).toBe('60-79');
    expect(scoreBucket(79.99)).toBe('60-79');
    expect(scoreBucket(80)).toBe('80-100');
    expect(scoreBucket(100)).toBe('80-100');
  });

  it('change bucket edges', () => {
    expect(changeBucket(-100)).toBe('≤ -20');
    expect(changeBucket(-20)).toBe('≤ -20');
    expect(changeBucket(-19.99)).toBe('-19 to -1');
    expect(changeBucket(-0.01)).toBe('-19 to -1');
    expect(changeBucket(0)).toBe('0');
    expect(changeBucket(0.004)).toBe('0');
    expect(changeBucket(0.01)).toBe('1 to 19');
    expect(changeBucket(19.99)).toBe('1 to 19');
    expect(changeBucket(20)).toBe('20 to 39');
    expect(changeBucket(39.99)).toBe('20 to 39');
    expect(changeBucket(40)).toBe('≥ 40');
    expect(changeBucket(100)).toBe('≥ 40');
  });

  it('scoreDistribution counts pre and post and keeps all buckets in order', () => {
    const d = scoreDistribution([pair(10, 85), pair(25, 60), pair(100, 100)]);
    expect(d).toEqual([
      { bucket: '0-19', pre: 1, post: 0 },
      { bucket: '20-39', pre: 1, post: 0 },
      { bucket: '40-59', pre: 0, post: 0 },
      { bucket: '60-79', pre: 0, post: 1 },
      { bucket: '80-100', pre: 1, post: 2 },
    ]);
  });

  it('changeDistribution counts every pair exactly once', () => {
    const pairs = pairsFromDiffs([-25, -5, 0, 5, 19.99, 20, 39.99, 40, 50]);
    const d = changeDistribution(pairs);
    expect(d.map((b) => [b.bucket, b.count])).toEqual([
      ['≤ -20', 1],
      ['-19 to -1', 1],
      ['0', 1],
      ['1 to 19', 2],
      ['20 to 39', 2],
      ['≥ 40', 2],
    ]);
  });

  it('distributions respect the skill option', () => {
    const pairs = [
      pair(50, 50, { pre_skills: { loops: 10 }, post_skills: { loops: 90 } }),
      pair(50, 50),
    ];
    expect(scoreDistribution(pairs, { skill: 'loops' })[0]).toEqual({
      bucket: '0-19',
      pre: 1,
      post: 0,
    });
    expect(
      changeDistribution(pairs, { skill: 'loops' }).find((b) => b.bucket === '≥ 40')!.count,
    ).toBe(1);
  });
});
