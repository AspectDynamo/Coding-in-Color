/**
 * Impact metrics from matched pre/post pairs (docs/architecture.md §6). Pure functions.
 * All statistics are computed on unrounded values and rounded to 1 dp only on output.
 */
import type {
  ChangeDistributionBucket,
  ImpactMetrics,
  ScoreDistributionBucket,
  SkillImpact,
} from '../../shared/api';
import { CHANGE_BUCKETS, SCORE_BUCKETS } from '../../shared/constants';
import type { MatchedPairRow } from '../../shared/db';
import { SKILL_CATEGORIES, type SkillCategory } from '../../shared/types';
import { roundTo } from '../scoring/round';
import { mean, sampleSd, tCritical95 } from './stats';

export interface MetricsOptions {
  /** Use this skill's sub-score for pre/post; pairs lacking it on either side are excluded. */
  skill?: SkillCategory;
}

export interface PairValue {
  pair: MatchedPairRow;
  pre: number;
  post: number;
}

/** Pairs with their pre/post values (overall percentages, or the skill's sub-score when `skill` is set). */
export function pairValues(pairs: MatchedPairRow[], skill?: SkillCategory): PairValue[] {
  const out: PairValue[] = [];
  for (const pair of pairs) {
    if (skill) {
      const pre = pair.pre_skills[skill];
      const post = pair.post_skills[skill];
      if (typeof pre !== 'number' || typeof post !== 'number') continue;
      out.push({ pair, pre, post });
    } else {
      out.push({ pair, pre: pair.pre_percentage, post: pair.post_percentage });
    }
  }
  return out;
}

const r1 = (x: number) => roundTo(x, 1);

/** Sign of a change compared at 2 decimal places: -1, 0 or 1. */
function changeSign(diff: number): -1 | 0 | 1 {
  const cents = Math.round(diff * 100);
  return cents > 0 ? 1 : cents < 0 ? -1 : 0;
}

function emptyMetrics(): ImpactMetrics {
  return {
    n: 0,
    averagePre: null,
    averagePost: null,
    averageChangePoints: null,
    relativeChangePercent: null,
    relativeChangeUndefined: false,
    improvedPercent: null,
    unchangedPercent: null,
    declinedPercent: null,
    improvedCount: 0,
    unchangedCount: 0,
    declinedCount: 0,
    changeCi95: null,
    effectSizeDz: null,
    confidence: null,
    retention: null,
  };
}

export function computeImpactMetrics(
  pairs: MatchedPairRow[],
  opts: MetricsOptions = {},
): ImpactMetrics {
  const values = pairValues(pairs, opts.skill);
  const n = values.length;
  if (n === 0) return emptyMetrics();

  const pres = values.map((v) => v.pre);
  const posts = values.map((v) => v.post);
  const diffs = values.map((v) => v.post - v.pre);
  const avgPre = mean(pres);
  const avgPost = mean(posts);
  const avgChange = mean(diffs);

  let improved = 0;
  let unchanged = 0;
  let declined = 0;
  for (const d of diffs) {
    const s = changeSign(d);
    if (s > 0) improved += 1;
    else if (s < 0) declined += 1;
    else unchanged += 1;
  }

  const relativeUndefined = avgPre === 0;
  const relative = relativeUndefined ? null : ((avgPost - avgPre) / avgPre) * 100;

  let ci: ImpactMetrics['changeCi95'] = null;
  let dz: number | null = null;
  if (n >= 2) {
    const sd = sampleSd(diffs);
    const se = sd / Math.sqrt(n);
    const t = tCritical95(n - 1);
    ci = { low: r1(avgChange - t * se), high: r1(avgChange + t * se) };
    dz = sd < 1e-9 ? null : r1(avgChange / sd);
  }

  // Confidence: pairs with both self-reported confidences (independent of the skill filter's score).
  const confPairs = values.filter(
    (v) => v.pair.pre_confidence !== null && v.pair.post_confidence !== null,
  );
  const confidence: ImpactMetrics['confidence'] = confPairs.length
    ? {
        n: confPairs.length,
        averagePre: r1(mean(confPairs.map((v) => v.pair.pre_confidence as number))),
        averagePost: r1(mean(confPairs.map((v) => v.pair.post_confidence as number))),
      }
    : null;

  // Retention: matched pairs with a retention attempt. Retention is only recorded as an overall
  // percentage, so this block always uses overall post/retention percentages (skill-agnostic).
  const retPairs = values.filter((v) => v.pair.retention_percentage !== null);
  const retention: ImpactMetrics['retention'] = retPairs.length
    ? {
        n: retPairs.length,
        averagePost: r1(mean(retPairs.map((v) => v.pair.post_percentage))),
        averageRetention: r1(mean(retPairs.map((v) => v.pair.retention_percentage as number))),
      }
    : null;

  return {
    n,
    averagePre: r1(avgPre),
    averagePost: r1(avgPost),
    averageChangePoints: r1(avgChange),
    relativeChangePercent: relative === null ? null : r1(relative),
    relativeChangeUndefined: relativeUndefined,
    improvedPercent: r1((improved / n) * 100),
    unchangedPercent: r1((unchanged / n) * 100),
    declinedPercent: r1((declined / n) * 100),
    improvedCount: improved,
    unchangedCount: unchanged,
    declinedCount: declined,
    changeCi95: ci,
    effectSizeDz: dz,
    confidence,
    retention,
  };
}

