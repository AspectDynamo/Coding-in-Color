/**
 * CSV exports (RFC 4180, CRLF line endings). Dashboard exports are always re-suppressed
 * (suppressForExternal is idempotent). Cells that start with = + - @ TAB or CR are prefixed with a
 * single quote to defuse spreadsheet formula injection (typed numbers are written as-is).
 */
import type { ImpactDashboard, SessionProgressDto } from '../../shared/api';
import { SKILL_LABELS } from '../../shared/types';
import { suppressForExternal } from './suppression';

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(',');
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function comment(text: string): string {
  return csvRow([`# ${oneLine(text)}`]);
}

function filtersText(f: ImpactDashboard['filters']): string {
  const parts = Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? parts.join('; ') : 'none (all programs in scope)';
}

function headerRows(title: string, d: ImpactDashboard): string[] {
  const rows = [comment(title), comment(`Generated: ${d.generatedAt}`)];
  if (d.isSyntheticData) rows.push(comment('SYNTHETIC DEMO DATA - not real students'));
  rows.push(
    comment(`Filters: ${filtersText(d.filters)}`),
    comment(
      `Assessment period (post-assessment dates): ${d.assessmentPeriod.from ?? 'n/a'} to ${d.assessmentPeriod.to ?? 'n/a'}`,
    ),
    comment(
      `Suppression threshold: ${d.suppressionThreshold} - groups with fewer than ${d.suppressionThreshold} matched students have values withheld (blank, suppressed = yes)`,
    ),
    comment(
      'Units: scores and averages are percent of available points; change is in percentage points (pts); relative change is percent; confidence is self-reported on a 1-5 scale',
    ),
  );
  for (const l of d.limitations) rows.push(comment(`Limitation: ${l}`));
  return rows;
}

const yn = (b: boolean) => (b ? 'yes' : 'no');

/** Overall row + one row per cohort. */
export function impactCsv(dashboard: ImpactDashboard): string {
  const d = suppressForExternal(dashboard);
  const m = d.metrics;
  const k = d.kpis;
  const rows = headerRows('Coding in Color Impact - impact summary export', d);
  rows.push(
    comment(
      `Completions: pre=${k.preCompletions}; post=${k.postCompletions}; retention=${k.retentionCompletions}; matched pairs=${k.matchedPairs}; completion rate=${k.completionRate ?? 'n/a'}%; match rate=${k.matchRate ?? 'n/a'}%`,
    ),
  );
  rows.push(
    csvRow([
      'scope',
      'program',
      'course',
      'cohort',
      'enrolled',
      'matched_students',
      'average_pre_pct',
      'average_post_pct',
      'average_change_pts',
      'relative_change_pct',
      'improved_pct',
      'unchanged_pct',
      'declined_pct',
      'change_ci95_low_pts',
      'change_ci95_high_pts',
      'effect_size_dz',
      'suppressed',
    ]),
  );
  const overallSuppressed = m.n < d.suppressionThreshold;
  rows.push(
    csvRow([
      'overall',
      '',
      '',
      '',
      k.enrolledStudents,
      m.n,
      m.averagePre,
      m.averagePost,
      m.averageChangePoints,
      m.relativeChangePercent,
      m.improvedPercent,
      m.unchangedPercent,
      m.declinedPercent,
      m.changeCi95?.low,
      m.changeCi95?.high,
      m.effectSizeDz,
      yn(overallSuppressed),
    ]),
  );
  for (const c of d.cohorts) {
    rows.push(
      csvRow([
        'cohort',
        c.programName,
        c.courseName,
        c.cohortName,
        c.enrolled,
        c.matched,
        c.averagePre,
        c.averagePost,
        c.averageChangePoints,
        '',
        c.improvedPercent,
        '',
        '',
        '',
        '',
        '',
        yn(c.suppressed),
      ]),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function skillsCsv(dashboard: ImpactDashboard): string {
  const d = suppressForExternal(dashboard);
  const rows = headerRows('Coding in Color Impact - skill-level export', d);
  rows.push(
    csvRow([
      'skill',
      'matched_students',
      'average_pre_pct',
      'average_post_pct',
      'average_change_pts',
      'suppressed',
    ]),
  );
  for (const s of d.skills) {
    rows.push(
      csvRow([
        SKILL_LABELS[s.skill],
        s.n,
        s.averagePre,
        s.averagePost,
        s.averageChangePoints,
        yn(s.suppressed),
      ]),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

/**
 * Session aggregate export. Contains no roster, student codes or per-student values. When fewer
 * than `suppressionThreshold` students submitted, the average score and median duration are withheld.
 */
export function sessionCsv(p: SessionProgressDto, opts: { generatedAt?: string } = {}): string {
  const t = p.suppressionThreshold;
  const suppressed = p.submitted < t || p.aggregate === null || p.aggregate.n < t;
  const rows = [
    comment('Coding in Color Impact - assessment session export'),
    comment(`Generated: ${opts.generatedAt ?? new Date().toISOString()}`),
    comment(`Session: ${p.session.title} (${p.session.stage})`),
    comment(
      `Suppression threshold: ${t} - average score and median duration are withheld when fewer than ${t} students submitted`,
    ),
    comment('Scores are percent of available points. Aggregate only; no student-level data.'),
    csvRow([
      'cohort',
      'program',
      'assessment',
      'stage',
      'status',
      'enrolled',
      'not_started',
      'in_progress',
      'submitted',
      'completion_rate_pct',
      'median_duration_seconds',
      'average_score_pct',
      'score_n',
      'suppressed',
    ]),
    csvRow([
      p.session.cohortName,
      p.session.programName,
      p.session.assessmentTitle,
      p.session.stage,
      p.session.status,
      p.enrolled,
      p.notStarted,
      p.inProgress,
      p.submitted,
      p.completionRate,
      suppressed ? null : p.medianDurationSeconds,
      suppressed ? null : p.aggregate?.averagePercentage,
      p.aggregate?.n ?? p.submitted,
      yn(suppressed),
    ]),
  ];
  return rows.join('\r\n') + '\r\n';
}
