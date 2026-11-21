/**
 * Round half away from zero to `dp` decimals. A tiny epsilon absorbs binary floating point
 * noise (e.g. 1.005 -> 1.01). Never returns -0.
 */
export function roundTo(x: number, dp: number): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  const r = Math.round(Math.abs(x) * f + 1e-9) / f;
  return x < 0 && r !== 0 ? -r : r;
}
