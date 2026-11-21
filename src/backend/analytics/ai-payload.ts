/**
 * The ONLY data the AI model sees: a minimal aggregate payload built from the suppressed dashboard.
 * Contains no ids, codes, responses or student-level data; `assertNoIdentifiers` enforces that.
 */
import type { ImpactDashboard } from '../../shared/api';
import { SKILL_LABELS, type ReportType } from '../../shared/types';
import { suppressForExternal } from './suppression';

export interface AiPayload {
  report_type: ReportType;
  scope_label: string;
  assessment_period: { from: string | null; to: string | null };
  students_enrolled: number;
  pre_completions: number;
  post_completions: number;
  matched_students: number;
  /** percent (post completions / enrolled) */
  completion_rate: number | null;
  /** percent (matched / pre completions) */
  match_rate: number | null;
  /** mean pre/post score in percent of available points, matched students only; null when suppressed */
  average_pre_score: number | null;
  average_post_score: number | null;
  /** percentage POINTS */
  average_change_points: number | null;
  /** percent; "undefined" when the average pre score is 0 */
  relative_change_percent: number | 'undefined' | null;
  percentage_improving: number | null;
  percentage_unchanged: number | null;
  percentage_declining: number | null;
  /** 95% CI of the mean change, percentage points */
  change_ci95: { low: number; high: number } | null;
  effect_size_dz: number | null;
  /** self-reported confidence (1-5), reported separately from measured scores */
  self_reported_confidence: {
    n: number;
    average_pre: number | null;
    average_post: number | null;
  } | null;
  retention: {
    n: number;
    average_post_score: number | null;
    average_retention_score: number | null;
  } | null;
  /** only skills with n >= threshold */
  skills: {
    skill: string;
    n: number;
    pre: number | null;
    post: number | null;
    change: number | null;
  }[];
  strongest_skill: string | null;
  weakest_skill: string | null;
  /** only cohorts with matched >= threshold */
  cohorts: { name: string; matched: number; change: number | null }[];
  suppression_threshold: number;
  sample_sufficient: boolean;
  limitations: string[];
  is_synthetic_data: boolean;
}

export class PayloadIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadIdentifierError';
  }
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/** Formatted access code XXXX-XXXX-XXXX-XXXX (Crockford base32). */
const ACCESS_CODE_FORMATTED_RE = /\b[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}\b/i;
/** Unformatted 16-char code; requires a digit to avoid flagging long ordinary words. */
const ACCESS_CODE_RAW_RE =
  /\b(?=[0-9A-HJKMNP-TV-Z]{16}\b)[A-HJKMNP-TV-Z]*[0-9][0-9A-HJKMNP-TV-Z]*\b/;
const PUBLIC_CODE_RE = /\bS-[0-9A-Z]{6}\b/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const MAX_FREE_TEXT = 80;
/** Global, case-insensitive variants used only for redaction. */
const REDACT_PATTERNS: RegExp[] = [
  new RegExp(UUID_RE.source, 'gi'),
  new RegExp(ACCESS_CODE_FORMATTED_RE.source, 'gi'),
  new RegExp(ACCESS_CODE_RAW_RE.source, 'gi'),
  new RegExp(PUBLIC_CODE_RE.source, 'gi'),
  new RegExp(EMAIL_RE.source, 'g'),
];

/**
 * Free-text labels (scope, cohort and program names) are staff-entered, so they could contain
 * something that looks like an identifier. Redact those substrings, trim and cap the length.
 * `assertNoIdentifiers` still runs afterwards and throws on anything that slips through.
 */
export function sanitizeFreeText(value: string): string {
  let out = value.replace(/\p{Cc}+/gu, ' ');
  for (const re of REDACT_PATTERNS) out = out.replace(re, '[redacted]');
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_FREE_TEXT).trim();
}

const KEY_DENYLIST = new Set([
  'id',
  'student_id',
  'studentid',
  'student_ids',
  'attempt_id',
  'attemptid',
  'session_id',
  'cohort_id',
  'user_id',
  'code',
  'access_code',
  'accesscode',
  'public_code',
  'publiccode',
  'roster_label',
  'rosterlabel',
  'email',
  'student_name',
  'studentname',
  'first_name',
  'last_name',
  'full_name',
  'student',
  'students',
  'response',
  'responses',
  'roster',
  'credential',
  'ip',
  'ip_address',
  'student_records',
]);

