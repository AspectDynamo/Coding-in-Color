import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { AssessmentSessionDto, AssessmentSummaryDto, CohortDto } from '@shared/api';
import { ASSESSMENT_STAGES, type AssessmentStage } from '@shared/types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Section,
  Stepper,
  Toggle,
  useToast,
} from '@frontend/components/ui';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { STAGE_HELP, STAGE_LABELS, titleCase } from '@frontend/lib/format';

const STEPS = ['Cohort', 'Assessment', 'Stage', 'Timing'];

/** One ruled row of a single-choice list: a visible radio, a title and a line of detail. */
function Choice({
  name,
  checked,
  onChange,
  title,
  detail,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 border-b border-rule px-2 py-3 hover:bg-sheet has-[:checked]:border-b-ink has-[:checked]:bg-sheet">
      <input
        type="radio"
        name={name}
        className="check mt-0.5"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold text-ink">{title}</span>
        {detail && <span className="t-small block text-ink-2">{detail}</span>}
      </span>
    </label>
  );
}

export default function NewSession() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const cohorts = useQuery('i-cohorts', (s) =>
    api.page<CohortDto>('/instructor/cohorts', undefined, s),
  );
  const assessments = useQuery('i-assessments', (s) =>
    api.page<AssessmentSummaryDto>('/instructor/assessments', undefined, s),
  );

  const [step, setStep] = useState(params.get('cohortId') ? 1 : 0);
  const [cohortId, setCohortId] = useState(params.get('cohortId') ?? '');
  const [assessmentId, setAssessmentId] = useState('');
  const [stage, setStage] = useState<AssessmentStage | ''>('');
  const [openNow, setOpenNow] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation((body: Record<string, unknown>) =>
    api.post<AssessmentSessionDto>('/instructor/assessment-sessions', body),
  );

  const cohort = cohorts.data?.items.find((c) => c.id === cohortId);
  const assessment = assessments.data?.items.find((a) => a.id === assessmentId);
  const canNext = [!!cohort, !!assessment, !!stage, true][step];

  const submit = async () => {
    setFormError(null);
    if (!openNow && !startsAt) {
      setFormError('Choose when the session should open, or switch on “Open right away”.');
      return;
    }
    if (endsAt && startsAt && new Date(endsAt) <= new Date(startsAt)) {
      setFormError('The closing time must be after the opening time.');
      return;
    }
    try {
      const session = await create.run({
        cohortId,
        assessmentId,
        stage,
        openNow,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(!openNow && startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
        ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
      });
      toast.success(openNow ? 'Session is open. Students can start now.' : 'Session scheduled.');
      navigate(`/instructor/sessions/${session.id}`);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const loading = cohorts.loading || assessments.loading;
  const loadError = cohorts.error ?? assessments.error;

  const summary = (
    <dl className="space-y-3">
      {[
        { n: '1', t: 'Cohort', v: cohort?.name },
        { n: '2', t: 'Assessment', v: assessment?.title },
        { n: '3', t: 'Stage', v: stage ? STAGE_LABELS[stage] : undefined },
        {
          n: '4',
          t: 'Timing',
          v: step === 3 ? (openNow ? 'Opens right away' : 'Scheduled') : undefined,
        },
      ].map((r) => (
        <div key={r.t} className="border-t border-rule pt-2">
          <dt className="t-meta">
            {r.n} · {r.t}
          </dt>
          <dd className={r.v ? 'mt-0.5 break-words text-sm font-semibold text-ink' : 'mt-0.5'}>
            {r.v ?? 'Not chosen yet'}
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <PageHeader
        title="New session"
        description="A session opens one assessment for one cohort."
        back={{ to: '/instructor', label: 'Sessions & cohorts' }}
      />
      <Section title="Set up" aside={summary}>
        <div className="max-w-3xl">
          <Stepper steps={STEPS} current={step} label="Session setup steps" />
          <div className="mt-8">
            {loading ? (
              <LoadingBlock />
            ) : loadError ? (
              <ErrorState
                message={errorMessage(loadError)}
                onRetry={() => {
                  cohorts.refetch();
                  assessments.refetch();
                }}
              />
            ) : (
              <>
                {step === 0 && (
                  <fieldset>
                    <legend className="t-h2 mb-4">Which cohort is taking it?</legend>
                    {cohorts.data!.items.length === 0 ? (
                      <EmptyState title="No cohorts available">
                        Ask an administrator to assign you to a program.
                      </EmptyState>
                    ) : (
                      <div className="border-t-2 border-ink">
                        {cohorts.data!.items.map((c) => (
                          <Choice
                            key={c.id}
                            name="cohort"
                            checked={cohortId === c.id}
                            onChange={() => setCohortId(c.id)}
                            title={c.name}
                            detail={
                              <>
                                {c.programName} ·{' '}
                                <span className="t-num">{c.enrolledCount} enrolled</span>
                              </>
                            }
                          />
                        ))}
                      </div>
                    )}
                  </fieldset>
                )}

                {step === 1 && (
                  <fieldset>
                    <legend className="t-h2 mb-2">Which assessment?</legend>
                    <p className="t-small mb-4 max-w-2xl text-ink-2">
                      Forms A and B of the same family measure the same skills with different
                      questions — use one for the pre-assessment and the other for the
                      post-assessment.
                    </p>
                    {assessments.data!.items.length === 0 ? (
                      <EmptyState title="No active assessments">
                        An administrator needs to activate an assessment first.
                      </EmptyState>
                    ) : (
                      <div className="border-t-2 border-ink">
                        {assessments.data!.items.map((a) => (
                          <Choice
                            key={a.id}
                            name="assessment"
                            checked={assessmentId === a.id}
                            onChange={() => setAssessmentId(a.id)}
                            title={a.title}
                            detail={
                              <span className="t-num">
                                Family {a.formFamily} · Form {a.formLabel} · v{a.version} ·{' '}
                                {a.questionCount} questions · ~{a.estimatedMinutes} min ·{' '}
                                {titleCase(a.difficulty)}
                              </span>
                            }
                          />
                        ))}
                      </div>
                    )}
                  </fieldset>
                )}

                {step === 2 && (
                  <fieldset>
                    <legend className="t-h2 mb-2">What stage is this?</legend>
                    <p className="t-small mb-4 max-w-2xl text-ink-2">
                      The stage decides how results are used. Learning gains come only from students
                      with both a pre- and a post-assessment in this cohort.
                    </p>
                    <div className="border-t-2 border-ink">
                      {ASSESSMENT_STAGES.map((s) => (
                        <Choice
                          key={s}
                          name="stage"
                          checked={stage === s}
                          onChange={() => setStage(s)}
                          title={
                            <span className="flex flex-wrap items-center gap-2">
                              {STAGE_LABELS[s]}
                              {assessment?.intendedStages.includes(s) && (
                                <Badge tone="good">Designed for this</Badge>
                              )}
                            </span>
                          }
                          detail={STAGE_HELP[s]}
                        />
                      ))}
                    </div>
                    {stage && assessment && !assessment.intendedStages.includes(stage) && (
                      <Notice tone="warn" className="mt-4" role="status">
                        This assessment wasn’t designed for the {STAGE_LABELS[stage]} stage. You can
                        continue, but check with an administrator.
                      </Notice>
                    )}
                  </fieldset>
                )}

                {step === 3 && (
                  <div className="max-w-xl space-y-6">
                    <h2 className="t-h2">When should it open?</h2>
                    <div className="border-y border-ink py-4">
                      <Toggle
                        checked={openNow}
                        onChange={setOpenNow}
                        label="Open right away"
                        hint="Students can start as soon as you create the session."
                      />
                    </div>
                    {!openNow && (
                      <Input
                        label="Opens at"
                        type="datetime-local"
                        value={startsAt}
                        onChange={(e) => setStartsAt(e.target.value)}
                        hint="Uses this device’s time zone."
                      />
                    )}
                    <Input
                      label="Closes at (optional)"
                      type="datetime-local"
                      value={endsAt}
                      onChange={(e) => setEndsAt(e.target.value)}
                      hint="Leave blank to close it yourself."
                    />
                    <Input
                      label="Session name (optional)"
                      value={title}
                      maxLength={120}
                      onChange={(e) => setTitle(e.target.value)}
                      hint="Leave blank to use the assessment title and stage."
                    />
                    {formError && (
                      <Notice tone="bad" role="alert">
                        {formError}
                      </Notice>
                    )}
                  </div>
                )}

                <div className="mt-8 flex justify-between gap-3 border-t border-rule pt-5">
                  <Button
                    disabled={step === 0}
                    onClick={() => setStep((s) => s - 1)}
                    icon={<ArrowLeft size={16} aria-hidden="true" />}
                  >
                    Back
                  </Button>
                  {step < 3 ? (
                    <Button
                      variant="primary"
                      disabled={!canNext}
                      onClick={() => setStep((s) => s + 1)}
                      iconRight={<ArrowRight size={16} aria-hidden="true" />}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      loading={create.loading}
                      onClick={() => void submit()}
                      icon={<Check size={16} aria-hidden="true" />}
                    >
                      {openNow ? 'Create and open' : 'Schedule session'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
