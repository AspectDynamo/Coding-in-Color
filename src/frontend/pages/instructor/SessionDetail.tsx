import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Copy, DoorClosed, DoorOpen, Download, RefreshCw } from 'lucide-react';
import type { AssessmentSessionDto, SessionProgressDto } from '@shared/api';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingBlock,
  Metric,
  Notice,
  PageHeader,
  Section,
  Table,
  useToast,
} from '@frontend/components/ui';
import {
  SeatStatusBadge,
  SessionStatusBadge,
  StageBadge,
  type SeatStatus,
} from '@frontend/components/StatusBadges';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, downloadCsv, errorMessage } from '@frontend/services/api';
import { copyText } from '@frontend/lib/clipboard';
import { fmtDateTime, fmtDuration } from '@frontend/lib/format';

const SEAT_LEGEND: { status: SeatStatus; label: string }[] = [
  { status: 'submitted', label: 'Submitted' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'not_started', label: 'Not started' },
  { status: 'blocked_consent', label: 'Needs consent' },
];

/**
 * One bar for the whole cohort: submitted (ink) · in progress (yellow) · not started (paper).
 * It is the completion progressbar; the numbers beside it carry the same information as text.
 */
function CompletionBar({ p }: { p: SessionProgressDto }) {
  const total = Math.max(p.enrolled, 1);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex items-center gap-4">
      <div
        role="progressbar"
        aria-label="Completion rate"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.completionRate * 10) / 10}
        aria-valuetext={`${p.submitted} of ${p.enrolled} submitted, ${p.inProgress} in progress, ${p.notStarted} not started`}
        className="flex h-10 min-w-0 flex-1 border-[1.5px] border-ink bg-sheet"
      >
        {p.submitted > 0 && (
          <div
            className="h-full bg-ink transition-[width] duration-300"
            style={{ width: pct(p.submitted) }}
          />
        )}
        {p.inProgress > 0 && (
          <div
            className="h-full border-l border-ink bg-yellow transition-[width] duration-300"
            style={{ width: pct(p.inProgress) }}
          />
        )}
      </div>
      <p className="t-figure flex-none text-[1.5625rem]">
        {Math.round(p.completionRate)}
        <span className="text-base text-ink-2">%</span>
      </p>
    </div>
  );
}

