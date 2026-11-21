import type { TrendPoint } from '@shared/api';
import { fmtMonth, fmtPts } from '@frontend/lib/format';

/**
 * Colour is a code, not decoration:
 * baseline = geometric blue (drawn as an OUTLINE with a light fill), final = solid Bauhaus red,
 * neutral reference = sage / ink, highlight = yellow. Baseline and final differ in form as well
 * as hue because red and blue alone have only 1.4:1 contrast with each other.
 */
export const SERIES = {
  pre: '#315FA8',
  preFill: '#DCE5F2',
  post: '#D94335',
  neutral: '#8D9B83',
  ink: '#20201E',
  paper: '#FBF9F3',
  highlight: '#E9BE43',
  grid: '#D4CFC3',
  tick: '#66645D',
} as const;

export const LEGEND_PRE = {
  label: 'Baseline (pre)',
  color: SERIES.pre,
  fill: SERIES.preFill,
  shape: 'outline',
} as const;
export const LEGEND_POST = { label: 'Final (post)', color: SERIES.post, shape: 'solid' } as const;

/** Polarity by bucket position: declines, no change, gains. */
export function changeBucketTone(bucket: string): 'declined' | 'unchanged' | 'improved' {
  const b = bucket.trim();
  if (b === '0') return 'unchanged';
  return /^(≤\s*)?[-−]/.test(b) ? 'declined' : 'improved';
}

export const trendSummary = (t: TrendPoint[]) => {
  const pts = t.filter((x) => x.averageChangePoints !== null);
  if (pts.length === 0) return 'No months with matched pairs yet.';
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return `Average change by month from ${fmtMonth(first.period)} (${fmtPts(first.averageChangePoints)}) to ${fmtMonth(last.period)} (${fmtPts(last.averageChangePoints)}).`;
};
