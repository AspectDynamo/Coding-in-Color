import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { KeyRound } from 'lucide-react';
import type { AssessmentDetailDto, AssessmentSummaryDto, PublicQuestion } from '@shared/api';
import { SKILL_LABELS } from '@shared/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingBlock,
  Metric,
  PageHeader,
  Section,
  SegmentedControl,
  Select,
  useToast,
} from '@frontend/components/ui';
import { StageBadge } from '@frontend/components/StatusBadges';
import { AssessmentPreview } from '@frontend/components/assessment/AssessmentPreview';
import { QuestionRenderer } from '@frontend/components/assessment/QuestionRenderer';
import { readConfig } from '@frontend/components/assessment/config';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { titleCase } from '@frontend/lib/format';

type Status = AssessmentSummaryDto['status'];
type Q = AssessmentDetailDto['questions'][number];
type View = 'key' | 'preview';

/** Turns an answer key into a readable sentence for permitted staff. */
function describeKey(q: Q): string | null {
  const key = q.answerKey;
  if (q.type === 'confidence_likert') return 'Not scored — self-reported confidence.';
  if (!key) return null;
  const cfg = readConfig(q);
  const label = (id: unknown) =>
    cfg.options.find((o) => o.id === id)?.label ??
    cfg.items.find((o) => o.id === id)?.label ??
    String(id);
  if (typeof key.correctOptionId === 'string')
    return `Correct answer: ${label(key.correctOptionId)}`;
  if (Array.isArray(key.correctOptionIds))
    return `Correct answers: ${key.correctOptionIds.map(label).join('; ')}`;
  if (typeof key.bugLine === 'number') return `Bug is on line ${key.bugLine}`;
  if (Array.isArray(key.correctOrder))
    return `Correct order: ${key.correctOrder.map(label).join(' → ')}`;
  if (Array.isArray(key.acceptedAnswers))
    return `Accepted answers: ${key.acceptedAnswers.map(String).join(' | ')}${key.caseSensitive ? ' (case-sensitive)' : ''}`;
  return JSON.stringify(key);
}

