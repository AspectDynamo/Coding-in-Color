/**
 * Small-cell suppression for external outputs (CSV, print, AI, instructor aggregates).
 *
 * Rule (consistent everywhere): a group with matched n < `suppressionThreshold` has all of its
 * OUTCOME values removed — averages, changes, percentages, CI, effect size, counts of
 * improved/unchanged/declined (zeroed, because the contract type is not nullable). Group SIZES
 * (enrolled, completions, n, matched) are retained so a reader can see how small the group is; they
 * describe participation, not outcomes. The marker for a suppressed group is `n < suppressionThreshold`
 * (and `suppressed: true` on skill/cohort rows). Distributions are emptied when overall n < threshold.
 * Trend rows keep participation counts but null their change when matched < threshold.
 *
 * Idempotent; never mutates its input. Not a legal de-identification guarantee, and it does not
 * apply complementary suppression across rows.
 */
import type {
  CohortComparisonRow,
  ImpactDashboard,
  ImpactMetrics,
  SkillImpact,
} from '../../shared/api';

function suppressMetrics(m: ImpactMetrics, threshold: number): ImpactMetrics {
  const out: ImpactMetrics = structuredClone(m);
  if (m.n < threshold) {
    out.averagePre = null;
    out.averagePost = null;
    out.averageChangePoints = null;
    out.relativeChangePercent = null;
    out.relativeChangeUndefined = false;
    out.improvedPercent = null;
    out.unchangedPercent = null;
    out.declinedPercent = null;
    out.improvedCount = 0;
    out.unchangedCount = 0;
    out.declinedCount = 0;
    out.changeCi95 = null;
    out.effectSizeDz = null;
  }
  if (out.confidence && out.confidence.n < threshold) {
    out.confidence = { n: out.confidence.n, averagePre: null, averagePost: null };
  }
  if (out.retention && out.retention.n < threshold) {
    out.retention = { n: out.retention.n, averagePost: null, averageRetention: null };
  }
  return out;
}

export function suppressForExternal(d: ImpactDashboard): ImpactDashboard {
  const t = d.suppressionThreshold;
  const metrics = suppressMetrics(d.metrics, t);

  const skills: SkillImpact[] = d.skills.map((s) =>
    s.n < t
      ? {
          skill: s.skill,
          n: s.n,
          averagePre: null,
          averagePost: null,
          averageChangePoints: null,
          suppressed: true,
        }
      : { ...s },
  );

  const cohorts: CohortComparisonRow[] = d.cohorts.map((c) =>
    c.matched < t
      ? {
          ...c,
          averagePre: null,
          averagePost: null,
          averageChangePoints: null,
          improvedPercent: null,
          suppressed: true,
        }
      : { ...c },
  );

  const distributionsHidden = d.metrics.n < t;

  return {
    ...structuredClone({
      filters: d.filters,
      assessmentPeriod: d.assessmentPeriod,
      kpis: d.kpis,
      limitations: d.limitations,
      recentActivity: d.recentActivity, // participation counts only; retained like enrolled/completions
    }),
    generatedAt: d.generatedAt,
    isSyntheticData: d.isSyntheticData,
    suppressionThreshold: t,
    metrics: { ...metrics, suppressed: d.metrics.n < t },
    externalView: true,
    skills,
    scoreDistribution: distributionsHidden ? [] : structuredClone(d.scoreDistribution),
    changeDistribution: distributionsHidden ? [] : structuredClone(d.changeDistribution),
    cohorts,
    trend: d.trend.map((p) => (p.matched < t ? { ...p, averageChangePoints: null } : { ...p })),
  };
}
