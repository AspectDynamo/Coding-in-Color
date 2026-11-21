import type { AgeBand, AssessmentStage, StaffRole } from '@shared/types';

export const DASH = '—';

/** Fixed-decimal number, or an em dash for null/undefined. */
export function fmtNum(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  return Math.round(v).toLocaleString('en-US');
}
/** Percent of something (a share or a score): "62.5%". */
export function fmtPct(v: number | null | undefined, dp = 1): string {
  return v === null || v === undefined ? DASH : `${fmtNum(v, dp)}%`;
}
/** Signed change in PERCENTAGE POINTS: "+12.4 pts". Never rendered with a % sign. */
export function fmtPts(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined) return DASH;
  return `${signed(v, dp)} pts`;
}
/** Signed relative change in PERCENT: "+30.1%". */
export function fmtSignedPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined) return DASH;
  return `${signed(v, dp)}%`;
}
export function signed(v: number, dp = 1): string {
  const rounded = Number(v.toFixed(dp));
  const body = fmtNum(Math.abs(rounded), dp);
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `−${body}`;
  return body;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export function fmtMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return DASH;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s.toString().padStart(2, '0')} s` : `${s} s`;
}

export const STAGE_LABELS: Record<AssessmentStage, string> = {
  PRE: 'Pre (baseline)',
  POST: 'Post (final)',
  RETENTION: 'Retention',
  PRACTICE: 'Practice',
};
export const STAGE_SHORT: Record<AssessmentStage, string> = {
  PRE: 'Pre',
  POST: 'Post',
  RETENTION: 'Retention',
  PRACTICE: 'Practice',
};
export const STAGE_STUDENT: Record<AssessmentStage, string> = {
  PRE: 'Before we start',
  POST: 'After the program',
  RETENTION: 'Check-back',
  PRACTICE: 'Practice',
};
export const STAGE_HELP: Record<AssessmentStage, string> = {
  PRE: 'Baseline check-in given before instruction starts. Needed to measure learning gains.',
  POST: 'Given at the end of the program. Paired with each student’s PRE to measure change.',
  RETENTION: 'Given weeks later to see how much of the learning stuck.',
  PRACTICE: 'Low-stakes practice. Unlimited attempts, never counted in impact metrics.',
};
export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  UNDER_13: 'Under 13',
  AGE_13_17: '13–17',
  AGE_18_PLUS: '18+',
};
export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  analyst: 'Analyst',
  instructor: 'Instructor',
};

export function titleCase(s: string): string {
  return s
    .replace(/[_.-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\bai\b/gi, 'AI');
}
