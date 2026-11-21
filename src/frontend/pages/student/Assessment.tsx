import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useBlocker, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import type {
  AttemptStarted,
  PublicQuestion,
  StudentAssessmentDetail,
  SubmitResult,
} from '@shared/api';
import type { QuestionType } from '@shared/types';
import {
  Button,
  ButtonLink,
  ConfirmDialog,
  ErrorState,
  LoadingBlock,
  Notice,
  QuestionCount,
  Skeleton,
  useDocumentTitle,
} from '@frontend/components/ui';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage, isApiError } from '@frontend/services/api';
import { QuestionRenderer } from '@frontend/components/assessment/QuestionRenderer';
import { isAnswered } from '@frontend/components/assessment/config';
import { clearDraft, loadDraft, saveDraft, type Answers } from '@frontend/lib/draft';
import { STAGE_STUDENT } from '@frontend/lib/format';
import type { DoneState } from './Done';

const TYPE_HINT: Record<QuestionType, string> = {
  multiple_choice: 'Pick one answer',
  multiple_select: 'Pick all that apply',
  code_comprehension: 'Read the code, then pick one answer',
  predict_output: 'What will this code print?',
  debugging: 'Find the bug',
  ordering: 'Put the steps in order',
  short_logic: 'Type a short answer',
  confidence_likert: 'How confident do you feel?',
  project_rubric: '',
};

/** A full-screen message with one way forward (closed, missing, needs consent). */
function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rule-heavy pt-8">
      <span
        className="dot-grid block h-16 w-16 border border-dashed border-rule-strong"
        aria-hidden="true"
      />
      <h1 className="t-h1 mt-6" tabIndex={-1} data-page-heading>
        {title}
      </h1>
      <div className="t-lede mt-3">{children}</div>
      <div className="mt-8">
        <ButtonLink to="/s/home" variant="primary" size="lg">
          Back to my check-ins
        </ButtonLink>
      </div>
    </div>
  );
}

export default function AssessmentPage() {
  const { sessionId = '' } = useParams();
  const q = useQuery(`assessment:${sessionId}`, (signal) =>
    api.get<StudentAssessmentDetail>(`/student/assessments/${sessionId}`, undefined, signal),
  );
  useDocumentTitle(q.data?.title ?? 'Check-in');

  if (q.loading) {
    return (
      <LoadingBlock label="Loading your check-in…">
        <div className="rule-heavy space-y-5 py-8">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton lines={3} />
          <Skeleton className="h-14 w-full" />
        </div>
      </LoadingBlock>
    );
  }
  if (q.error || !q.data) {
    if (isApiError(q.error, 'consent_required')) {
      return (
        <StateCard title="We need a grown-up first">
          A parent or guardian needs to fill out a permission form before you can start. Your
          instructor can help.
        </StateCard>
      );
    }
    if (isApiError(q.error, 'session_closed')) {
      return (
        <StateCard title="This check-in is closed">
          Your instructor has closed it. If you think that’s a mistake, let them know.
        </StateCard>
      );
    }
    if (isApiError(q.error, 'not_found') || isApiError(q.error, 'forbidden')) {
      return (
        <StateCard title="We can’t find that check-in">
          It may have ended, or it belongs to a different class.
        </StateCard>
      );
    }
    return (
      <ErrorState
        title="We couldn’t load this check-in"
        message={errorMessage(q.error)}
        onRetry={q.refetch}
      />
    );
  }
  const detail = q.data;
  if (detail.attempt?.status === 'submitted' && detail.stage !== 'PRACTICE') {
    return (
      <Navigate to={`/s/done/${sessionId}`} replace state={{ already: true } satisfies DoneState} />
    );
  }
  return <Runner key={detail.sessionId} detail={detail} />;
}

type Phase = 'intro' | 'questions' | 'review' | 'closed' | 'expired';

