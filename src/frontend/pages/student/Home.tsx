import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import type { StudentAssessmentSummary } from '@shared/api';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Signal,
  Skeleton,
  useDocumentTitle,
} from '@frontend/components/ui';
import { useStudent } from '@frontend/hooks/contexts';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage, isApiError } from '@frontend/services/api';
import { STAGE_STUDENT } from '@frontend/lib/format';

function AssessmentRow({
  a,
  n,
  primary,
}: {
  a: StudentAssessmentSummary;
  n: number;
  /** Only the first open check-in gets the red primary action. */
  primary: boolean;
}) {
  const done = a.state === 'completed';
  const canRetry = done && a.stage === 'PRACTICE';
  return (
    <li className="grid gap-x-4 gap-y-3 border-b border-rule py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span
        className="count-cell hidden sm:grid"
        data-state={done ? 'answered' : 'open'}
        aria-hidden="true"
      >
        {done ? <Check size={14} /> : n}
      </span>
      <div className="min-w-0">
        <p className="t-small flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
          <span className={`stage stage-${a.stage}`}>{STAGE_STUDENT[a.stage]}</span>
          {a.state === 'in_progress' && (
            <span className="bg-yellow px-1.5 font-semibold text-ink">Started</span>
          )}
          {done && <span className="font-semibold text-green-ink">Done</span>}
        </p>
        <h3 className="t-h3 mt-1 break-words">{a.title}</h3>
        <p className="t-small mt-0.5 text-ink-2">
          {a.cohortName} · about {a.estimatedMinutes} min · {a.questionCount} questions
        </p>
      </div>
      {done && !canRetry ? (
        <p className="t-small font-semibold text-green-ink">All turned in. Nice work!</p>
      ) : (
        <ButtonLink
          to={`/s/assess/${a.sessionId}`}
          variant={primary ? 'primary' : 'secondary'}
          size="lg"
          className="sm:min-w-40"
          iconRight={<ArrowRight size={20} aria-hidden="true" />}
        >
          {a.state === 'in_progress' ? 'Keep going' : canRetry ? 'Practice again' : 'Start'}
        </ButtonLink>
      )}
    </li>
  );
}

export default function StudentHome() {
  useDocumentTitle('Your check-ins');
  const { student } = useStudent();
  const blocked = student?.status !== 'active';
  const q = useQuery(blocked ? null : 'student-assessments', (signal) =>
    api.page<StudentAssessmentSummary>('/student/assessments', undefined, signal),
  );
  if (!student) return null;
  const consentBlocked =
    student.status === 'pending_consent' || isApiError(q.error, 'consent_required');
  const items = q.data?.items ?? [];
  const todo = items.filter((a) => a.state !== 'completed');
  const done = items.filter((a) => a.state === 'completed');

  return (
    <div>
      <header className="page-header">
        <Signal area="student" className="page-header-signal" />
        <div className="pr-16 md:pr-28">
          <p className="t-meta">Signed in with card</p>
          <h1 className="t-display mt-3 break-words" tabIndex={-1} data-page-heading>
            Hi, <span className="t-mono font-medium tracking-tight">{student.publicCode}</span>!
          </h1>
          <p className="t-lede mt-4">
            {student.cohorts.length > 0
              ? `You’re in ${student.cohorts.map((c) => c.name).join(' and ')}. `
              : ''}
            These check-ins help your instructors teach better. Just do your best — it’s okay not to
            know everything yet.
          </p>
        </div>
      </header>

      {student.status === 'withdrawn' ? (
        <Notice tone="warn" title="This card is no longer active">
          Please talk to your instructor if you think this is a mistake.
        </Notice>
      ) : consentBlocked ? (
        <section
          className="border-l-4 border-ink bg-yellow-tint p-5 sm:p-6"
          data-testid="consent-required"
        >
          <h2 className="t-h2">Almost ready — we need a grown-up first</h2>
          <p className="mt-3 max-w-xl text-ink-2">
            Before you can start, a parent or guardian needs to fill out a permission form. Your
            instructor can help with that. You didn’t do anything wrong, and your card will work as
            soon as the form is in.
          </p>
        </section>
      ) : q.loading ? (
        <LoadingBlock label="Finding your check-ins…">
          <div className="space-y-5 border-t border-ink py-6">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton lines={2} />
            <Skeleton className="h-14 w-full" />
          </div>
        </LoadingBlock>
      ) : q.error ? (
        <ErrorState
          title="We couldn’t load your check-ins"
          message={errorMessage(q.error)}
          onRetry={q.refetch}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing to do right now"
          action={<Button onClick={q.refetch}>Check again</Button>}
        >
          Your instructor will open a check-in when it’s time. Refresh this page when they say go.
        </EmptyState>
      ) : (
        <div className="space-y-12">
          {todo.length > 0 && (
            <section aria-labelledby="todo-h">
              <h2 id="todo-h" className="t-h2 border-b border-ink pb-3">
                Ready for you
              </h2>
              <ul>
                {todo.map((a, i) => (
                  <AssessmentRow key={a.sessionId} a={a} n={i + 1} primary={i === 0} />
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="done-h">
              <h2 id="done-h" className="t-h2 border-b border-ink pb-3">
                Finished
              </h2>
              <ul>
                {done.map((a, i) => (
                  <AssessmentRow
                    key={a.sessionId}
                    a={a}
                    n={i + 1}
                    primary={todo.length === 0 && i === 0}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {student.status === 'active' && (
        <p className="mt-10">
          <Link to="/s/progress" className="link">
            See my past check-ins
          </Link>
        </p>
      )}
    </div>
  );
}