/** One row per skill appearing in any pair (either form), in SKILL_CATEGORIES order. */
export function computeSkillImpacts(pairs: MatchedPairRow[], threshold: number): SkillImpact[] {
  const present = new Set<SkillCategory>();
  for (const p of pairs) {
    for (const k of Object.keys(p.pre_skills)) present.add(k as SkillCategory);
    for (const k of Object.keys(p.post_skills)) present.add(k as SkillCategory);
  }
  const out: SkillImpact[] = [];
  for (const skill of SKILL_CATEGORIES) {
    if (!present.has(skill)) continue;
    const values = pairValues(pairs, skill);
    const n = values.length;
    out.push({
      skill,
      n,
      averagePre: n ? r1(mean(values.map((v) => v.pre))) : null,
      averagePost: n ? r1(mean(values.map((v) => v.post))) : null,
      averageChangePoints: n ? r1(mean(values.map((v) => v.post - v.pre))) : null,
      suppressed: n < threshold,
    });
  }
  return out;
}

/**
 * Score buckets by the real-valued percentage: '0-19' is [0, 20), '20-39' is [20, 40), '40-59' is
 * [40, 60), '60-79' is [60, 80) and '80-100' is [80, 100]. Values outside 0..100 are clamped.
 */
export function scoreBucket(pct: number): (typeof SCORE_BUCKETS)[number] {
  const i = Math.min(4, Math.max(0, Math.floor(pct / 20)));
  return SCORE_BUCKETS[i] as (typeof SCORE_BUCKETS)[number];
}

export function scoreDistribution(
  pairs: MatchedPairRow[],
  opts: MetricsOptions = {},
): ScoreDistributionBucket[] {
  const rows = SCORE_BUCKETS.map((bucket) => ({ bucket: bucket as string, pre: 0, post: 0 }));
  for (const v of pairValues(pairs, opts.skill)) {
    const pre = rows.find((r) => r.bucket === scoreBucket(v.pre));
    const post = rows.find((r) => r.bucket === scoreBucket(v.post));
    if (pre) pre.pre += 1;
    if (post) post.post += 1;
  }
  return rows;
}

/**
 * Change buckets on the change in points rounded to 2 dp: '≤ -20' is change ≤ −20.00; '-19 to -1'
 * is (−20, 0); '0' is exactly 0.00; '1 to 19' is (0, 20); '20 to 39' is [20, 40); '≥ 40' is ≥ 40.
 */
export function changeBucket(diff: number): (typeof CHANGE_BUCKETS)[number] {
  const c = Math.round(diff * 100);
  if (c <= -2000) return CHANGE_BUCKETS[0];
  if (c < 0) return CHANGE_BUCKETS[1];
  if (c === 0) return CHANGE_BUCKETS[2];
  if (c < 2000) return CHANGE_BUCKETS[3];
  if (c < 4000) return CHANGE_BUCKETS[4];
  return CHANGE_BUCKETS[5];
}

export function changeDistribution(
  pairs: MatchedPairRow[],
  opts: MetricsOptions = {},
): ChangeDistributionBucket[] {
  const rows = CHANGE_BUCKETS.map((bucket) => ({ bucket: bucket as string, count: 0 }));
  for (const v of pairValues(pairs, opts.skill)) {
    const row = rows.find((r) => r.bucket === changeBucket(v.post - v.pre));
    if (row) row.count += 1;
  }
  return rows;
}
