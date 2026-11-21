import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CalendarPlus, CreditCard, RotateCcw } from 'lucide-react';
import type {
  AssessmentSessionDto,
  CohortDto,
  IssuedCredential,
  RosterEntryDto,
} from '@shared/api';
import { AGE_BANDS, type AgeBand } from '@shared/types';
import {
  Badge,
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  ErrorState,
  Fieldset,
  Input,
  LoadingBlock,
  Metric,
  Notice,
  PageHeader,
  Radio,
  Section,
  Select,
  Table,
  useToast,
} from '@frontend/components/ui';
import {
  ConsentBadge,
  SessionStatusBadge,
  StageBadge,
  StudentStatusBadge,
} from '@frontend/components/StatusBadges';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { useConfig, useIssuedCards, useStaff } from '@frontend/hooks/contexts';
import { api, errorMessage } from '@frontend/services/api';
import { AGE_BAND_LABELS, fmtDate, titleCase } from '@frontend/lib/format';

const REASONS = [
  { value: 'lost', label: 'Card was lost' },
  { value: 'damaged', label: 'Card is damaged or unreadable' },
  { value: 'compromised', label: 'Someone else may have seen the code' },
  { value: 'other', label: 'Other' },
] as const;
type Reason = (typeof REASONS)[number]['value'];

