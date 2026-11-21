import { useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRight, Download, Printer } from 'lucide-react';
import type {
  CohortComparisonRow,
  DashboardFilters,
  FilterOptions,
  ImpactDashboard,
  ImpactMetrics,
  RecentActivityItem,
} from '@shared/api';
import { SKILL_LABELS } from '@shared/types';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  Figure,
  Legend,
  LoadingBlock,
  Meter,
  Metric,
  Notice,
  PageHeader,
  Section,
  Skeleton,
  Table,
  Tooltip,
  formatStat,
  useToast,
} from '@frontend/components/ui';
import {
  ChangeDistributionChart,
  ChangeTrendChart,
  CompletionsTrendChart,
  ScoreDistributionChart,
  SkillComparisonChart,
} from '@frontend/components/charts/ImpactCharts';
import {
  LEGEND_POST,
  LEGEND_PRE,
  SERIES,
  trendSummary,
} from '@frontend/components/charts/chart-utils';
import { FilterBar } from '@frontend/components/FilterBar';
import { SessionStatusBadge, StageBadge } from '@frontend/components/StatusBadges';
import { useQuery } from '@frontend/hooks/useApi';
import { useStaff } from '@frontend/hooks/contexts';
import { api, downloadCsv, errorMessage, type Query } from '@frontend/services/api';
import { filtersFromParams, filtersKey, filtersToParams } from '@frontend/lib/filters';
import {
  fmtDate,
  fmtDateTime,
  fmtInt,
  fmtMonth,
  fmtNum,
  fmtPct,
  fmtPts,
} from '@frontend/lib/format';

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function SmallN({ n, threshold }: { n: number; threshold: number }) {
  if (n >= threshold) return null;
  return (
    <Badge tone="warn" icon={<AlertTriangle size={12} aria-hidden="true" />}>
      Small group (n &lt; {threshold})
    </Badge>
  );
}

const clamp = (v: number | null) => `${Math.max(0, Math.min(100, v ?? 0))}%`;

/**
 * The dominant figure of the page: average baseline and final score of the SAME matched
 * students on one fixed 0–100 scale, with the change marked between them.
 */
