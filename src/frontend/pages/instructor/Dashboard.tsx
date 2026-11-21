import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarPlus } from 'lucide-react';
import clsx from 'clsx';
import type { AssessmentSessionDto, CohortDto, ProgramDto } from '@shared/api';
import type { AssessmentStage } from '@shared/types';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Meter,
  PageHeader,
  Section,
  SegmentedControl,
  Table,
} from '@frontend/components/ui';
import { SessionStatusBadge, StageBadge } from '@frontend/components/StatusBadges';
import { useQuery } from '@frontend/hooks/useApi';
import { useStaff } from '@frontend/hooks/contexts';
import { api, errorMessage } from '@frontend/services/api';
import { fmtDate, titleCase } from '@frontend/lib/format';

type StatusFilter = 'all' | 'open' | 'scheduled' | 'closed';
const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'closed', label: 'Closed' },
];

/** The colour code on a row's left edge: blue = pre, red = post, sage = retention. */
const STAGE_EDGE: Record<AssessmentStage, string> = {
  PRE: 'border-l-blue',
  POST: 'border-l-red',
  RETENTION: 'border-l-sage',
  PRACTICE: 'border-l-ink',
};

function OpenSessionRow({ s }: { s: AssessmentSessionDto }) {
  return (
    <li
      className={clsx(
        'grid gap-x-6 gap-y-3 border-b border-l-4 border-b-rule bg-sheet py-4 pl-4 pr-4 md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_auto] md:items-center',
        STAGE_EDGE[s.stage],
      )}
    >
      <div className="min-w-0">
        <p className="mb-1">
          <StageBadge stage={s.stage} />
        </p>
        <h3 className="t-h4 break-words">
          <Link to={`/instructor/sessions/${s.id}`} className="link !text-ink">
            {s.title}
          </Link>
        </h3>
        <p className="t-small mt-0.5 text-ink-2">{s.cohortName}</p>
      </div>
      <div>
        <p className="t-num mb-1 text-sm">
          {s.submittedCount} of {s.enrolledCount} submitted
        </p>
        <Meter
          value={s.submittedCount}
          max={s.enrolledCount}
          label={`${s.title}: ${s.submittedCount} of ${s.enrolledCount} submitted (open now)`}
        />
      </div>
      <ButtonLink
        to={`/instructor/sessions/${s.id}`}
        aria-label={`Live progress for ${s.title}`}
        iconRight={<ArrowRight size={16} aria-hidden="true" />}
      >
        Live progress
      </ButtonLink>
    </li>
  );
}

const ROW_CAP = 8;

