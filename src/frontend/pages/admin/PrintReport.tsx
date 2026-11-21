import { useSearchParams } from 'react-router';
import { Printer } from 'lucide-react';
import type { FilterOptions, ImpactDashboard } from '@shared/api';
import { SKILL_LABELS } from '@shared/types';
import {
  Button,
  ErrorState,
  LoadingBlock,
  Notice,
  PageHeader,
  Wordmark,
} from '@frontend/components/ui';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage, type Query } from '@frontend/services/api';
import {
  describeFilters,
  filtersFromParams,
  filtersKey,
  filtersToParams,
} from '@frontend/lib/filters';
import { DASH, fmtDate, fmtInt, fmtNum, fmtPct, fmtPts, fmtSignedPct } from '@frontend/lib/format';

const SUP = '†';

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num text-ink">{value}</td>
      <td className="t-caption">{note}</td>
    </tr>
  );
}

export default function PrintReport() {
  const [params] = useSearchParams();
  const filters = filtersFromParams(params);
  const key = filtersKey(filters);
  // External view: small groups are suppressed server-side before anything reaches this page.
  const query = { ...Object.fromEntries(filtersToParams(filters)), view: 'external' } as Query;
  const q = useQuery(`print?${key}`, (s) => api.get<ImpactDashboard>('/admin/dashboard', query, s));
  const options = useQuery('admin-filters', (s) =>
    api.get<FilterOptions>('/admin/filters', undefined, s),
  );

  const head = (
    <div className="no-print">
      <PageHeader
        title="Printable impact report"
        back={{ to: `/admin${key ? `?${key}` : ''}`, label: 'Impact dashboard' }}
        description="A clean board / grant report for the current filters. Use your browser’s print dialog to print or save as PDF."
        actions={
          <Button
            variant="primary"
            icon={<Printer size={16} aria-hidden="true" />}
            onClick={() => window.print()}
            disabled={!q.data}
          >
            Print / Save as PDF
          </Button>
        }
      />
    </div>
  );

  if (q.loading)
    return (
      <>
        {head}
        <LoadingBlock label="Preparing report…" />
      </>
    );
  if (q.error || !q.data) {
    return (
      <>
        {head}
        <ErrorState
          title="We couldn’t prepare the report"
          message={errorMessage(q.error)}
          onRetry={q.refetch}
        />
      </>
    );
  }

  const d = q.data;
  const m = d.metrics;
  const k = d.kpis;
  const t = d.suppressionThreshold;
  const hidden = m.suppressed === true;
  const scope = describeFilters(filters, options.data);
  /** Suppressed values print as an em dash with a dagger. */
  const sup = (text: string, suppressed: boolean) => (suppressed ? `${DASH} ${SUP}` : text);
  const anySuppressed =
    hidden || d.skills.some((s) => s.suppressed) || d.cohorts.some((c) => c.suppressed);

  return (
    <>
      {head}
      {!d.externalView && (
        <Notice
          tone="warn"
          role="alert"
          className="no-print mb-4"
          title="Suppression could not be confirmed"
        >
          The server did not mark this as the external (suppressed) view. Check small groups before
          sharing.
        </Notice>
      )}
      <article
        className="sheet-ruled print-plain mx-auto max-w-4xl p-5 sm:p-10"
        data-testid="print-report"
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink pb-5">
          <Wordmark sub="Impact report" />
          <p className="t-caption t-num text-right">
            Generated {fmtDate(d.generatedAt)}
            <br />
            Assessment period:{' '}
            {d.assessmentPeriod.from
              ? `${fmtDate(d.assessmentPeriod.from)} – ${fmtDate(d.assessmentPeriod.to)}`
              : 'no post-assessments in scope'}
          </p>
        </header>

        {d.isSyntheticData && (
          <p className="mt-4 inline-block bg-yellow px-2 py-1 text-sm font-semibold text-ink">
            SYNTHETIC DEMO DATA — these figures do not describe real students.
          </p>
        )}

        <h1 className="t-h1 mt-6">Measured learning gains</h1>
        <p className="t-lede mt-3">
          Results from matched pre- and post-assessments.{' '}
          {scope.length === 0
            ? 'Scope: all programs and cohorts.'
            : `Scope: ${scope.map((s) => `${s.label}: ${s.value}`).join(' · ')}.`}
        </p>

        <section className="print-break-avoid mt-10">
          <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">Participation</h2>
          <div className="overflow-x-auto">
            <table className="table">
              <caption className="sr-only">Participation</caption>
              <tbody>
                <Row label="Students enrolled" value={fmtInt(k.enrolledStudents)} />
                <Row label="Pre-assessments completed" value={fmtInt(k.preCompletions)} />
                <Row label="Post-assessments completed" value={fmtInt(k.postCompletions)} />
                <Row
                  label="Retention assessments completed"
                  value={fmtInt(k.retentionCompletions)}
                />
                <Row
                  label="Matched pairs (n)"
                  value={fmtInt(k.matchedPairs)}
                  note="Students with both a pre and a post in the same cohort"
                />
                <Row
                  label="Completion rate"
                  value={fmtPct(k.completionRate)}
                  note="Post completions ÷ enrolled"
                />
                <Row
                  label="Match rate"
                  value={fmtPct(k.matchRate)}
                  note="Matched pairs ÷ pre completions"
                />
              </tbody>
            </table>
          </div>
        </section>

        <section className="print-break-avoid mt-10">
          <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">
            Pre/post results{' '}
            <span className="t-num text-sm font-normal text-ink-2">
              (n = {fmtInt(m.n)} matched)
            </span>
          </h2>
          {!hidden && m.averagePre !== null && m.averagePost !== null && (
            <div
              className="mb-4 grid gap-1.5"
              role="img"
              aria-label={`Average baseline ${fmtPct(m.averagePre)}, average final ${fmtPct(m.averagePost)}, on a 0 to 100 scale`}
            >
              {(
                [
                  ['Baseline', 'bar-pre', m.averagePre],
                  ['Final', 'bar-post', m.averagePost],
                ] as const
              ).map(([label, cls, v]) => (
                <div
                  key={label}
                  className="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-center gap-3"
                >
                  <span className="t-small font-semibold">{label}</span>
                  <span className="block h-5">
                    <span className="bar-track block">
                      <span
                        className={`bar block ${cls}`}
                        style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                      />
                    </span>
                  </span>
                  <span className="t-num text-right text-sm">{fmtPct(v)}</span>
                </div>
              ))}
              <p
                className="t-caption t-num grid grid-cols-[5rem_minmax(0,1fr)_4rem] gap-3"
                aria-hidden="true"
              >
                <span />
                <span className="flex justify-between">
                  <span>0</span>
                  <span>25</span>
                  <span>50</span>
                  <span>75</span>
                  <span>100</span>
                </span>
              </p>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="table">
              <caption className="sr-only">Pre/post results for matched students</caption>
              <tbody>
                <Row label="Average baseline score" value={sup(fmtPct(m.averagePre), hidden)} />
                <Row label="Average final score" value={sup(fmtPct(m.averagePost), hidden)} />
                <Row
                  label="Average change"
                  value={sup(fmtPts(m.averageChangePoints), hidden)}
                  note="Percentage points (final − baseline)"
                />
                <Row
                  label="Relative change"
                  value={
                    hidden
                      ? `${DASH} ${SUP}`
                      : m.relativeChangeUndefined
                        ? 'Undefined (baseline 0)'
                        : fmtSignedPct(m.relativeChangePercent)
                  }
                  note="Percent of the baseline average"
                />
                <Row
                  label="Improved"
                  value={sup(fmtPct(m.improvedPercent), hidden)}
                  note="Final higher than baseline"
                />
                <Row label="Unchanged" value={sup(fmtPct(m.unchangedPercent), hidden)} />
                <Row label="Declined" value={sup(fmtPct(m.declinedPercent), hidden)} />
                <Row
                  label="95% confidence interval of change"
                  value={
                    hidden || !m.changeCi95
                      ? hidden
                        ? `${DASH} ${SUP}`
                        : DASH
                      : `${fmtPts(m.changeCi95.low)} to ${fmtPts(m.changeCi95.high)}`
                  }
                />
                <Row
                  label="Paired effect size (d_z)"
                  value={
                    hidden
                      ? `${DASH} ${SUP}`
                      : m.effectSizeDz === null
                        ? DASH
                        : fmtNum(m.effectSizeDz, 2)
                  }
                />
              </tbody>
            </table>
          </div>
        </section>

        {d.skills.length > 0 && (
          <section className="mt-10">
            <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">Results by skill</h2>
            <div className="overflow-x-auto">
              <table className="table">
                <caption className="sr-only">Baseline and final averages by skill</caption>
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col" className="num">
                      Matched (n)
                    </th>
                    <th scope="col" className="num">
                      Baseline
                    </th>
                    <th scope="col" className="num">
                      Final
                    </th>
                    <th scope="col" className="num">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.skills.map((s) => (
                    <tr key={s.skill} className="print-break-avoid">
                      <th scope="row">{SKILL_LABELS[s.skill]}</th>
                      <td className="num">{s.suppressed ? `< ${t}` : fmtInt(s.n)}</td>
                      <td className="num">{sup(fmtPct(s.averagePre), s.suppressed)}</td>
                      <td className="num">{sup(fmtPct(s.averagePost), s.suppressed)}</td>
                      <td className="num text-ink">
                        {sup(fmtPts(s.averageChangePoints), s.suppressed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {d.cohorts.length > 0 && (
          <section className="mt-10">
            <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">Results by cohort</h2>
            <div className="overflow-x-auto">
              <table className="table">
                <caption className="sr-only">Matched pre/post results by cohort</caption>
                <thead>
                  <tr>
                    <th scope="col">Cohort</th>
                    <th scope="col" className="num">
                      Enrolled
                    </th>
                    <th scope="col" className="num">
                      Matched (n)
                    </th>
                    <th scope="col" className="num">
                      Baseline
                    </th>
                    <th scope="col" className="num">
                      Final
                    </th>
                    <th scope="col" className="num">
                      Change
                    </th>
                    <th scope="col" className="num">
                      Improved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.cohorts.map((c) => (
                    <tr key={c.cohortId} className="print-break-avoid">
                      <td>
                        <span className="font-semibold text-ink">{c.cohortName}</span>
                        <span className="t-caption block">{c.programName}</span>
                      </td>
                      <td className="num">{fmtInt(c.enrolled)}</td>
                      <td className="num">{c.suppressed ? `< ${t}` : fmtInt(c.matched)}</td>
                      <td className="num">{sup(fmtPct(c.averagePre), c.suppressed)}</td>
                      <td className="num">{sup(fmtPct(c.averagePost), c.suppressed)}</td>
                      <td className="num text-ink">
                        {sup(fmtPts(c.averageChangePoints), c.suppressed)}
                      </td>
                      <td className="num">{sup(fmtPct(c.improvedPercent), c.suppressed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {m.retention && m.retention.n > 0 && !hidden && (
          <section className="print-break-avoid mt-10">
            <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">Retention</h2>
            <p className="text-ink-2">
              Among {fmtInt(m.retention.n)} matched students who also completed a retention check,
              the average was {fmtPct(m.retention.averageRetention)} compared with{' '}
              {fmtPct(m.retention.averagePost)} at the end of the program.
            </p>
          </section>
        )}

        {m.confidence && m.confidence.n > 0 && !hidden && (
          <section className="print-break-avoid mt-10">
            <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">
              Self-reported confidence (not a skill measure)
            </h2>
            <p className="text-ink-2">
              On a 1–5 scale, students’ own confidence rating averaged{' '}
              {fmtNum(m.confidence.averagePre)} before and {fmtNum(m.confidence.averagePost)} after
              (n = {fmtInt(m.confidence.n)}). This is a perception measure and is not part of any
              score.
            </p>
          </section>
        )}

        <section className="print-break-avoid mt-10">
          <h2 className="t-h3 mb-3 border-t-2 border-ink pt-3">Limitations</h2>
          <ul className="list-disc space-y-1 pl-5 text-[0.9375rem] text-ink-2 marker:text-ink">
            {d.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>

        <footer className="t-caption mt-8 space-y-1 border-t border-ink pt-4">
          <p data-testid="suppression-footnote">
            {SUP} Values for groups with fewer than {t} matched students are not shown, to reduce
            the chance of identifying individuals
            {anySuppressed ? '' : ' (no groups were suppressed in this report)'}. This is a
            protective default, not a legal de-identification guarantee.
          </p>
          <p>
            “pts” are percentage points (final − baseline). “%” values are shares of students or
            scores out of 100.
          </p>
          <p>
            Students are identified only by pseudonymous codes. No names, emails or birthdates are
            collected.
          </p>
        </footer>
      </article>
    </>
  );
}
