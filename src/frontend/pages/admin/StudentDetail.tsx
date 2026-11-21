import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Ban, Trash2 } from 'lucide-react';
import type { StudentHistory } from '@shared/api';
import { SKILL_LABELS } from '@shared/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Figure,
  LoadingBlock,
  Notice,
  PageHeader,
  Section,
  useToast,
} from '@frontend/components/ui';
import { ConsentBadge, StageBadge, StudentStatusBadge } from '@frontend/components/StatusBadges';
import { StudentHistoryChart } from '@frontend/components/charts/ImpactCharts';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { useStaff } from '@frontend/hooks/contexts';
import { api, errorMessage } from '@frontend/services/api';
import {
  AGE_BAND_LABELS,
  STAGE_SHORT,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtNum,
  fmtPct,
} from '@frontend/lib/format';

type Attempt = StudentHistory['attempts'][number];
type SkillScore = Attempt['skills'][number];

/** One skill on a fixed 0–100 scale. */
function SkillBar({ s }: { s: SkillScore }) {
  const pct = Math.max(0, Math.min(100, s.percentage));
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-x-3 gap-y-1 py-2">
      <span className="text-[0.9375rem] font-medium text-ink">{SKILL_LABELS[s.skill]}</span>
      <span className="t-num text-right text-[0.9375rem]">{fmtNum(s.percentage, 1)}%</span>
      <span className="col-span-2 block h-2.5" aria-hidden="true">
        <span className="bar-track block">
          <span className="bar block bg-ink" style={{ width: `${pct}%` }} />
        </span>
      </span>
    </li>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="border-t border-ink">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-4 border-b border-rule py-2.5 text-[0.9375rem]"
        >
          <dt className="t-label">{k}</dt>
          <dd className="min-w-0 text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function StudentDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useStaff();
  const [confirm, setConfirm] = useState<'withdraw' | 'delete' | null>(null);
  const q = useQuery(`student:${id}`, (s) =>
    api.get<StudentHistory>(`/admin/students/${id}`, undefined, s),
  );
  const withdraw = useMutation(() => api.post<{ ok: true }>(`/admin/students/${id}/withdraw`));
  const remove = useMutation(() => api.delete<{ ok: true }>(`/admin/students/${id}`));

  if (q.loading) return <LoadingBlock label="Loading student history…" />;
  if (q.error || !q.data) {
    return (
      <ErrorState
        title="We couldn’t load this record"
        message={errorMessage(q.error)}
        onRetry={q.refetch}
      />
    );
  }
  const { student, consent, credential } = q.data;
  const attempts = [...q.data.attempts].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const chart = attempts.map((a, i) => ({
    label: `${i + 1}. ${STAGE_SHORT[a.stage]}`,
    score: a.percentageScore,
    stage: a.stage,
  }));
  const manage = can('students.manage');
  const first = attempts[0];
  const latest = attempts[attempts.length - 1];

  // Strengths / areas to improve: latest attempt only, top and bottom three, never overlapping.
  const ranked = latest ? [...latest.skills].sort((a, b) => b.percentage - a.percentage) : [];
  const take = Math.min(3, Math.floor(ranked.length / 2));
  const strengths = ranked.slice(0, take);
  // Only skills that actually fell short: a 100% sub-score is never listed as an area to revisit.
  const weaker = (take > 0 ? ranked.slice(-take).reverse() : []).filter((x) => x.percentage < 100);

  return (
    <>
      <PageHeader
        title={<span className="t-mono font-medium tracking-tight">{student.publicCode}</span>}
        documentTitle={`Student ${student.publicCode}`}
        back={{ to: '/admin/students', label: 'Students' }}
        eyebrow="Pseudonymous student record"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base">
            <StudentStatusBadge status={student.status} />
            <Badge>{AGE_BAND_LABELS[student.ageBand]}</Badge>
            {student.isSynthetic && <Badge tone="warn">Synthetic</Badge>}
            <span>
              {student.cohorts.map((c) => `${c.name} · seat ${c.rosterLabel}`).join('; ') ||
                'Not enrolled in a cohort'}
            </span>
          </span>
        }
      />

      {attempts.length === 0 ? (
        <Section number="01" title="Learning record">
          <EmptyState title="No submitted assessments yet">
            Scores, skills and history appear here after this student turns in an assessment.
          </EmptyState>
        </Section>
      ) : (
        <>
          <Section
            number="01"
            title="Score progression"
            aside={
              <>
                <p>
                  <span className="t-num">
                    {attempts.length} submitted{' '}
                    {attempts.length === 1 ? 'assessment' : 'assessments'}
                  </span>
                </p>
                <p className="mt-2">
                  Each point is one assessment on a 0–100 scale. Forms differ, so small moves are
                  not meaningful on their own.
                </p>
              </>
            }
          >
            <div className="grid gap-x-6 gap-y-6 xl:grid-cols-12">
              <dl className="grid grid-cols-2 gap-x-6 border-t border-ink pt-3 xl:col-span-3 xl:grid-cols-1 xl:gap-y-5">
                <div>
                  <dt className="t-label">Latest score</dt>
                  <dd className="t-figure mt-1 text-[2.4375rem]">
                    {fmtNum(latest!.percentageScore, 1)}
                    <span className="ml-1 text-base tracking-normal text-ink-2">%</span>
                  </dd>
                  <dd className="t-caption t-num mt-1">
                    {STAGE_SHORT[latest!.stage]} · {fmtDate(latest!.submittedAt)}
                  </dd>
                </div>
                {attempts.length > 1 && (
                  <div>
                    <dt className="t-label">First score</dt>
                    <dd className="t-figure mt-1 text-[2.4375rem]">
                      {fmtNum(first!.percentageScore, 1)}
                      <span className="ml-1 text-base tracking-normal text-ink-2">%</span>
                    </dd>
                    <dd className="t-caption t-num mt-1">
                      {STAGE_SHORT[first!.stage]} · {fmtDate(first!.submittedAt)}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="min-w-0 xl:col-span-9">
                {attempts.length > 1 ? (
                  <Figure
                    title="Scores over time"
                    summary={`Line chart of ${attempts.length} assessment scores from ${fmtPct(first!.percentageScore)} to ${fmtPct(latest!.percentageScore)}.`}
                    table={{
                      caption: 'Scores by attempt',
                      columns: ['Attempt', 'Date', 'Score %'],
                      rows: attempts.map((a, i) => [
                        `${i + 1}. ${STAGE_SHORT[a.stage]}`,
                        fmtDate(a.submittedAt),
                        fmtNum(a.percentageScore),
                      ]),
                    }}
                  >
                    <StudentHistoryChart data={chart} />
                  </Figure>
                ) : (
                  <Notice tone="info" title="One assessment so far">
                    A progression needs at least two submitted assessments. The single score is a
                    snapshot of one day, not a trend.
                  </Notice>
                )}
              </div>
            </div>
          </Section>

          <Section
            number="02"
            title="Skills"
            aside={
              <>
                <p>
                  From the latest assessment only:{' '}
                  <span className="text-ink">{latest!.assessmentTitle}</span>,{' '}
                  <span className="t-num">{fmtDate(latest!.submittedAt)}</span>.
                </p>
                <p className="mt-2">
                  One assessment for one student. A skill may rest on only one or two questions, so
                  read this as a prompt for conversation, not a diagnosis.
                </p>
              </>
            }
          >
            {take === 0 ? (
              <p className="t-small text-ink-2">
                The latest assessment doesn’t report enough skill sub-scores to compare.
              </p>
            ) : (
              <div className="grid gap-x-6 gap-y-8 md:grid-cols-2">
                <div>
                  <h3 className="t-h4 border-b border-ink pb-2">Strongest on this assessment</h3>
                  <ul className="divide-y divide-rule">
                    {strengths.map((s) => (
                      <SkillBar key={s.skill} s={s} />
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="t-h4 border-b border-ink pb-2">Areas to revisit</h3>
                  {weaker.length === 0 ? (
                    <p className="t-small py-3 text-ink-2">
                      No skill fell below full marks on this assessment.
                    </p>
                  ) : (
                    <ul className="divide-y divide-rule">
                      {weaker.map((s) => (
                        <SkillBar key={s.skill} s={s} />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Section>

          <Section
            number="03"
            title="Assessment history"
            aside="Oldest first. Scores and skill sub-scores only — individual answers are not shown."
          >
            <ol className="timeline" aria-label={`Submitted attempts for ${student.publicCode}`}>
              {attempts.map((a) => (
                <li key={a.attemptId} className="timeline-item">
                  <span className="timeline-mark" data-stage={a.stage} aria-hidden="true" />
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="t-small flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
                        <span className="t-num">{fmtDateTime(a.submittedAt)}</span>
                        <StageBadge stage={a.stage} />
                      </p>
                      <h3 className="t-h4 mt-1 break-words">{a.assessmentTitle}</h3>
                      <p className="t-small text-ink-2">
                        {a.sessionTitle !== a.assessmentTitle ? `${a.sessionTitle} · ` : ''}
                        {a.cohortName}
                      </p>
                    </div>
                    <p className="sm:text-right">
                      <span className="t-figure text-[1.5625rem]">{fmtPct(a.percentageScore)}</span>
                      <span className="t-caption t-num ml-2 sm:ml-0 sm:block">
                        {fmtDuration(a.durationSeconds)}
                      </span>
                    </p>
                  </div>
                  {a.skills.length > 0 && (
                    <p className="t-caption t-num mt-2 max-w-3xl">
                      {a.skills
                        .map((s) => `${SKILL_LABELS[s.skill]} ${fmtNum(s.percentage, 1)}%`)
                        .join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      <Section
        number={attempts.length === 0 ? '02' : '04'}
        title="Card and consent"
        aside="The access code itself is never stored in readable form. Instructors reissue cards from the cohort roster."
      >
        <div className="grid gap-x-6 gap-y-8 md:grid-cols-2">
          <div>
            <h3 className="t-h4 mb-2">Access card</h3>
            <Facts
              rows={[
                [
                  'Status',
                  credential.active ? (
                    <Badge tone="good">Active</Badge>
                  ) : (
                    <Badge tone="warn">No active card</Badge>
                  ),
                ],
                ['Issued', <span className="t-num">{fmtDateTime(credential.createdAt)}</span>],
                ['Last used', <span className="t-num">{fmtDateTime(credential.lastUsedAt)}</span>],
                [
                  'Reissued',
                  <span className="t-num">
                    {credential.reissueCount} {credential.reissueCount === 1 ? 'time' : 'times'}
                  </span>,
                ],
              ]}
            />
          </div>
          <div>
            <h3 className="t-h4 mb-2">Consent</h3>
            {consent ? (
              <Facts
                rows={[
                  ['Status', <ConsentBadge status={consent.status} />],
                  [
                    'Notice version',
                    <span className="t-mono">{consent.noticeVersion ?? '—'}</span>,
                  ],
                  [
                    'Recorded',
                    <span className="t-num">{fmtDateTime(consent.consentTimestamp)}</span>,
                  ],
                ]}
              />
            ) : (
              <p className="t-small border-t border-ink pt-3 text-ink-2">
                No consent record. Parental consent is not required for this age band.
              </p>
            )}
          </div>
        </div>
      </Section>

      {manage && (
        <Section
          number={attempts.length === 0 ? '03' : '05'}
          title="Data controls"
          aside="Both actions ask you to type the public code and are written to the audit log."
        >
          <div className="divide-y divide-rule border-y border-ink">
            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <h3 className="t-h4">Withdraw from the program</h3>
                <p className="t-small mt-0.5 text-ink-2">
                  The access card stops working and no further assessments can be taken. Existing
                  data is kept.
                </p>
              </div>
              <Button
                icon={<Ban size={16} aria-hidden="true" />}
                disabled={student.status === 'withdrawn'}
                onClick={() => setConfirm('withdraw')}
              >
                {student.status === 'withdrawn' ? 'Withdrawn' : 'Withdraw'}
              </Button>
            </div>
            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <h3 className="t-h4">Delete this student’s data</h3>
                <p className="t-small mt-0.5 text-ink-2">
                  Permanently removes the record, cards, attempts, answers and consent. This cannot
                  be undone, and aggregate numbers recalculate without this student.
                </p>
              </div>
              <Button
                variant="danger"
                icon={<Trash2 size={16} aria-hidden="true" />}
                onClick={() => setConfirm('delete')}
              >
                Delete data
              </Button>
            </div>
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={confirm === 'withdraw'}
        busy={withdraw.loading}
        onClose={() => setConfirm(null)}
        tone="danger"
        title="Withdraw this student?"
        description="Their access card stops working and they can’t take assessments. Existing data is kept until a deletion request."
        requireText={student.publicCode}
        requireTextLabel={`Type the public code ${student.publicCode} to confirm`}
        confirmLabel="Withdraw student"
        onConfirm={async () => {
          try {
            await withdraw.run(undefined);
            toast.success(`${student.publicCode} withdrawn.`);
            setConfirm(null);
            q.refetch();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        busy={remove.loading}
        onClose={() => setConfirm(null)}
        tone="danger"
        title="Permanently delete this student’s data?"
        description="This removes the record, access cards, enrollments, attempts, answers, consent record and any guardian contact. It cannot be undone. The audit log keeps only that a deletion happened."
        requireText={student.publicCode}
        requireTextLabel={`Type the public code ${student.publicCode} to confirm`}
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          try {
            await remove.run(undefined);
            toast.success(`${student.publicCode} and all related data deleted.`);
            navigate('/admin/students', { replace: true });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      >
        <Notice tone="bad" title="Aggregate numbers will change">
          Dashboards recalculate without this student.
        </Notice>
      </ConfirmDialog>
    </>
  );
}