function PrePostFigure({ m, scoreWord }: { m: ImpactMetrics; scoreWord: string }) {
  const rows = [
    {
      label: `Average baseline ${scoreWord}`,
      value: m.averagePre,
      cls: 'bar-pre',
      row: 'row-start-1',
      help: 'Mean pre-assessment score among matched students.',
    },
    {
      label: `Average final ${scoreWord}`,
      value: m.averagePost,
      cls: 'bar-post',
      row: 'row-start-2',
      help: 'Mean post-assessment score among the same matched students.',
    },
  ] as const;
  const cols = 'sm:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem]';
  return (
    <figure className="m-0">
      {/* One shared 0–100 track; each bar sits on a line with its label (left) and value (right). */}
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-1.5 ${cols}`}>
        {rows.map((r) => {
          const f = formatStat(r.value, 'score');
          return (
            <div key={r.cls} className="contents" data-testid="stat-tile">
              <div className={`col-start-1 flex min-h-8 flex-col justify-center ${r.row}`}>
                <span className="flex items-center gap-1">
                  <span className="metric-label">{r.label}</span>
                  <Tooltip content={r.help} label={`About: ${r.label}`} align="start" />
                </span>
                <span className="t-num text-xs leading-tight text-ink-3" data-testid="stat-n">
                  n = {fmtInt(m.n)} matched
                </span>
              </div>
              <p
                className={`t-figure col-start-2 flex items-baseline justify-end gap-1 self-center text-[1.9375rem] sm:col-start-3 ${r.row}`}
              >
                <span data-testid="stat-value">{f.text}</span>
                {f.unit && (
                  <span className="text-base font-semibold text-ink-2" data-testid="stat-unit">
                    {f.unit}
                  </span>
                )}
              </p>
            </div>
          );
        })}
        <div
          className="pair col-span-2 row-start-3 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:-my-1.5"
          style={
            {
              '--bar-h': '2rem',
              '--pair-gap': '0.375rem',
              '--pair-pad': '0.375rem',
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {rows.map((r) => (
            <div key={r.cls} className={`bar ${r.cls}`} style={{ width: clamp(r.value) }} />
          ))}
        </div>
      </div>
      <div className={`mt-2.5 grid gap-x-5 ${cols}`} aria-hidden="true">
        <span className="hidden sm:block" />
        <div>
          <p className="t-num relative h-4 text-xs text-ink-3">
            {[0, 25, 50, 75, 100].map((t) => (
              <span
                key={t}
                className="absolute top-0"
                style={
                  t === 0
                    ? { left: 0 }
                    : t === 100
                      ? { right: 0 }
                      : { left: `${t}%`, transform: 'translateX(-50%)' }
                }
              >
                {t}
              </span>
            ))}
          </p>
          <p className="t-caption mt-0.5">Average {scoreWord} (%), axis 0–100</p>
        </div>
      </div>
      <figcaption className="sr-only">
        Average baseline {fmtPct(m.averagePre)} and average final {fmtPct(m.averagePost)} among{' '}
        {m.n} matched students: a change of {fmtPts(m.averageChangePoints)}.
      </figcaption>
    </figure>
  );
}

export function LimitationsPanel({
  limitations,
  threshold,
}: {
  limitations: string[];
  threshold: number;
}) {
  return (
    <div data-testid="limitations">
      <ul className="border-t border-ink">
        {[
          ...limitations,
          `Groups with fewer than ${threshold} matched students are flagged here and hidden in exports, printed reports and AI summaries. This is a protective default, not a legal de-identification guarantee.`,
          'Students who withdrew (including withdrawn consent) are excluded from all figures.',
        ].map((l, i) => (
          <li
            key={i}
            className="flex gap-3 border-b border-rule py-2.5 text-[0.9375rem] text-ink-2"
          >
            <span className="t-num flex-none text-ink-3" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState title="No recent session activity">
        Sessions in scope will appear here once instructors open them and students submit.
      </EmptyState>
    );
  }
  return (
    <ul className="border-t border-ink">
      {items.map((a) => (
        <li
          key={a.sessionId}
          className="grid gap-x-6 gap-y-1.5 border-b border-rule py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] xl:grid-cols-[minmax(0,1fr)_6rem_6.5rem_11rem_6.5rem] xl:items-center"
        >
          <div className="min-w-0 sm:col-span-3 xl:col-span-1">
            <p className="font-semibold leading-snug text-ink">{a.title}</p>
            <p className="t-caption">
              {a.cohortName} · {a.programName}
            </p>
          </div>
          <StageBadge stage={a.stage} />
          <span>
            <SessionStatusBadge status={a.status} />
          </span>
          <div className="flex items-center gap-3">
            <Meter
              className="flex-1"
              value={a.submittedCount}
              max={Math.max(a.enrolledCount, 1)}
              label={`${a.submittedCount} of ${a.enrolledCount} submitted in ${a.title}`}
            />
            <span className="t-num flex-none text-sm">
              {a.submittedCount}/{a.enrolledCount}
            </span>
          </div>
          <span className="t-num text-sm text-ink-2 xl:text-right">
            {fmtDate(a.lastActivityAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <LoadingBlock label="Loading impact metrics…">
      <div className="mt-8 space-y-8">
        <div className="grid gap-6 border-t border-rule pt-6 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    </LoadingBlock>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  const { can } = useStaff();
  const toast = useToast();
  const filters = filtersFromParams(params);
  const key = filtersKey(filters);
  const query = Object.fromEntries(filtersToParams(filters)) as Query;
  const [exporting, setExporting] = useState<string | null>(null);

  const options = useQuery('admin-filters', (s) =>
    api.get<FilterOptions>('/admin/filters', undefined, s),
  );
  const q = useQuery(
    `dashboard?${key}`,
    (s) => api.get<ImpactDashboard>('/admin/dashboard', query, s),
    { keepPrevious: true },
  );
  const d = q.data;

  const setFilters = (next: DashboardFilters) =>
    setParams(filtersToParams(next), { replace: false });

  const exportCsv = async (kind: 'impact' | 'skills') => {
    setExporting(kind);
    try {
      const name = await downloadCsv(`/admin/exports/${kind}.csv`, query, `cic-${kind}.csv`);
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(null);
    }
  };
  const suffix = key ? `?${key}` : '';

  const header = (
    <PageHeader
      title="Impact dashboard"
      description="Measured learning gains from matched pre- and post-assessments. Every filter updates every number on this page."
      actions={
        can('reports.export') || can('reports.ai') ? (
          <>
            {can('reports.ai') && (
              <ButtonLink size="sm" variant="primary" to={`/admin/reports${suffix}`}>
                Draft AI report
              </ButtonLink>
            )}
            {can('reports.export') && (
              <>
                <Button
                  size="sm"
                  icon={<Download size={15} aria-hidden="true" />}
                  loading={exporting === 'impact'}
                  onClick={() => void exportCsv('impact')}
                >
                  Impact CSV
                </Button>
                <Button
                  size="sm"
                  icon={<Download size={15} aria-hidden="true" />}
                  loading={exporting === 'skills'}
                  onClick={() => void exportCsv('skills')}
                >
                  Skills CSV
                </Button>
                <ButtonLink
                  size="sm"
                  to={`/admin/reports/print${suffix}`}
                  icon={<Printer size={15} aria-hidden="true" />}
                >
                  Printable report
                </ButtonLink>
              </>
            )}
          </>
        ) : undefined
      }
    />
  );

  const filterBar = (
    <FilterBar
      filters={filters}
      options={options.data}
      onChange={setFilters}
      busy={q.loading && !!d}
    />
  );

  if (!d) {
    return (
      <>
        {header}
        {filterBar}
        {q.error ? (
          <div className="mt-6">
            <ErrorState
              title="We couldn’t load the dashboard"
              message={errorMessage(q.error)}
              onRetry={q.refetch}
            />
          </div>
        ) : (
          <DashboardSkeleton />
        )}
      </>
    );
  }

  const { kpis, metrics: m } = d;
  const t = d.suppressionThreshold;
  const n = m.n;
  const scoreWord = filters.skill ? `${SKILL_LABELS[filters.skill]} sub-score` : 'score';
  const noPairs = n === 0;
  const skillsWithData = d.skills.filter((s) => s.n > 0);
  const smallSkills = d.skills.filter((s) => s.n > 0 && s.n < t);
  const recent = d.recentActivity ?? [];

  const cohortCols = [
    {
      key: 'c',
      header: 'Cohort',
      rowHeader: true,
      cell: (r: CohortComparisonRow) => (
        <span>
          {r.cohortName}
          <span className="t-caption block font-normal">
            {r.programName} · {r.courseName}
          </span>
        </span>
      ),
    },
    { key: 'e', header: 'Enrolled', numeric: true, cell: (r: CohortComparisonRow) => r.enrolled },
    {
      key: 'm',
      header: 'Matched (n)',
      numeric: true,
      cell: (r: CohortComparisonRow) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          {r.matched < t && r.matched > 0 && <SmallN n={r.matched} threshold={t} />}
          {r.matched}
        </span>
      ),
    },
    {
      key: 'bars',
      header: 'Avg baseline → final (%, axis 0–100)',
      stackLabel: 'Baseline → final',
      className: 'min-w-56',
      cell: (r: CohortComparisonRow) =>
        r.averagePre === null || r.averagePost === null ? (
          <span className="flex items-center gap-2">
            <span
              className="dot-grid block h-5 flex-1 border border-dashed border-rule-strong"
              aria-hidden="true"
            />
            <span className="t-num w-11 text-right text-xs">{fmtPct(null)}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="pair flex-1" aria-hidden="true">
              <span className="bar bar-pre block" style={{ width: clamp(r.averagePre) }} />
              <span className="bar bar-post block" style={{ width: clamp(r.averagePost) }} />
            </span>
            <span className="t-num grid w-11 flex-none gap-[3px] text-right text-xs leading-[0.625rem] text-ink">
              <span>
                <span className="sr-only">Baseline </span>
                {fmtNum(r.averagePre)}
              </span>
              <span>
                <span className="sr-only">Final </span>
                {fmtNum(r.averagePost)}
              </span>
            </span>
          </span>
        ),
    },
    {
      key: 'ch',
      header: 'Avg change',
      numeric: true,
      cell: (r: CohortComparisonRow) =>
        r.averageChangePoints === null ? (
          fmtPts(null)
        ) : (
          <span className="tag-change">{fmtPts(r.averageChangePoints)}</span>
        ),
    },
    {
      key: 'imp',
      header: 'Improved',
      numeric: true,
      cell: (r: CohortComparisonRow) => fmtPct(r.improvedPercent),
    },
  ];

  return (
    <>
      {header}
      <div aria-busy={q.loading}>
        {filterBar}

        <div
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-ink-2"
          data-testid="context-bar"
        >
          {d.isSyntheticData && <Badge tone="warn">Synthetic demo data — not real students</Badge>}
          <span>
            Assessment period{' '}
            <span className="t-num text-ink">
              {d.assessmentPeriod.from
                ? `${fmtDate(d.assessmentPeriod.from)} – ${fmtDate(d.assessmentPeriod.to)}`
                : 'no post-assessments yet'}
            </span>
          </span>
          <span>
            Updated <span className="t-num">{fmtDateTime(d.generatedAt)}</span>
          </span>
        </div>

        {q.error && (
          <Notice
            tone="bad"
            role="alert"
            className="mt-4"
            title="Couldn’t refresh with these filters"
          >
            {errorMessage(q.error)} Showing the last results that loaded.{' '}
            <button type="button" className="link" onClick={q.refetch}>
              Try again
            </button>
          </Notice>
        )}
        {filters.skill && (
          <Notice tone="info" role="status" className="mt-4">
            Baseline, final and change values below use the{' '}
            <strong>{SKILL_LABELS[filters.skill]}</strong> sub-score. Pairs without that skill on
            both forms are left out, so n may be smaller.
          </Notice>
        )}

        {/* 01 — Measured gains: three headline numbers, then the dominant pre/post figure */}
        <Section
          className="!mt-5"
          number="01"
          title="Measured learning gains"
          aside={
            <>
              <p className="t-num text-sm text-ink" data-testid="matched-n">
                n = {n} matched {n === 1 ? 'student' : 'students'}
              </p>
              <div className="mt-2">
                <SmallN n={n} threshold={t} />
              </div>
              <div className="mt-3">
                <Legend items={[LEGEND_PRE, LEGEND_POST]} />
              </div>
              <p className="mt-3">
                Observed changes among matched students. Without a comparison group they do not, by
                themselves, show that the program caused the change.
              </p>
            </>
          }
        >
          {noPairs ? (
            <EmptyState title="No matched pairs for these filters">
              Learning gains are only calculated for students who completed both a pre- and a
              post-assessment in the same cohort. Try widening the filters, or check back after
              post-assessments are submitted.
            </EmptyState>
          ) : (
            <div data-testid="kpi-gains">
              <div className="grid gap-x-6 gap-y-6 sm:grid-cols-[5fr_3fr_4fr]">
                <Metric
                  size="hero"
                  label="Average change"
                  value={m.averageChangePoints}
                  unit="points"
                  n={n}
                  sub={
                    m.changeCi95
                      ? `95% CI ${fmtPts(m.changeCi95.low)} to ${fmtPts(m.changeCi95.high)}`
                      : '95% CI needs n ≥ 2'
                  }
                  help="Mean of (final − baseline) for each matched student, in percentage points (pts). A change from 40% to 55% is +15 pts."
                />
                <Metric
                  size="hero"
                  className="sm:border-l sm:border-rule sm:pl-6"
                  label="Matched pairs"
                  value={kpis.matchedPairs}
                  unit="count"
                  sub={`match rate ${fmtPct(kpis.matchRate)}`}
                  help="Students with both a PRE and a later POST in the same cohort and assessment family. This is the n behind every learning-gain number."
                />
                <Metric
                  size="hero"
                  className="sm:border-l sm:border-rule sm:pl-6"
                  label="Improved"
                  value={m.improvedPercent}
                  unit="percent"
                  n={n}
                  sub={`${m.improvedCount} students`}
                  help="Share of matched students whose final score was higher than their baseline."
                />
              </div>

              <div className="mt-5 border-t border-ink pt-4">
                <PrePostFigure m={m} scoreWord={scoreWord} />
                <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-4 xl:grid-cols-4">
                  <Metric
                    size="standard"
                    label="Relative change"
                    value={m.relativeChangePercent}
                    unit="relative"
                    n={n}
                    emptyText={
                      m.relativeChangeUndefined ? 'Undefined (baseline 0)' : 'Not available'
                    }
                    help="(Average final − average baseline) ÷ average baseline, in percent. Different from percentage points: 40% → 55% is +15 pts but +37.5%. Undefined when the baseline average is 0."
                  />
                  <Metric
                    size="standard"
                    label="Unchanged"
                    value={m.unchangedPercent}
                    unit="percent"
                    n={n}
                    sub={`${m.unchangedCount} students`}
                  />
                  <Metric
                    size="standard"
                    label="Declined"
                    value={m.declinedPercent}
                    unit="percent"
                    n={n}
                    sub={`${m.declinedCount} students`}
                    help="Share whose final score was lower. Some decline is normal: forms differ and scores vary from day to day."
                  />
                  <div className="metric metric-standard" data-testid="stat-context">
                    <span className="flex items-center gap-1">
                      <span className="metric-label">
                        Effect size d<sub>z</sub>
                      </span>
                      <Tooltip
                        label="About statistical context"
                        align="end"
                        content="The 95% confidence interval is the range where the true average change plausibly lies given how much students varied. If it does not include 0, the observed change is unlikely to be chance alone. Effect size (d_z) is the average change divided by how spread out the changes were; around 0.2 is often called small, 0.5 medium and 0.8 large. Neither shows what caused the change."
                      />
                    </span>
                    <p className="metric-value">
                      {m.effectSizeDz === null ? '—' : fmtNum(m.effectSizeDz, 2)}
                    </p>
                    <p className="metric-foot">paired, n = {fmtInt(n)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* 02 — Skills */}
        {!noPairs && (
          <Section
            number="02"
            title="Skill-level analysis"
            aside={
              <>
                <Legend items={[LEGEND_PRE, LEGEND_POST]} />
                <p className="mt-3">
                  Average sub-score per skill among matched students. Skills marked * have fewer
                  than {t} matched students — read with caution.
                </p>
              </>
            }
          >
            <div className="grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <Figure
                title="Baseline vs. final by skill"
                summary={`Paired bars comparing baseline and final average scores for ${skillsWithData.length} skills.`}
                table={{
                  caption: 'Baseline and final average score by skill',
                  columns: [
                    'Skill',
                    'Matched (n)',
                    'Baseline %',
                    'Final %',
                    'Change (pts)',
                    'Flag',
                  ],
                  rows: d.skills.map((s) => [
                    SKILL_LABELS[s.skill],
                    s.n,
                    fmtNum(s.averagePre),
                    fmtNum(s.averagePost),
                    fmtPts(s.averageChangePoints),
                    s.n < t ? `n < ${t}` : '',
                  ]),
                }}
                footnote={
                  smallSkills.length > 0
                    ? `* Small groups (n < ${t}): ${smallSkills.map((s) => `${SKILL_LABELS[s.skill]} (n = ${s.n})`).join(', ')}. Hidden in exports and printed reports.`
                    : `All skills shown have at least ${t} matched students.`
                }
              >
                {skillsWithData.length > 0 ? (
                  <SkillComparisonChart skills={skillsWithData} threshold={t} />
                ) : (
                  <EmptyState title="No skill data for these filters" />
                )}
              </Figure>

              <div className="grid content-start gap-10">
                <Figure
                  title="Distribution of change"
                  description="How much each matched student’s score moved, in percentage points."
                  legend={[
                    { label: 'Declined', color: SERIES.neutral, shape: 'solid' },
                    { label: 'No change', color: SERIES.ink, fill: SERIES.paper, shape: 'outline' },
                    { label: 'Improved', color: SERIES.post, shape: 'solid' },
                  ]}
                  summary={`Bar chart of matched students by size of change. ${m.improvedCount} improved, ${m.unchangedCount} unchanged, ${m.declinedCount} declined.`}
                  table={{
                    caption: 'Matched students by change in percentage points',
                    columns: ['Change (pts)', 'Students'],
                    rows: d.changeDistribution.map((b) => [b.bucket, b.count]),
                  }}
                  footnote={`n = ${n} matched`}
                >
                  <ChangeDistributionChart data={d.changeDistribution} />
                </Figure>
                <Figure
                  title="Score distribution: baseline vs. final"
                  description={`How many of the ${n} matched students scored in each band, before and after.`}
                  legend={[LEGEND_PRE, LEGEND_POST]}
                  summary="Grouped bar chart of the number of matched students in each score band at baseline and at final."
                  table={{
                    caption: 'Matched students per score band',
                    columns: ['Score band (%)', 'Baseline', 'Final'],
                    rows: d.scoreDistribution.map((b) => [b.bucket, b.pre, b.post]),
                  }}
                  footnote={`n = ${n} matched`}
                >
                  <ScoreDistributionChart data={d.scoreDistribution} />
                </Figure>
              </div>
            </div>
          </Section>
        )}

        {/* 03 — Participation */}
        <Section
          number="03"
          title="Participation"
          aside="From enrolment to a matched pair. Each step can only use students who completed the one before it."
        >
          <div
            className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4"
            data-testid="kpi-participation"
          >
            <Metric
              label="Student records"
              value={kpis.totalStudentRecords}
              unit="count"
              help="Unique pseudonymous students with a current enrollment in the cohorts in scope. A student in two cohorts counts once. Ended enrollments and students who withdrew are left out. No names are stored."
            />
            <Metric
              label="Enrolled"
              value={kpis.enrolledStudents}
              unit="count"
              help="Enrolled seats in the cohorts matching your filters. A student enrolled in two cohorts counts twice. Students who withdrew are left out."
            />
            <Metric label="Pre completions" value={kpis.preCompletions} unit="count" />
            <Metric label="Post completions" value={kpis.postCompletions} unit="count" />
            <Metric
              className="border-t border-rule pt-4"
              label="Retention completions"
              value={kpis.retentionCompletions}
              unit="count"
            />
            <Metric
              className="border-t border-rule pt-4"
              label="Completion rate"
              value={kpis.completionRate}
              unit="percent"
              emptyText="Not available"
              help="Post completions ÷ enrolled seats. Students who withdrew are left out of both."
            />
            <Metric
              className="border-t border-rule pt-4"
              label="Match rate"
              value={kpis.matchRate}
              unit="percent"
              emptyText="Not available"
              help="Matched pairs ÷ pre completions. A low match rate means many students who started did not complete a post-assessment."
            />
            <div className="border-t border-rule pt-4">
              <p className="metric-label">Pre → post → matched</p>
              <p className="t-num mt-2 text-sm leading-relaxed text-ink">
                {fmtInt(kpis.preCompletions)} → {fmtInt(kpis.postCompletions)} →{' '}
                {fmtInt(kpis.matchedPairs)}
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-x-8 gap-y-10 xl:grid-cols-2">
            <Figure
              title="Completions by month"
              description="Pre- and post-assessments submitted each month."
              legend={[
                { ...LEGEND_PRE, label: 'Pre completions' },
                { ...LEGEND_POST, label: 'Post completions' },
              ]}
              summary="Bar chart of pre and post completions per month."
              table={{
                caption: 'Completions by month',
                columns: ['Month', 'Pre', 'Post', 'Matched'],
                rows: d.trend.map((p) => [
                  fmtMonth(p.period),
                  p.preCompletions,
                  p.postCompletions,
                  p.matched,
                ]),
              }}
            >
              {d.trend.length > 0 ? (
                <CompletionsTrendChart data={d.trend} />
              ) : (
                <EmptyState title="No completions in this period" />
              )}
            </Figure>
            <Figure
              title="Average change by month"
              description="Mean change (pts) for matched pairs whose post-assessment fell in each month. Months with few pairs can swing widely."
              summary={trendSummary(d.trend)}
              table={{
                caption: 'Average change by month',
                columns: ['Month', 'Matched (n)', 'Average change (pts)'],
                rows: d.trend.map((p) => [
                  fmtMonth(p.period),
                  p.matched,
                  fmtPts(p.averageChangePoints),
                ]),
              }}
            >
              {d.trend.some((p) => p.averageChangePoints !== null) ? (
                <ChangeTrendChart data={d.trend} />
              ) : (
                <EmptyState title="No matched pairs in this period" />
              )}
            </Figure>
          </div>
        </Section>

        {/* 04 — Cohorts */}
        <Section
          number="04"
          title="Cohort comparison"
          aside="Cohorts differ in age, format and starting point, so compare with care — this is not a ranking."
        >
          {d.cohorts.length === 0 ? (
            <EmptyState title="No cohorts match these filters" />
          ) : (
            <Table
              stack
              caption="Cohort comparison of matched pre/post results"
              rows={d.cohorts}
              rowKey={(r) => r.cohortId}
              columns={cohortCols}
              footnote={`Averages are over matched students only. Cohorts with fewer than ${t} matched students are flagged and are hidden in exports and printed reports.`}
            />
          )}
        </Section>

        {/* 05 — Retention and (separately) self-reported confidence */}
        <Section
          number="05"
          title="Also measured"
          aside="Retention is a measured score. Confidence is self-reported and is never part of a score."
        >
          <div className="grid gap-x-10 gap-y-10 xl:grid-cols-2">
            <section aria-labelledby="ret-h">
              <h3 id="ret-h" className="t-h4">
                Retention
              </h3>
              <p className="t-caption mb-4 mt-0.5">
                Matched students who also completed a later retention check.
              </p>
              {m.retention && m.retention.n > 0 ? (
                <div
                  className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3"
                  data-testid="retention"
                >
                  <Metric
                    label="Final (post)"
                    value={m.retention.averagePost}
                    unit="score"
                    n={m.retention.n}
                    nLabel="with retention"
                  />
                  <Metric
                    label="Retention check"
                    value={m.retention.averageRetention}
                    unit="score"
                    n={m.retention.n}
                    nLabel="with retention"
                  />
                  <Metric
                    label="Retention − final"
                    value={
                      m.retention.averagePost !== null && m.retention.averageRetention !== null
                        ? m.retention.averageRetention - m.retention.averagePost
                        : null
                    }
                    unit="points"
                    n={m.retention.n}
                    nLabel="with retention"
                    help="Difference between the retention average and the post average for the same students, in percentage points."
                  />
                  <div className="col-span-full">
                    <SmallN n={m.retention.n} threshold={t} />
                  </div>
                </div>
              ) : (
                <EmptyState title="No retention data yet">
                  Retention appears once matched students complete a RETENTION session.
                </EmptyState>
              )}
            </section>

            {/* Deliberately separate and visually distinct: sage = neutral reference, not a score */}
            <section
              aria-labelledby="conf-h"
              className="border-l-4 border-sage bg-sheet p-4 sm:p-5"
              data-testid="confidence-panel"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="conf-h" className="t-h4">
                  Self-reported confidence
                </h3>
                <Badge>Not a skill measure</Badge>
              </div>
              <p className="t-caption mb-4 mt-1">
                Students rate how confident they feel on a 1–5 scale. This is their own perception —
                it is reported separately and is never part of a score.
              </p>
              {m.confidence && m.confidence.n > 0 ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                  <Metric
                    label="Before (1–5)"
                    value={m.confidence.averagePre}
                    unit="plain"
                    n={m.confidence.n}
                    nLabel="responded"
                  />
                  <Metric
                    label="After (1–5)"
                    value={m.confidence.averagePost}
                    unit="plain"
                    n={m.confidence.n}
                    nLabel="responded"
                  />
                  <Metric
                    label="Difference (scale points)"
                    value={
                      m.confidence.averagePre !== null && m.confidence.averagePost !== null
                        ? m.confidence.averagePost - m.confidence.averagePre
                        : null
                    }
                    unit="plain"
                    n={m.confidence.n}
                    nLabel="responded"
                  />
                </div>
              ) : (
                <p className="t-small font-semibold text-ink-2">
                  No confidence responses for these filters.
                </p>
              )}
            </section>
          </div>
        </Section>

        {/* 06 — How to read + the reporting workflow */}
        <Section
          number="06"
          title="How to read these results"
          aside="These limits travel with every export, printed report and AI draft."
        >
          <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <LimitationsPanel limitations={d.limitations} threshold={t} />
            {can('reports.ai') && (
              <aside
                aria-labelledby="ai-cta-h"
                className="block-ink on-ink no-print self-start p-5 sm:p-6"
                data-testid="ai-panel"
              >
                <p className="font-mono text-[0.8125rem] uppercase tracking-[0.06em] text-[#c9c5ba]">
                  AI reporting
                </p>
                <h3 id="ai-cta-h" className="t-h3 mt-2">
                  Turn these numbers into a narrative
                </h3>
                <p className="t-small mt-2 text-[#e4e0d6]">
                  Drafts a grant, board or donor summary from the aggregate metrics for the filters
                  you’ve chosen. Every figure is checked against the data. The dashboard never
                  depends on it.
                </p>
                <ButtonLink
                  to={`/admin/reports${suffix}`}
                  className="mt-5"
                  iconRight={<ArrowRight size={18} aria-hidden="true" />}
                >
                  Draft a report from these filters
                </ButtonLink>
              </aside>
            )}
          </div>
        </Section>

        {/* 07 — Recent activity (participation counts only) */}
        <Section
          number="07"
          title="Recent activity"
          aside="The latest assessment sessions in scope. Participation counts only — no scores."
        >
          <RecentActivity items={recent} />
        </Section>
      </div>
    </>
  );
}
