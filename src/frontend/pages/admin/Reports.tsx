import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { BookmarkPlus, Copy, Printer, RefreshCw } from 'lucide-react';
import type { AiReportDto, DashboardFilters, FilterOptions, ImpactDashboard } from '@shared/api';
import { REPORT_TYPES, REPORT_TYPE_LABELS, type ReportType } from '@shared/types';
import {
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  PageHeader,
  Pagination,
  Section,
  Select,
  Skeleton,
  Spinner,
  Table,
  useToast,
} from '@frontend/components/ui';
import { FilterBar } from '@frontend/components/FilterBar';
import { ReportView } from '@frontend/components/ReportView';
import { reportToText } from '@frontend/components/report-text';
import { useConfig, useStaff } from '@frontend/hooks/contexts';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage, isApiError, type Query } from '@frontend/services/api';
import { copyText } from '@frontend/lib/clipboard';
import {
  describeFilters,
  filtersFromParams,
  filtersKey,
  filtersToParams,
} from '@frontend/lib/filters';
import { fmtDate, fmtDateTime, fmtInt, fmtPct, fmtPts } from '@frontend/lib/format';

const LIMIT = 20;
type Status = 'idle' | 'generating' | 'done' | 'error';

/** The verified numbers a narrative is written from — shown as data, never as prose. */
function SourceMetrics({ d }: { d: ImpactDashboard }) {
  const m = d.metrics;
  const rows: [string, string][] = [
    ['Matched students (n)', fmtInt(m.n)],
    ['Average baseline', fmtPct(m.averagePre)],
    ['Average final', fmtPct(m.averagePost)],
    ['Average change', fmtPts(m.averageChangePoints)],
    ['Improved', fmtPct(m.improvedPercent)],
    ['Completion rate', fmtPct(d.kpis.completionRate)],
    ['Match rate', fmtPct(d.kpis.matchRate)],
    [
      'Assessment period',
      d.assessmentPeriod.from
        ? `${fmtDate(d.assessmentPeriod.from)} – ${fmtDate(d.assessmentPeriod.to)}`
        : 'No post-assessments yet',
    ],
  ];
  return (
    <dl className="border-t border-ink">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-4 border-b border-rule py-2"
        >
          <dt className="t-small text-ink-2">{k}</dt>
          <dd className="t-num text-right text-[0.9375rem] text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Reports() {
  const toast = useToast();
  const { config } = useConfig();
  const { can } = useStaff();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const key = filtersKey(filters);
  const query = Object.fromEntries(filtersToParams(filters)) as Query;
  const setFilters = (next: DashboardFilters) => setParams(filtersToParams(next));

  /* ---- context + verified source metrics ---- */
  const options = useQuery('admin-filters', (s) =>
    api.get<FilterOptions>('/admin/filters', undefined, s),
  );
  const canSeeMetrics = can('dashboard.view');
  const source = useQuery(
    canSeeMetrics ? `dashboard?${key}` : null,
    (s) => api.get<ImpactDashboard>('/admin/dashboard', query, s),
    { keepPrevious: true },
  );
  const scope = describeFilters(filters, options.data);

  /* ---- generate ---- */
  const [reportType, setReportType] = useState<ReportType>('program_impact');
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<AiReportDto | null>(null);
  const [reportKey, setReportKey] = useState('');
  const [fellBack, setFellBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ack, setAck] = useState(false);

  /* ---- saved reports ---- */
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<AiReportDto | null>(null);
  const [del, setDel] = useState<AiReportDto | null>(null);
  const saved = useQuery(
    `reports:${offset}`,
    (s) => api.page<AiReportDto>('/admin/reports', { limit: LIMIT, offset }, s),
    { keepPrevious: true },
  );
  const remove = useMutation((id: string) => api.delete<{ ok: true }>(`/admin/reports/${id}`));

  const generate = async () => {
    setStatus('generating');
    setError(null);
    setFellBack(false);
    setAck(false);
    try {
      const r = await api.post<AiReportDto>('/admin/reports/summarize', { reportType, filters });
      setReport(r);
      setReportKey(key);
      setStatus('done');
    } catch (e) {
      const fallback = isApiError(e, 'ai_unavailable')
        ? (e.details as { fallback?: AiReportDto } | undefined)?.fallback
        : undefined;
      if (fallback) {
        setReport(fallback);
        setReportKey(key);
        setFellBack(true);
        setStatus('done');
      } else {
        setError(
          isApiError(e, 'rate_limited')
            ? 'You’ve generated several summaries in a row. Wait a minute, then try again.'
            : errorMessage(e),
        );
        setStatus('error');
      }
    }
  };

  const save = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const r = await api.post<AiReportDto>(`/admin/reports/${report.id}/save`);
      setReport(r);
      toast.success('Report saved. Find it under Saved reports on this page.');
      saved.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (r: AiReportDto) => {
    if (await copyText(reportToText(r))) toast.success('Report text copied.');
    else toast.error('Couldn’t copy to the clipboard.');
  };
  const stale = report !== null && reportKey !== key;

  return (
    <>
      <PageHeader
        title="AI reporting"
        description="An analytical writing assistant. Choose the scope, check the verified source metrics, then generate a narrative draft you can review, copy and save. It only ever sees aggregate numbers."
      />

      <FilterBar
        filters={filters}
        options={options.data}
        onChange={setFilters}
        busy={source.loading && !!source.data}
      />

      {/* 01 — Context */}
      <Section
        className="!mt-6"
        number="01"
        title="Report context"
        aside="The scope above is sent with the request. The draft is written for exactly these filters."
      >
        {config && !config.aiEnabled && (
          <Notice tone="info" className="mb-4">
            AI is switched off in this environment, so summaries use the built-in template narrative
            instead.
          </Notice>
        )}
        <div className="grid gap-x-8 gap-y-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <p className="field-label">Scope</p>
            {scope.length === 0 ? (
              <p className="text-ink-2">All programs, all cohorts, all dates.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {scope.map((s) => (
                  <li key={s.label}>
                    <Badge>
                      {s.label}: {s.value}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              label="Report type"
              wrapperClassName="min-w-0 flex-1"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              disabled={status === 'generating'}
            >
              {REPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REPORT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              loading={status === 'generating'}
              onClick={() => void generate()}
              icon={report ? <RefreshCw size={16} aria-hidden="true" /> : undefined}
            >
              {report ? 'Regenerate' : 'Generate AI Impact Summary'}
            </Button>
          </div>
        </div>
      </Section>

      {/* 02 — Source (verified) beside draft (generated) */}
      <Section
        number="02"
        title="Source and draft"
        aside="Left: numbers measured by the platform. Right: text written from them. They are never mixed on one surface."
      >
        <div className="grid gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <section aria-labelledby="src-h">
            <h3 id="src-h" className="t-h4 mb-1">
              Verified source metrics
            </h3>
            <p className="t-caption mb-3">Calculated from matched pre/post pairs for this scope.</p>
            {!canSeeMetrics ? (
              <p className="t-small text-ink-2">
                Your role can generate reports but not view the dashboard metrics. The exact data
                sent is shown inside each draft.
              </p>
            ) : source.data ? (
              <SourceMetrics d={source.data} />
            ) : source.error ? (
              <ErrorState message={errorMessage(source.error)} onRetry={source.refetch} />
            ) : (
              <LoadingBlock label="Loading source metrics…">
                <Skeleton lines={6} />
              </LoadingBlock>
            )}
            {source.data?.isSyntheticData && (
              <p className="mt-3">
                <Badge tone="warn">Synthetic demo data</Badge>
              </p>
            )}
          </section>

          <section aria-labelledby="draft-h" className="min-w-0">
            <h3 id="draft-h" className="t-h4 mb-3">
              Narrative draft
            </h3>
            <div aria-live="polite">
              {status === 'generating' && (
                <div className="ai-sheet flex items-center gap-3 p-4" data-testid="ai-status">
                  <Spinner size={20} />
                  <p className="t-small font-semibold">
                    Writing the summary from aggregate metrics… this can take up to half a minute.
                  </p>
                </div>
              )}
              {status === 'error' && error && (
                <Notice tone="bad" role="alert" title="We couldn’t generate a summary">
                  {error}
                </Notice>
              )}
            </div>
            {!report && status !== 'generating' && status !== 'error' && (
              <EmptyState title="No draft yet">
                Choose a report type and generate. The draft will appear here, labelled with how it
                was written, with its key findings, recommendations and limitations.
              </EmptyState>
            )}

            {report && status !== 'generating' && (
              <div className="space-y-5">
                {stale && (
                  <Notice tone="warn" role="status" title="The scope has changed since this draft">
                    This draft was written for different filters than the source metrics now shown.
                    Regenerate to bring them back in line.
                  </Notice>
                )}
                {fellBack && (
                  <Notice
                    tone="warn"
                    role="status"
                    title="AI was unavailable — showing the template narrative"
                    data-testid="ai-fallback-notice"
                  >
                    The AI service didn’t respond or returned something we couldn’t validate. This
                    version is built by a fixed template from the same numbers, so it is safe to
                    use. You can try regenerating later.
                  </Notice>
                )}
                <ReportView report={report} />
                {!report.validation.passed && !report.saved && (
                  <div className="notice notice-warn" data-testid="ai-ack">
                    <Checkbox
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      label="I have checked the flagged numbers against the dashboard"
                      hint="Required before saving: this draft contains figures the number check could not trace to the data that was sent."
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    icon={<BookmarkPlus size={16} aria-hidden="true" />}
                    onClick={() => void save()}
                    loading={saving}
                    disabled={report.saved || (!report.validation.passed && !ack)}
                  >
                    {report.saved ? 'Saved' : 'Save report'}
                  </Button>
                  <Button
                    icon={<Copy size={16} aria-hidden="true" />}
                    onClick={() => void copy(report)}
                  >
                    Copy text
                  </Button>
                  {can('reports.export') && (
                    <ButtonLink
                      to={`/admin/reports/print${key ? `?${key}` : ''}`}
                      icon={<Printer size={16} aria-hidden="true" />}
                    >
                      Printable metrics report
                    </ButtonLink>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </Section>

      {/* 03 — Saved */}
      <Section
        number="03"
        title="Saved reports"
        aside="Each saved report keeps the exact aggregate data it was written from."
      >
        {saved.loading && !saved.data ? (
          <LoadingBlock />
        ) : saved.error ? (
          <ErrorState message={errorMessage(saved.error)} onRetry={saved.refetch} />
        ) : saved.data!.items.length === 0 ? (
          <EmptyState title="No saved reports yet">
            Generate a draft above, then choose “Save report”.
          </EmptyState>
        ) : (
          <>
            <Table
              stack
              caption="Saved reports"
              rows={saved.data!.items}
              rowKey={(r) => r.id}
              columns={[
                { key: 'h', header: 'Headline', rowHeader: true, cell: (r) => r.content.headline },
                { key: 't', header: 'Type', cell: (r) => REPORT_TYPE_LABELS[r.reportType] },
                {
                  key: 'm',
                  header: 'Written by',
                  cell: (r) => (
                    <span>
                      {r.generationMode === 'ai' ? (
                        <Badge tone="info">AI-generated</Badge>
                      ) : (
                        <Badge>Template</Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'c',
                  header: 'Created',
                  cell: (r) => (
                    <span>
                      <span className="t-num">{fmtDateTime(r.createdAt)}</span>
                      {r.createdBy ? ` · ${r.createdBy}` : ''}
                    </span>
                  ),
                },
                {
                  key: 'a',
                  header: <span className="sr-only">Actions</span>,
                  cell: (r) => (
                    <span className="flex gap-2 md:justify-end">
                      <Button
                        size="sm"
                        onClick={() => setView(r)}
                        aria-label={`View report: ${r.content.headline}`}
                      >
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => setDel(r)}
                        aria-label={`Delete report: ${r.content.headline}`}
                      >
                        Delete
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
            <Pagination page={saved.data!.page} onChange={setOffset} />
          </>
        )}
      </Section>

      <Dialog
        open={view !== null}
        onClose={() => setView(null)}
        title="Saved report"
        size="lg"
        footer={
          <>
            <Button
              icon={<Copy size={16} aria-hidden="true" />}
              onClick={() => view && void copy(view)}
            >
              Copy text
            </Button>
            <Button onClick={() => setView(null)}>Close</Button>
          </>
        }
      >
        {view && <ReportView report={view} />}
      </Dialog>

      <ConfirmDialog
        open={del !== null}
        busy={remove.loading}
        onClose={() => setDel(null)}
        tone="danger"
        title="Delete this report?"
        description={
          del ? `“${del.content.headline}” will be removed for everyone. This can’t be undone.` : ''
        }
        confirmLabel="Delete report"
        onConfirm={async () => {
          if (!del) return;
          try {
            await remove.run(del.id);
            toast.success('Report deleted.');
            setDel(null);
            saved.refetch();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