export default function AssessmentDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const q = useQuery(`assessment-admin:${id}`, (s) =>
    api.get<AssessmentDetailDto>(`/admin/assessments/${id}`, undefined, s),
  );
  const [next, setNext] = useState<Status | ''>('');
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState<View>('key');
  const update = useMutation((status: Status) =>
    api.patch<AssessmentSummaryDto>(`/admin/assessments/${id}`, { status }),
  );
  // The student preview gets copies with the answer keys removed, so a key can never render there.
  const previewQuestions = useMemo<PublicQuestion[]>(
    () =>
      (q.data?.questions ?? [])
        .filter((x) => x.type !== 'project_rubric')
        .map((x) => ({
          id: x.id,
          type: x.type,
          prompt: x.prompt,
          config: x.config,
          skillCategory: x.skillCategory,
          points: x.points,
          order: x.order,
        }))
        .sort((a, b) => a.order - b.order),
    [q.data],
  );

  if (q.loading) return <LoadingBlock label="Loading assessment…" />;
  if (q.error || !q.data) {
    return (
      <ErrorState
        title="We couldn’t load this assessment"
        message={errorMessage(q.error)}
        onRetry={q.refetch}
      />
    );
  }
  const a = q.data;
  const target = next || a.status;
  const hasKeys = a.questions.some((x) => x.answerKey);
  const totalPoints = a.questions.reduce((sum, x) => sum + x.points, 0);

  return (
    <>
      <PageHeader
        title={a.title}
        back={{ to: '/admin/assessments', label: 'Assessments' }}
        eyebrow={`Family ${a.formFamily} · Form ${a.formLabel} · v${a.version}`}
        description={a.description || undefined}
      />

      <Section
        number="01"
        title="Details"
        aside="Only active assessments can be used in new sessions. Questions can’t be edited — create a new version instead."
      >
        <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-b border-rule pb-6 sm:grid-cols-4">
              <Metric label="Questions" value={a.questionCount} unit="count" />
              <Metric
                label="Total points"
                value={totalPoints}
                unit={Number.isInteger(totalPoints) ? 'count' : 'plain'}
              />
              <div className="metric metric-standard">
                <span className="metric-label">Time</span>
                <p className="metric-value">
                  ~{a.estimatedMinutes}
                  <span className="metric-unit"> min</span>
                </p>
              </div>
              <div className="metric">
                <span className="metric-label">Difficulty</span>
                <p className="t-h3 mt-1">{titleCase(a.difficulty)}</p>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-[0.9375rem]">
              <dt className="t-label">Status</dt>
              <dd>
                <Badge
                  tone={a.status === 'active' ? 'good' : a.status === 'draft' ? 'warn' : 'neutral'}
                >
                  {titleCase(a.status)}
                </Badge>
              </dd>
              <dt className="t-label">Intended stages</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1">
                {a.intendedStages.map((s) => (
                  <StageBadge key={s} stage={s} />
                ))}
              </dd>
              <dt className="t-label">Skills covered</dt>
              <dd className="text-ink-2">
                {a.skillCategories.map((k) => SKILL_LABELS[k]).join(', ') || '—'}
              </dd>
            </dl>
          </div>

          <div className="border-t-2 border-ink pt-4">
            <h3 className="t-h4">Change status</h3>
            <Select
              label="Status"
              wrapperClassName="mt-3"
              value={target}
              onChange={(e) => setNext(e.target.value as Status)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </Select>
            <Button
              variant="primary"
              block
              className="mt-4"
              disabled={target === a.status}
              onClick={() => setConfirm(true)}
            >
              Update status
            </Button>
          </div>
        </div>
      </Section>

      <Section
        number="02"
        title="Questions"
        aside={
          view === 'key' ? (
            <>
              Questions appear as students see them, with the controls locked.{' '}
              {hasKeys
                ? 'Answer keys are shown under each question and are never sent to students.'
                : 'Answer keys are hidden for your role.'}
            </>
          ) : (
            'The student view, one question at a time. Answer keys are not part of this view; nothing you pick is saved or scored.'
          )
        }
        actions={
          <SegmentedControl<View>
            label="Question view"
            value={view}
            onChange={setView}
            items={[
              { value: 'key', label: 'Answer key' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
        }
      >
        {view === 'preview' ? (
          <AssessmentPreview
            questions={previewQuestions}
            title={a.title}
            description={a.description}
          />
        ) : (
          <ol className="border-t-2 border-ink" aria-label="Questions">
            {a.questions.map((question, i) => {
              const key = describeKey(question);
              const pid = `pq-${question.id}`;
              return (
                <li
                  key={question.id}
                  className="grid gap-x-5 gap-y-3 border-b border-rule py-6 md:grid-cols-[2.5rem_minmax(0,1fr)]"
                >
                  <span className="count-cell" data-state="answered" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="min-w-0 max-w-3xl">
                    <p className="t-caption flex flex-wrap gap-x-2 gap-y-1">
                      <span className="sr-only">Question {i + 1}: </span>
                      <span>{titleCase(question.type)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{SKILL_LABELS[question.skillCategory]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{titleCase(question.difficulty)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="t-num">
                        {question.points} {question.points === 1 ? 'point' : 'points'}
                      </span>
                    </p>
                    <h3 id={pid} className="t-h3 mb-4 mt-1.5 whitespace-pre-line">
                      {question.prompt}
                    </h3>
                    <QuestionRenderer
                      question={question}
                      value={undefined}
                      onChange={() => {}}
                      disabled
                      labelledBy={pid}
                    />
                    {key && (
                      <p
                        className="mt-4 flex items-start gap-2 border-l-4 border-green-ink bg-green-tint px-3 py-2.5 text-sm font-semibold text-ink"
                        data-testid="answer-key"
                      >
                        <KeyRound
                          size={16}
                          className="mt-0.5 flex-none text-green-ink"
                          aria-hidden="true"
                        />
                        <span>{key}</span>
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <ConfirmDialog
        open={confirm}
        busy={update.loading}
        onClose={() => setConfirm(false)}
        title={`Mark as ${target}?`}
        description={
          target === 'active'
            ? 'Instructors will be able to choose this assessment for new sessions.'
            : target === 'retired'
              ? 'It will no longer be offered for new sessions. Existing results are kept.'
              : 'It will be hidden from instructors until activated again.'
        }
        confirmLabel="Update status"
        onConfirm={async () => {
          try {
            await update.run(target);
            toast.success(`Assessment is now ${target}.`);
            setConfirm(false);
            setNext('');
            q.refetch();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