export default function InstructorDashboard() {
  const { staff } = useStaff();
  const [filter, setFilter] = useState<StatusFilter>('all');
  // Long lists are capped per status view; "Show N more" reveals the rest.
  const [showAll, setShowAll] = useState(false);
  const programs = useQuery('i-programs', (s) =>
    api.page<ProgramDto>('/instructor/programs', undefined, s),
  );
  const cohorts = useQuery('i-cohorts', (s) =>
    api.page<CohortDto>('/instructor/cohorts', undefined, s),
  );
  const sessions = useQuery('i-sessions', (s) =>
    api.page<AssessmentSessionDto>('/instructor/assessment-sessions', undefined, s),
  );

  const all = [...(sessions.data?.items ?? [])].sort((a, b) => {
    const rank = (x: AssessmentSessionDto) =>
      x.status === 'open' ? 0 : x.status === 'scheduled' ? 1 : 2;
    return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
  });
  const openNow = all.filter((s) => s.status === 'open');
  const sessionRows = all.filter((s) => filter === 'all' || s.status === filter);
  const visibleRows = showAll ? sessionRows : sessionRows.slice(0, ROW_CAP);
  const hiddenCount = sessionRows.length - visibleRows.length;
  const cohortItems = cohorts.data?.items ?? [];
  const programItems = programs.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Sessions & cohorts"
        description={`Welcome${staff ? `, ${staff.displayName}` : ''}. Open an assessment for your class, hand out access cards and watch completion in real time.`}
        actions={
          <ButtonLink
            to="/instructor/sessions/new"
            variant="primary"
            icon={<CalendarPlus size={18} aria-hidden="true" />}
          >
            New session
          </ButtonLink>
        }
      />

      <Section
        number="01"
        title="Open now"
        aside={
          sessions.data
            ? `${openNow.length} ${openNow.length === 1 ? 'session is' : 'sessions are'} open. Students in these cohorts can start right away.`
            : 'Sessions students can take right now.'
        }
      >
        {sessions.loading ? (
          <LoadingBlock />
        ) : sessions.error ? (
          <ErrorState message={errorMessage(sessions.error)} onRetry={sessions.refetch} />
        ) : openNow.length === 0 ? (
          <EmptyState title="Nothing is open">
            Create a session, or reopen one from the list below, when your class is ready to start.
          </EmptyState>
        ) : (
          <ul className="border-t-2 border-ink">
            {openNow.map((s) => (
              <OpenSessionRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        number="02"
        title="All sessions"
        aside="Open sessions first, then scheduled, then closed. Select one to see progress by seat."
      >
        {sessions.loading ? (
          <LoadingBlock />
        ) : sessions.error ? (
          <ErrorState message={errorMessage(sessions.error)} onRetry={sessions.refetch} />
        ) : all.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            action={
              <ButtonLink to="/instructor/sessions/new">Create your first session</ButtonLink>
            }
          >
            A session opens one assessment for one cohort — for example the pre-assessment on day
            one.
          </EmptyState>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                label="Filter sessions by status"
                items={FILTERS}
                value={filter}
                onChange={(v) => {
                  setFilter(v);
                  setShowAll(false);
                }}
              />
              <p className="t-caption t-num" role="status">
                Showing {visibleRows.length} of {sessionRows.length}
                {filter === 'all' ? '' : ` ${filter}`} sessions
              </p>
            </div>
            {sessionRows.length === 0 ? (
              <EmptyState title={`No ${filter} sessions`}>
                Choose another status to see the rest.
              </EmptyState>
            ) : (
              <Table
                stack
                caption="Recent assessment sessions"
                rows={visibleRows}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'title',
                    header: 'Session',
                    rowHeader: true,
                    className: 'md:w-[38%] md:min-w-72',
                    cell: (r) => (
                      <Link to={`/instructor/sessions/${r.id}`} className="link">
                        {r.title}
                      </Link>
                    ),
                  },
                  {
                    key: 'cohort',
                    header: 'Cohort',
                    className: 'md:w-[18%]',
                    cell: (r) => <span className="line-clamp-2">{r.cohortName}</span>,
                  },
                  { key: 'stage', header: 'Stage', cell: (r) => <StageBadge stage={r.stage} /> },
                  {
                    key: 'status',
                    header: 'Status',
                    cell: (r) => <SessionStatusBadge status={r.status} />,
                  },
                  {
                    key: 'progress',
                    header: 'Submitted',
                    cell: (r) => (
                      <div className="flex min-w-40 items-center gap-3">
                        <span className="t-num w-16 flex-none whitespace-nowrap text-sm">
                          {r.submittedCount} of {r.enrolledCount}
                        </span>
                        <Meter
                          className="flex-1"
                          value={r.submittedCount}
                          max={r.enrolledCount}
                          label={`${r.title}: ${r.submittedCount} of ${r.enrolledCount} submitted`}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'created',
                    header: 'Created',
                    numeric: true,
                    cell: (r) => fmtDate(r.createdAt),
                  },
                ]}
              />
            )}
            {hiddenCount > 0 && (
              <div className="mt-4">
                <Button onClick={() => setShowAll(true)}>Show {hiddenCount} more</Button>
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        number="03"
        title="Your cohorts"
        aside="Rosters use seat numbers and public codes only — never names."
      >
        {cohorts.loading ? (
          <LoadingBlock />
        ) : cohorts.error ? (
          <ErrorState message={errorMessage(cohorts.error)} onRetry={cohorts.refetch} />
        ) : cohortItems.length === 0 ? (
          <EmptyState title="No cohorts assigned">
            Ask an administrator to assign you to a program.
          </EmptyState>
        ) : (
          <ul className="border-t-2 border-ink">
            {cohortItems.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/instructor/cohorts/${c.id}`}
                  className="row-link sm:grid-cols-[minmax(0,1fr)_auto_6.5rem_auto]"
                >
                  <span className="min-w-0">
                    <span className="row-link-title block break-words font-semibold">{c.name}</span>
                    <span className="t-small block text-ink-2">
                      {c.programName} · {c.courseName}
                    </span>
                  </span>
                  <span>
                    <Badge tone={c.status === 'active' ? 'good' : 'neutral'}>
                      {titleCase(c.status)}
                    </Badge>
                  </span>
                  <span className="t-num text-sm sm:text-right">{c.enrolledCount} enrolled</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    Roster & cards
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section number="04" title="Programs" aside="Programs you are assigned to teach.">
        {programs.loading ? (
          <LoadingBlock />
        ) : programs.error ? (
          <ErrorState message={errorMessage(programs.error)} onRetry={programs.refetch} />
        ) : programItems.length === 0 ? (
          <EmptyState title="No programs assigned yet">
            An administrator assigns instructors to programs.
          </EmptyState>
        ) : (
          <ul className="max-w-2xl border-t border-ink">
            {programItems.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule py-3"
              >
                <span className="font-semibold">{p.name}</span>
                <span className="t-small text-ink-2">
                  {titleCase(p.format)} ·{' '}
                  <span className="t-num">
                    {p.cohortCount} {p.cohortCount === 1 ? 'cohort' : 'cohorts'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
