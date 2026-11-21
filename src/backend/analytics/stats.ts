/** Small statistics helpers (pure, no dependencies). */

export function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1). Requires xs.length >= 2. */
export function sampleSd(xs: number[]): number {
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

/** Two-sided 95% critical values of Student's t for df 1..30. */
const T_975_1_TO_30 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];
/** Anchor points beyond df 30; Infinity is the normal limit. */
const T_ANCHORS: [number, number][] = [
  [30, 2.042],
  [40, 2.021],
  [60, 2.0],
  [120, 1.98],
  [Infinity, 1.96],
];

/**
 * Two-sided 95% t critical value for `df` degrees of freedom. Exact table for df 1–30, then anchors at
 * 40, 60, 120 and ∞ with interpolation linear in 1/df (the standard harmonic interpolation).
 */
export function tCritical95(df: number): number {
  if (!Number.isFinite(df)) return 1.96;
  if (df < 1) return Number.NaN;
  const d = Math.floor(df);
  if (d <= 30) return T_975_1_TO_30[d - 1] as number;
  for (let i = 1; i < T_ANCHORS.length; i++) {
    const [lo, tLo] = T_ANCHORS[i - 1] as [number, number];
    const [hi, tHi] = T_ANCHORS[i] as [number, number];
    if (d <= hi) {
      const invLo = 1 / lo;
      const invHi = Number.isFinite(hi) ? 1 / hi : 0;
      const w = (invLo - 1 / d) / (invLo - invHi);
      return tLo + (tHi - tLo) * w;
    }
  }
  return 1.96;
}
