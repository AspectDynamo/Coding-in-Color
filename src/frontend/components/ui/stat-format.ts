import { fmtInt, fmtNum, signed, DASH } from '@frontend/lib/format';

export type StatUnit = 'count' | 'percent' | 'points' | 'score' | 'relative' | 'plain';

/**
 * Formats a stat into { text, unit }:
 *  - points   → signed, unit "pts"  (percentage-point change — never "%")
 *  - relative → signed, unit "%"    (relative change)
 *  - percent  → unit "%"            (a share of students)
 *  - score    → unit "%"            (average score out of 100)
 */
export function formatStat(
  value: number | null | undefined,
  unit: StatUnit,
): { text: string; unit: string } {
  if (value === null || value === undefined || Number.isNaN(value)) return { text: DASH, unit: '' };
  switch (unit) {
    case 'count':
      return { text: fmtInt(value), unit: '' };
    case 'points':
      return { text: signed(value, 1), unit: 'pts' };
    case 'relative':
      return { text: signed(value, 1), unit: '%' };
    case 'percent':
    case 'score':
      return { text: fmtNum(value, 1), unit: '%' };
    default:
      return { text: fmtNum(value, 1), unit: '' };
  }
}