export default function CohortDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { config } = useConfig();
  const { can } = useStaff();
  const { cards, setCards } = useIssuedCards();

  const cohorts = useQuery('i-cohorts', (s) =>
    api.page<CohortDto>('/instructor/cohorts', undefined, s),
  );
  const roster = useQuery(`i-roster:${id}`, (s) =>
    api.page<RosterEntryDto>(`/instructor/cohorts/${id}/roster`, undefined, s),
  );
  const sessions = useQuery(`i-sessions:${id}`, (s) =>
    api.page<AssessmentSessionDto>('/instructor/assessment-sessions', { cohortId: id }, s),
  );

  const [issueOpen, setIssueOpen] = useState(false);
  const [count, setCount] = useState('10');
  const [ageBand, setAgeBand] = useState<AgeBand>('AGE_13_17');
  const [issueError, setIssueError] = useState<string | null>(null);
  const [reissue, setReissue] = useState<RosterEntryDto | null>(null);
  const [reason, setReason] = useState<Reason>('lost');

  const issue = useMutation((body: { cohortId: string; count: number; ageBand: AgeBand }) =>
    api.post<IssuedCredential[]>('/instructor/student-credentials', body),
  );
  const reissueM = useMutation((body: { cohortId: string; rosterLabel: string; reason: Reason }) =>
    api.post<IssuedCredential | IssuedCredential[]>(
      '/instructor/student-credentials/reissue',
      body,
    ),
  );

  const cohort = cohorts.data?.items.find((c) => c.id === id);
  const under13Off = config ? !config.under13RegistrationEnabled : true;
  const canIssue = can('credentials.issue');

  if (cohorts.loading) return <LoadingBlock label="Loading cohort…" />;
  if (cohorts.error) {
    return <ErrorState message={errorMessage(cohorts.error)} onRetry={cohorts.refetch} />;
  }
  if (!cohort) {
    return (
      <EmptyState
        title="Cohort not found"
        action={<ButtonLink to="/instructor">Back to sessions & cohorts</ButtonLink>}
      >
        It may not exist, or it isn’t in one of your assigned programs.
      </EmptyState>
    );
  }

  const seats = roster.data?.items ?? [];
  const activeCards = seats.filter((r) => r.hasActiveCredential).length;
  const waiting = seats.filter((r) => r.status === 'pending_consent').length;

  const n = Number(count);
  const countValid = Number.isInteger(n) && n >= 1 && n <= 60;

  const doIssue = async () => {
    setIssueError(null);
    if (!countValid) {
      setIssueError('Enter a whole number from 1 to 60.');
      return;
    }
    try {
      const issued = await issue.run({ cohortId: id, count: n, ageBand });
      setCards(issued);
      setIssueOpen(false);
      toast.success(
        `${issued.length} access ${issued.length === 1 ? 'card' : 'cards'} ready to print.`,
      );
      navigate('/instructor/cards');
    } catch (e) {
      setIssueError(errorMessage(e));
    }
  };

  const doReissue = async () => {
    if (!reissue) return;
    try {
      const r = await reissueM.run({ cohortId: id, rosterLabel: reissue.rosterLabel, reason });
      setCards(Array.isArray(r) ? r : [r]);
      setReissue(null);
      toast.success(
        `New card ready for seat ${reissue.rosterLabel}. The old card no longer works.`,
      );
      navigate('/instructor/cards');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={cohort.name}
        back={{ to: '/instructor', label: 'Sessions & cohorts' }}
        eyebrow={`${cohort.programName} · ${cohort.courseName}`}
        description={`${titleCase(cohort.deliveryMode)} · ${fmtDate(cohort.startDate)} – ${fmtDate(cohort.endDate)} · ${cohort.enrolledCount} enrolled${cohort.leadInstructor ? ` · Lead: ${cohort.leadInstructor.displayName}` : ''}`}
        actions={
          <>
            {canIssue && (
              <Button
                variant="primary"
                icon={<CreditCard size={16} aria-hidden="true" />}
                onClick={() => setIssueOpen(true)}
              >
                Generate access cards
              </Button>
            )}
            <ButtonLink
              to={`/instructor/sessions/new?cohortId=${id}`}
              icon={<CalendarPlus size={16} aria-hidden="true" />}
            >
              New session
            </ButtonLink>
          </>
        }
      />

      {cards.length > 0 && (
        <Notice
          tone="warn"
          className="mb-8"
          role="status"
          title={`${cards.length} unprinted ${cards.length === 1 ? 'card is' : 'cards are'} waiting`}
        >
          Codes can’t be shown again after you leave or refresh.{' '}
          <Link to="/instructor/cards" className="link">
            Go to the print sheet
          </Link>
        </Notice>
      )}

      <Section
        number="01"
        title="Roster"
        aside={
          <>
            <p>
              Seats and public codes only. Keep any seat-to-student list on paper, outside this
              system.
            </p>
            {seats.length > 0 && (
              <div className="mt-4 border-t border-rule">
                <Metric size="inline" label="Seats" value={seats.length} unit="count" />
                <Metric size="inline" label="Active cards" value={activeCards} unit="count" />
                {waiting > 0 && (
                  <Metric size="inline" label="Waiting for consent" value={waiting} unit="count" />
                )}
              </div>
            )}
          </>
        }
      >
        {roster.loading ? (
          <LoadingBlock />
        ) : roster.error ? (
          <ErrorState message={errorMessage(roster.error)} onRetry={roster.refetch} />
        ) : roster.data!.items.length === 0 ? (
          <EmptyState
            title="No seats yet"
            action={
              canIssue ? (
                <Button onClick={() => setIssueOpen(true)}>Generate access cards</Button>
              ) : undefined
            }
          >
            Generating access cards creates one pseudonymous seat per card.
          </EmptyState>
        ) : (
          <Table
            stack
            caption={`Roster for ${cohort.name}`}
            rows={roster.data!.items}
            rowKey={(r) => r.studentId}
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
              { key: 'age', header: 'Age band', cell: (r) => AGE_BAND_LABELS[r.ageBand] },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => <StudentStatusBadge status={r.status} />,
              },
              {
                key: 'cred',
                header: 'Access card',
                cell: (r) =>
                  r.hasActiveCredential ? (
                    <Badge tone="good">Active</Badge>
                  ) : (
                    <Badge tone="warn">No active card</Badge>
                  ),
              },
              {
                key: 'consent',
                header: 'Consent',
                cell: (r) => <ConsentBadge status={r.consent} />,
              },
              ...(canIssue
                ? [
                    {
                      key: 'actions',
                      header: <span className="sr-only">Actions</span>,
                      stackLabel: 'Lost card?',
                      cell: (r: RosterEntryDto) => (
                        <Button
                          size="sm"
                          variant="quiet"
                          icon={<RotateCcw size={14} aria-hidden="true" />}
                          disabled={r.status === 'withdrawn'}
                          aria-label={`Reissue card for seat ${r.rosterLabel}`}
                          onClick={() => {
                            setReason('lost');
                            setReissue(r);
                          }}
                        >
                          Reissue card
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
            footnote="Lost card? Reissue it by seat so the student keeps their history. If you can’t tell which seat is theirs, generate a new card instead — never guess."
          />
        )}
      </Section>

      <Section
        number="02"
        title="Sessions for this cohort"
        aside="Every assessment session opened for this cohort. Select one to see progress by seat."
      >
        {sessions.loading ? (
          <LoadingBlock />
        ) : sessions.error ? (
          <ErrorState message={errorMessage(sessions.error)} onRetry={sessions.refetch} />
        ) : sessions.data!.items.length === 0 ? (
          <EmptyState title="No sessions yet">
            Create a session to open an assessment for this cohort.
          </EmptyState>
        ) : (
          <Table
            stack
            caption={`Assessment sessions for ${cohort.name}`}
            rows={sessions.data!.items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 't',
                header: 'Session',
                rowHeader: true,
                cell: (r) => (
                  <Link className="link" to={`/instructor/sessions/${r.id}`}>
                    {r.title}
                  </Link>
                ),
              },
              { key: 'stage', header: 'Stage', cell: (r) => <StageBadge stage={r.stage} /> },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => <SessionStatusBadge status={r.status} />,
              },
              {
                key: 'sub',
                header: 'Submitted',
                numeric: true,
                cell: (r) => `${r.submittedCount} of ${r.enrolledCount}`,
              },
            ]}
          />
        )}
      </Section>

      <Dialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        busy={issue.loading}
        title="Generate access cards"
        description="Each card creates one new pseudonymous seat in this cohort. No names are collected."
        footer={
          <>
            <Button onClick={() => setIssueOpen(false)} disabled={issue.loading}>
              Cancel
            </Button>
            <Button variant="primary" loading={issue.loading} onClick={() => void doIssue()}>
              Generate {countValid ? n : ''} {n === 1 ? 'card' : 'cards'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Input
            label="How many cards?"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            hint="1 to 60 at a time. Print a few spares for walk-ins."
            error={count !== '' && !countValid ? 'Enter a whole number from 1 to 60.' : null}
            data-autofocus=""
          />
          <Fieldset
            legend="Age band for these students"
            hint="We store an age band only — never a birthdate."
          >
            <div className="space-y-2.5">
              {AGE_BANDS.map((b) => {
                const disabled = b === 'UNDER_13' && under13Off;
                return (
                  <Radio
                    key={b}
                    name="ageBand"
                    label={AGE_BAND_LABELS[b]}
                    checked={ageBand === b}
                    disabled={disabled}
                    onChange={() => setAgeBand(b)}
                    hint={
                      b === 'UNDER_13'
                        ? disabled
                          ? 'Turned off for this workspace. Registering children under 13 requires verified parental consent and must be enabled deliberately by an administrator after legal review.'
                          : 'Cards are created “waiting for consent”. Students can’t take assessments until an administrator records parental consent.'
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </Fieldset>
          <Notice tone="warn" title="Codes are shown once">
            You’ll go straight to a print sheet. The codes are never stored in readable form and
            can’t be displayed again.
          </Notice>
          {issueError && (
            <Notice tone="bad" role="alert">
              {issueError}
            </Notice>
          )}
        </div>
      </Dialog>

      <Dialog
        open={reissue !== null}
        onClose={() => setReissue(null)}
        busy={reissueM.loading}
        size="sm"
        title={`Reissue card for seat ${reissue?.rosterLabel ?? ''}`}
        description={
          <>
            The student keeps the same record and history (
            <span className="font-mono">{reissue?.publicCode}</span>).{' '}
            <strong>The old card stops working immediately.</strong>
          </>
        }
        footer={
          <>
            <Button onClick={() => setReissue(null)} disabled={reissueM.loading}>
              Cancel
            </Button>
            <Button variant="primary" loading={reissueM.loading} onClick={() => void doReissue()}>
              Reissue card
            </Button>
          </>
        }
      >
        <Select
          label="Why is a new card needed?"
          value={reason}
          onChange={(e) => setReason(e.target.value as Reason)}
          hint="Saved to the audit log."
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Notice tone="info" className="mt-4">
          Only reissue when you’re sure which seat belongs to this student. If you’re not sure,
          generate a new card instead.
        </Notice>
      </Dialog>
    </>
  );
}