export default function SessionDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [confirm, setConfirm] = useState<'open' | 'closed' | null>(null);
  const [status, setStatus] = useState<AssessmentSessionDto['status'] | null>(null);
  const [exporting, setExporting] = useState(false);

  const q = useQuery(
    `i-progress:${id}`,
    (s) =>
      api.get<SessionProgressDto>(`/instructor/assessment-sessions/${id}/progress`, undefined, s),
    { pollMs: (status ?? 'open') === 'open' ? 10_000 : undefined },
  );
  const p = q.data;
  const current = p?.session.status ?? null;
  if (current !== status && current !== null) setStatus(current);

  const update = useMutation((next: 'open' | 'closed') =>
    api.patch<AssessmentSessionDto>(`/instructor/assessment-sessions/${id}`, { status: next }),
  );

  if (q.loading) return <LoadingBlock label="Loading session…" />;
  if (q.error || !p) {
    return (
      <ErrorState
        title="We couldn’t load this session"
        message={errorMessage(q.error)}
        onRetry={q.refetch}
      />
    );
  }
  const s = p.session;
  const isOpen = s.status === 'open';

  const change = async () => {
    if (!confirm) return;
    try {
      await update.run(confirm);
      toast.success(confirm === 'open' ? 'Session opened.' : 'Session closed.');
      setConfirm(null);
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={s.title}
        back={{ to: '/instructor', label: 'Sessions & cohorts' }}
        eyebrow={
          <span className="flex flex-wrap items-center gap-3 font-sans normal-case tracking-normal">
            <SessionStatusBadge status={s.status} />
            <StageBadge stage={s.stage} />
          </span>
        }
        description={
          <>
            <Link to={`/instructor/cohorts/${s.cohortId}`} className="link">
              {s.cohortName}
            </Link>{' '}
            · {s.programName} · {s.assessmentTitle}
          </>
        }
        actions={
          <>
            {isOpen ? (
              <Button
                variant="danger"
                icon={<DoorClosed size={16} aria-hidden="true" />}
                onClick={() => setConfirm('closed')}
              >
                Close session
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<DoorOpen size={16} aria-hidden="true" />}
                onClick={() => setConfirm('open')}
              >
                {s.status === 'scheduled' ? 'Open now' : 'Reopen session'}
              </Button>
            )}
            <Button
              loading={exporting}
              icon={<Download size={16} aria-hidden="true" />}
              onClick={async () => {
                setExporting(true);
                try {
                  const name = await downloadCsv(
                    `/instructor/assessment-sessions/${id}/export.csv`,
                    undefined,
                    `session-${id.slice(0, 8)}.csv`,
                  );
                  toast.success(`Downloaded ${name}`);
                } catch (e) {
                  toast.error(errorMessage(e));
                } finally {
                  setExporting(false);
                }
              }}
            >
              Export CSV
            </Button>
          </>
        }
      />

      <Section
        number="01"
        title={isOpen ? 'Live progress' : 'Progress'}
        aside={
          <p role="status">
            {isOpen
              ? 'Updates every 10 seconds.'
              : s.status === 'scheduled'
                ? `Opens ${fmtDateTime(s.startsAt)}.`
                : 'Session closed.'}
          </p>
        }
        actions={
          <Button
            size="sm"
            loading={q.fetching}
            icon={<RefreshCw size={15} aria-hidden="true" />}
            onClick={q.refetch}
          >
            Refresh
          </Button>
        }
      >
        <CompletionBar p={p} />
        <ul className="figure-legend mt-2" aria-hidden="true">
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 border-[1.5px] border-ink bg-ink" /> Submitted
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 border-[1.5px] border-ink bg-yellow" /> In progress
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 border-[1.5px] border-ink bg-sheet" /> Not started
          </li>
        </ul>

        <div data-testid="session-stats">
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-ink pt-5 md:grid-cols-4">
            <Metric label="Submitted" value={p.submitted} unit="count" />
            <Metric label="In progress" value={p.inProgress} unit="count" />
            <Metric label="Not started" value={p.notStarted} unit="count" />
            <Metric label="Enrolled" value={p.enrolled} unit="count" />
          </div>
          <div className="mt-6 grid gap-x-6 border-t border-rule md:grid-cols-3">
            <Metric
              size="inline"
              label="Completion"
              value={p.completionRate}
              unit="percent"
              help="Submitted ÷ enrolled."
            />
            <Metric
              size="inline"
              label="Median time (min)"
              value={p.medianDurationSeconds === null ? null : p.medianDurationSeconds / 60}
              unit="plain"
              sub={
                p.medianDurationSeconds === null
                  ? 'No submissions yet'
                  : fmtDuration(p.medianDurationSeconds)
              }
              help="Middle time from start to submit, in minutes."
            />
            <Metric
              size="inline"
              label="Average score"
              value={p.aggregate?.averagePercentage ?? null}
              unit="score"
              n={p.aggregate?.n}
              nLabel="submitted"
              emptyText="Suppressed"
              sub={p.aggregate ? undefined : `n < ${p.suppressionThreshold}`}
              help={`Group average only. Hidden until at least ${p.suppressionThreshold} students have submitted, to protect individuals in small groups.`}
            />
          </div>
        </div>
      </Section>

      <Section
        number="02"
        title="Seats"
        aside="Seat status only. Individual scores are never shown here."
      >
        {p.roster.length === 0 ? (
          <Notice tone="info">
            No students are enrolled in this cohort yet.{' '}
            <Link to={`/instructor/cohorts/${s.cohortId}`} className="link">
              Generate access cards
            </Link>
          </Notice>
        ) : (
          <div className="grid gap-x-6 gap-y-8 xl:grid-cols-12">
            <div className="xl:sticky xl:top-6 xl:col-span-5 xl:self-start">
              {/* The same information as the table beside it, as a picture of the room. */}
              <div className="seat-grid" aria-hidden="true">
                {p.roster.map((r) => (
                  <span
                    key={r.rosterLabel + r.publicCode}
                    className="seat"
                    data-status={r.status}
                    title={`Seat ${r.rosterLabel}`}
                  >
                    {r.rosterLabel}
                  </span>
                ))}
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem] font-semibold text-ink-2">
                {SEAT_LEGEND.map((l) => (
                  <li key={l.status} className="flex items-center gap-2">
                    <span
                      className="seat !aspect-auto h-4 w-4 flex-none !border"
                      data-status={l.status}
                      aria-hidden="true"
                    />
                    {l.label}
                  </li>
                ))}
              </ul>
            </div>
            <Table
              className="xl:col-span-7"
              caption={`Roster status for ${s.title}`}
              rows={p.roster}
              rowKey={(r) => r.rosterLabel + r.publicCode}
              columns={[
                {
                  key: 'seat',
                  header: 'Seat',
                  rowHeader: true,
                  cell: (r) => <span className="t-num">{r.rosterLabel}</span>,
                },
                {
                  key: 'code',
                  header: 'Public code',
                  cell: (r) => <span className="t-mono">{r.publicCode}</span>,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => <SeatStatusBadge status={r.status} />,
                },
              ]}
            />
          </div>
        )}
      </Section>

      <Section
        number="03"
        title="Share remotely"
        aside="For remote sessions: share in chat or read it aloud on a call. Students still need their own access card — the link contains no code."
      >
        <div className="flex max-w-3xl flex-col gap-3 sm:flex-row">
          <input
            className="input t-mono text-sm"
            readOnly
            value={s.joinUrl}
            aria-label="Join link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            icon={<Copy size={16} aria-hidden="true" />}
            onClick={async () => {
              if (await copyText(s.joinUrl)) toast.success('Join link copied.');
              else toast.error('Couldn’t copy. Select the link and copy it manually.');
            }}
          >
            Copy link
          </Button>
        </div>
      </Section>

      <ConfirmDialog
        open={confirm !== null}
        busy={update.loading}
        onClose={() => setConfirm(null)}
        onConfirm={change}
        tone={confirm === 'closed' ? 'danger' : 'primary'}
        title={confirm === 'closed' ? 'Close this session?' : 'Open this session?'}
        description={
          confirm === 'closed'
            ? `Students won’t be able to start or submit. ${p.inProgress > 0 ? `${p.inProgress} ${p.inProgress === 1 ? 'student is' : 'students are'} still working and would lose the chance to submit. ` : ''}You can reopen it later.`
            : 'Students in this cohort will be able to start right away.'
        }
        confirmLabel={confirm === 'closed' ? 'Close session' : 'Open session'}
      />
    </>
  );
}