/** Throws PayloadIdentifierError if any key is on the denylist or any string looks like an identifier. */
export function assertNoIdentifiers(payload: unknown): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (UUID_RE.test(value))
        throw new PayloadIdentifierError(`UUID found in AI payload at ${path}`);
      if (ACCESS_CODE_FORMATTED_RE.test(value) || ACCESS_CODE_RAW_RE.test(value))
        throw new PayloadIdentifierError(`Access-code-like value found in AI payload at ${path}`);
      if (PUBLIC_CODE_RE.test(value))
        throw new PayloadIdentifierError(`Public student code found in AI payload at ${path}`);
      if (EMAIL_RE.test(value))
        throw new PayloadIdentifierError(`Email-like value found in AI payload at ${path}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (KEY_DENYLIST.has(k.toLowerCase()))
          throw new PayloadIdentifierError(`Denied key "${k}" in AI payload at ${path}`);
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(payload, '$');
}

export function buildAiPayload(
  dashboard: ImpactDashboard,
  ctx: { reportType: ReportType; scopeLabel: string },
): AiPayload {
  const d = suppressForExternal(dashboard);
  const t = d.suppressionThreshold;
  const m = d.metrics;
  const sufficient = m.n >= t;

  const skills = d.skills
    .filter((s) => !s.suppressed && s.n >= t)
    .map((s) => ({
      skill: SKILL_LABELS[s.skill],
      n: s.n,
      pre: s.averagePre,
      post: s.averagePost,
      change: s.averageChangePoints,
    }));
  const ranked = skills.filter((s) => s.change !== null);
  let strongest: string | null = null;
  let weakest: string | null = null;
  if (ranked.length) {
    let hi = ranked[0]!;
    let lo = ranked[0]!;
    for (const s of ranked) {
      if ((s.change as number) > (hi.change as number)) hi = s;
      if ((s.change as number) < (lo.change as number)) lo = s;
    }
    strongest = hi.skill;
    weakest = ranked.length > 1 && lo !== hi ? lo.skill : null;
  }

  const payload: AiPayload = {
    report_type: ctx.reportType,
    scope_label: sanitizeFreeText(ctx.scopeLabel),
    assessment_period: { from: d.assessmentPeriod.from, to: d.assessmentPeriod.to },
    students_enrolled: d.kpis.enrolledStudents,
    pre_completions: d.kpis.preCompletions,
    post_completions: d.kpis.postCompletions,
    matched_students: m.n,
    completion_rate: d.kpis.completionRate,
    match_rate: d.kpis.matchRate,
    average_pre_score: m.averagePre,
    average_post_score: m.averagePost,
    average_change_points: m.averageChangePoints,
    relative_change_percent: m.relativeChangeUndefined ? 'undefined' : m.relativeChangePercent,
    percentage_improving: m.improvedPercent,
    percentage_unchanged: m.unchangedPercent,
    percentage_declining: m.declinedPercent,
    change_ci95: m.changeCi95 ? { low: m.changeCi95.low, high: m.changeCi95.high } : null,
    effect_size_dz: m.effectSizeDz,
    self_reported_confidence: m.confidence
      ? {
          n: m.confidence.n,
          average_pre: m.confidence.averagePre,
          average_post: m.confidence.averagePost,
        }
      : null,
    retention: m.retention
      ? {
          n: m.retention.n,
          average_post_score: m.retention.averagePost,
          average_retention_score: m.retention.averageRetention,
        }
      : null,
    skills,
    strongest_skill: strongest,
    weakest_skill: weakest,
    cohorts: d.cohorts
      .filter((c) => !c.suppressed)
      .map((c) => ({
        name: sanitizeFreeText(c.cohortName),
        matched: c.matched,
        change: c.averageChangePoints,
      })),
    suppression_threshold: t,
    sample_sufficient: sufficient,
    limitations: [...d.limitations],
    is_synthetic_data: d.isSyntheticData,
  };
  assertNoIdentifiers(payload);
  return payload;
}