export function Runner({ detail }: { detail: StudentAssessmentDetail }) {
  const navigate = useNavigate();
  const questions = useMemo<PublicQuestion[]>(
    () =>
      detail.questions.filter((q) => q.type !== 'project_rubric').sort((a, b) => a.order - b.order),
    [detail.questions],
  );
  const total = questions.length;
  const resumeId = detail.attempt?.status === 'in_progress' ? detail.attempt.id : null;
  const [initialDraft] = useState(() => (resumeId ? loadDraft(resumeId) : null));

  const [attemptId, setAttemptId] = useState<string | null>(resumeId);
  const [phase, setPhase] = useState<Phase>(resumeId ? 'questions' : 'intro');
  const [answers, setAnswers] = useState<Answers>(initialDraft?.answers ?? {});
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialDraft?.index ?? 0, 0), Math.max(total - 1, 0)),
  );
  const [restored] = useState(() => !!initialDraft && Object.keys(initialDraft.answers).length > 0);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowLeave = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const answeredIds = useMemo(
    () => new Set(questions.filter((q) => isAnswered(answers[q.id])).map((q) => q.id)),
    [questions, answers],
  );
  const unanswered = total - answeredIds.size;
  const active = phase === 'questions' || phase === 'review';
  const dirty = active && answeredIds.size > 0;

  // Draft: answers only, keyed by attempt id.
  useEffect(() => {
    if (attemptId && active) saveDraft(attemptId, answers, index);
  }, [attemptId, active, answers, index]);

  // Warn before a refresh/close discards the page while answers are not yet turned in.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname,
  );

  // Move focus to the new question / screen heading.
  useEffect(() => {
    if (phase === 'intro') return;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [index, phase]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const started = await api.post<AttemptStarted>(
        `/student/assessments/${detail.sessionId}/start`,
      );
      const draft = loadDraft(started.attemptId);
      if (draft) {
        setAnswers(draft.answers);
        setIndex(Math.min(draft.index, Math.max(total - 1, 0)));
      }
      setAttemptId(started.attemptId);
      setPhase('questions');
    } catch (e) {
      if (isApiError(e, 'session_closed')) setPhase('closed');
      else if (isApiError(e, 'conflict')) {
        navigate(`/s/done/${detail.sessionId}`, {
          replace: true,
          state: { already: true } satisfies DoneState,
        });
      } else setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const submit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<SubmitResult>(
        `/student/assessments/${detail.sessionId}/submit`,
        {
          attemptId,
          assessmentVersion: detail.assessmentVersion,
          responses: questions.map((q) => {
            const r = answers[q.id];
            return {
              questionId: q.id,
              response: r && isAnswered(r) ? r : { kind: 'skipped' as const },
            };
          }),
        },
      );
      clearDraft(attemptId);
      allowLeave.current = true;
      navigate(`/s/done/${detail.sessionId}`, {
        replace: true,
        state: { result } satisfies DoneState,
      });
    } catch (e) {
      setConfirmSubmit(false);
      if (isApiError(e, 'conflict')) {
        clearDraft(attemptId);
        allowLeave.current = true;
        navigate(`/s/done/${detail.sessionId}`, {
          replace: true,
          state: { already: true } satisfies DoneState,
        });
      } else if (isApiError(e, 'session_closed')) {
        clearDraft(attemptId);
        allowLeave.current = true;
        setPhase('closed');
      } else if (isApiError(e, 'unauthenticated')) {
        allowLeave.current = true;
        setPhase('expired');
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const leaveDialog = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => {
        allowLeave.current = true;
        blocker.proceed?.();
      }}
      title="Leave this check-in?"
      description="Your answers aren’t turned in yet. They stay on this device for now, but they only count after you submit."
      confirmLabel="Leave"
      cancelLabel="Keep going"
      tone="danger"
    />
  );

  if (phase === 'closed') {
    return (
      <StateCard title="This check-in is closed">
        Your instructor closed it before your answers were turned in. Let them know — they can open
        it again.
      </StateCard>
    );
  }
  if (phase === 'expired') {
    return (
      <div className="rule-heavy pt-8">
        <span className="block h-16 w-16 rounded-full bg-yellow" aria-hidden="true" />
        <h1 className="t-h1 mt-6" tabIndex={-1} data-page-heading>
          Your sign-in timed out
        </h1>
        <p className="t-lede mt-3">
          Don’t worry — your answers are still saved on this device. Sign in again with your card,
          open this check-in, and turn them in.
        </p>
        <div className="mt-8">
          <ButtonLink to="/s" variant="primary" size="lg">
            Sign in again
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (phase === 'intro') {
    const facts = [
      { n: String(total), t: 'questions', d: 'One at a time.' },
      { n: `~${detail.estimatedMinutes}`, t: 'minutes', d: 'Take the time you need.' },
      { n: '0', t: 'grades', d: 'Best guess or skip — this isn’t a grade.' },
    ];
    return (
      <div className="rule-heavy pt-6 sm:pt-10">
        <p className="t-meta">{STAGE_STUDENT[detail.stage]}</p>
        <h1 className="t-h1 mt-3 break-words" tabIndex={-1} data-page-heading>
          {detail.title}
        </h1>
        {detail.description && <p className="t-lede mt-3">{detail.description}</p>}
        <dl className="mt-8 grid grid-cols-3 border-y border-ink">
          {facts.map((f, i) => (
            <div
              key={f.t}
              className={i > 0 ? 'border-l border-rule py-4 pl-3 sm:pl-5' : 'py-4 pr-3'}
            >
              <dd className="t-figure text-[clamp(2rem,9vw,3.75rem)]">{f.n}</dd>
              <dt className="mt-1 font-semibold">{f.t}</dt>
              <dd className="t-small mt-1 hidden text-ink-2 xs:block">{f.d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-ink-2">You can go back and change answers before you turn it in.</p>
        {error && (
          <Notice tone="bad" role="alert" className="mt-4">
            {error}
          </Notice>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            variant="primary"
            size="lg"
            className="sm:min-w-56"
            loading={starting}
            onClick={() => void start()}
            iconRight={<ArrowRight size={20} aria-hidden="true" />}
          >
            Start
          </Button>
          <ButtonLink to="/s/home" variant="quiet" size="lg">
            Not now
          </ButtonLink>
        </div>
      </div>
    );
  }

  const header = (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-ink-2">{detail.title}</p>
        <Button
          size="sm"
          variant="secondary"
          icon={<X size={15} aria-hidden="true" />}
          onClick={() => navigate('/s/home')}
        >
          Exit
        </Button>
      </div>
      <QuestionCount
        answered={questions.map((q) => answeredIds.has(q.id))}
        current={phase === 'questions' ? index : undefined}
        label={`${answeredIds.size} of ${total} questions answered`}
      />
      <p className="t-caption t-num mt-2" data-testid="answered-count">
        {answeredIds.size} of {total} answered
      </p>
    </div>
  );

  if (phase === 'review') {
    return (
      <div>
        {header}
        <div className="rule-heavy pt-6">
          <h1 ref={headingRef} className="t-h1" tabIndex={-1}>
            Check your answers
          </h1>
          <p className="t-lede mt-3">
            Tap any question to go back to it. When you’re happy, turn it in.
          </p>

          {unanswered > 0 ? (
            <Notice
              tone="warn"
              className="mt-5"
              role="status"
              title={`${unanswered} ${unanswered === 1 ? 'question isn’t' : 'questions aren’t'} answered yet`}
            >
              You can still turn it in, but unanswered questions count as zero.
            </Notice>
          ) : (
            <Notice
              tone="good"
              className="mt-5"
              role="status"
              title="Every question has an answer"
            />
          )}

          <ol className="mt-6 border-t border-ink" aria-label="Your answers">
            {questions.map((q, i) => {
              const ok = answeredIds.has(q.id);
              return (
                <li key={q.id} className="border-b border-rule">
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left hover:bg-sheet"
                    onClick={() => {
                      setIndex(i);
                      setPhase('questions');
                    }}
                  >
                    <span
                      className="count-cell flex-none"
                      data-state={ok ? 'answered' : 'open'}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">
                        <span className="sr-only">{i + 1}. </span>
                        {q.prompt}
                      </span>
                      <span className="t-small flex items-center gap-1.5 text-ink-2">
                        {ok ? (
                          <>
                            <Check size={14} aria-hidden="true" /> Answered
                          </>
                        ) : (
                          <span className="bg-yellow px-1.5 font-semibold text-ink">
                            Not answered yet
                          </span>
                        )}
                      </span>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" className="flex-none text-ink-3" />
                  </button>
                </li>
              );
            })}
          </ol>

          {error && (
            <Notice tone="bad" role="alert" className="mt-5" title="We couldn’t turn it in">
              {error} Your answers are still here.
            </Notice>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              size="lg"
              icon={<ArrowLeft size={20} aria-hidden="true" />}
              onClick={() => {
                setIndex(Math.max(total - 1, 0));
                setPhase('questions');
              }}
            >
              Back to questions
            </Button>
            <Button variant="primary" size="lg" onClick={() => setConfirmSubmit(true)}>
              Turn in my answers
            </Button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmSubmit}
          busy={submitting}
          onClose={() => setConfirmSubmit(false)}
          onConfirm={submit}
          title="Turn in your answers?"
          description={
            unanswered > 0
              ? `You have ${unanswered} unanswered ${unanswered === 1 ? 'question' : 'questions'}. After you turn it in, you can’t change anything.`
              : 'After you turn it in, you can’t change anything.'
          }
          confirmLabel="Yes, turn it in"
          cancelLabel="Not yet"
        />
        {leaveDialog}
      </div>
    );
  }

  const question = questions[index];
  if (!question) {
    return (
      <StateCard title="This check-in has no questions yet">Let your instructor know.</StateCard>
    );
  }
  const promptId = `q-${question.id}`;
  const isLast = index === total - 1;
  const isLikert = question.type === 'confidence_likert';

  return (
    <div>
      {header}
      {restored && index === (initialDraft?.index ?? 0) && (
        <Notice tone="info" role="status" className="mb-5" title="Welcome back">
          We kept the answers you already gave on this device.
        </Notice>
      )}
      {/* Workbook page: question number in the margin, prompt and answers in the body. */}
      <article
        key={question.id}
        className="rule-heavy pt-5 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:gap-x-6"
      >
        <div className="mb-3 md:mb-0">
          <p className="t-figure hidden text-[3.75rem] md:block" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </p>
        </div>
        <div className="min-w-0">
          <p className="t-meta" data-testid="question-position">
            Question {index + 1} of {total} · {TYPE_HINT[question.type]}
          </p>
          <h1
            id={promptId}
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 whitespace-pre-line break-words text-[1.375rem] font-semibold leading-[1.3] tracking-[-0.01em] text-ink sm:text-[1.5625rem]"
          >
            {question.prompt}
          </h1>
          <div className="mt-6">
            <QuestionRenderer
              question={question}
              value={answers[question.id]}
              labelledBy={promptId}
              onChange={(v) =>
                setAnswers((prev) => {
                  const next = { ...prev };
                  if (v === undefined) delete next[question.id];
                  else next[question.id] = v;
                  return next;
                })
              }
            />
          </div>
          {!isLikert && !answeredIds.has(question.id) && (
            <p className="t-caption mt-5">
              Not sure? It’s okay to skip — tap {isLast ? 'Review' : 'Next'}.
            </p>
          )}
        </div>
      </article>

      {/* Fixed on phones so Previous / Next are always in reach; the spacer keeps the last answer clear of it. */}
      <div className="h-24 md:hidden" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-3 border-t-2 border-ink bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:static md:mt-10 md:border-t md:border-rule md:bg-transparent md:px-0 md:pb-0 md:pt-5 md:pl-[8.5rem]">
        <Button
          size="lg"
          className="flex-1 md:flex-none"
          disabled={index === 0}
          icon={<ArrowLeft size={20} aria-hidden="true" />}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>
        {isLast ? (
          <Button
            variant="primary"
            size="lg"
            className="flex-1 md:min-w-44 md:flex-none"
            onClick={() => setPhase('review')}
          >
            Review
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="flex-1 md:min-w-44 md:flex-none"
            iconRight={<ArrowRight size={20} aria-hidden="true" />}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            Next
          </Button>
        )}
      </div>
      {leaveDialog}
    </div>
  );
}
