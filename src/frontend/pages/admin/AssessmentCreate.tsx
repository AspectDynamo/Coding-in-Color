import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react';
import type { AssessmentSummaryDto, CourseDto, PublicQuestion } from '@shared/api';
import {
  ASSESSMENT_STAGES,
  DIFFICULTIES,
  SKILL_CATEGORIES,
  SKILL_LABELS,
  type AssessmentStage,
  type Difficulty,
  type SkillCategory,
} from '@shared/types';
import {
  Button,
  Checkbox,
  Fieldset,
  IconButton,
  Input,
  Metric,
  Notice,
  PageHeader,
  Section,
  SegmentedControl,
  Select,
  Textarea,
  useToast,
} from '@frontend/components/ui';
import { AssessmentPreview } from '@frontend/components/assessment/AssessmentPreview';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { STAGE_LABELS, titleCase } from '@frontend/lib/format';

const TYPES = [
  { value: 'multiple_choice', label: 'Multiple choice (one answer)' },
  { value: 'multiple_select', label: 'Multiple select (several answers)' },
  { value: 'code_comprehension', label: 'Code comprehension (code + one answer)' },
  { value: 'predict_output', label: 'Predict the output (code + one answer)' },
  { value: 'debugging', label: 'Debugging (tap the buggy line)' },
  { value: 'ordering', label: 'Ordering (put steps in order)' },
  { value: 'short_logic', label: 'Short answer' },
  { value: 'confidence_likert', label: 'Confidence rating 1–5 (not scored)' },
] as const;
type QType = (typeof TYPES)[number]['value'];
const TYPE_SHORT: Record<QType, string> = {
  multiple_choice: 'Multiple choice',
  multiple_select: 'Multiple select',
  code_comprehension: 'Code comprehension',
  predict_output: 'Predict the output',
  debugging: 'Debugging',
  ordering: 'Ordering',
  short_logic: 'Short answer',
  confidence_likert: 'Confidence rating',
};

interface Draft {
  uid: number;
  type: QType;
  prompt: string;
  skill: SkillCategory;
  difficulty: Difficulty;
  points: string;
  code: string;
  language: string;
  options: string[];
  correct: number[]; // indexes into options
  bugLine: string;
  hint: string;
  accepted: string;
  caseSensitive: boolean;
  minLabel: string;
  maxLabel: string;
}

let uidSeq = 1;
const newQuestion = (type: QType = 'multiple_choice'): Draft => ({
  uid: uidSeq++,
  type,
  prompt: '',
  skill: 'programming_fundamentals',
  difficulty: 'intro',
  points: '1',
  code: '',
  language: 'python',
  options: ['', '', ''],
  correct: [],
  bugLine: '',
  hint: '',
  accepted: '',
  caseSensitive: false,
  minLabel: 'Not at all confident',
  maxLabel: 'Very confident',
});

const SINGLE: QType[] = ['multiple_choice', 'code_comprehension', 'predict_output'];
const usesOptions = (t: QType) => SINGLE.includes(t) || t === 'multiple_select' || t === 'ordering';
const usesCode = (t: QType) => t !== 'ordering' && t !== 'confidence_likert';
const optId = (i: number) => 'abcdefgh'[i] ?? `o${i}`;

/** Validates one draft and builds the API question; returns an error string instead when invalid. */
function build(
  q: Draft,
  n: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const where = `Question ${n}`;
  const err = (m: string) => ({ ok: false as const, error: `${where}: ${m}` });
  if (q.prompt.trim().length < 3) return err('write a prompt (at least 3 characters).');
  const points = q.type === 'confidence_likert' ? 0 : Number(q.points);
  if (!Number.isFinite(points) || points < 0 || points > 10)
    return err('points must be between 0 and 10.');
  const code = q.code.trimEnd();
  const lang = q.language.trim();
  let config: Record<string, unknown>;
  let answerKey: Record<string, unknown> | null = null;

  if (usesOptions(q.type)) {
    const opts = q.options.map((label, i) => ({ id: optId(i), label: label.trim() }));
    if (opts.some((o) => !o.label)) return err('fill in or remove empty options.');
    if (opts.length < 2) return err('add at least 2 options.');
    if (q.type === 'ordering') {
      config = { items: opts };
      answerKey = { correctOrder: opts.map((o) => o.id) };
    } else {
      config = { options: opts, ...(code ? { code, ...(lang ? { language: lang } : {}) } : {}) };
      const correct = q.correct.filter((i) => i < opts.length);
      if (q.type === 'multiple_select') {
        if (correct.length < 1) return err('tick at least one correct option.');
        answerKey = { correctOptionIds: correct.map(optId) };
      } else {
        if (correct.length !== 1) return err('choose the correct option.');
        answerKey = { correctOptionId: optId(correct[0]!) };
      }
      if ((q.type === 'code_comprehension' || q.type === 'predict_output') && !code)
        return err('add the code snippet.');
    }
  } else if (q.type === 'debugging') {
    if (!code) return err('add the code snippet.');
    const lines = code.split('\n').length;
    const bug = Number(q.bugLine);
    if (!Number.isInteger(bug) || bug < 1 || bug > lines)
      return err(`the bug line must be a line number from 1 to ${lines}.`);
    config = {
      code,
      ...(lang ? { language: lang } : {}),
      ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
    };
    answerKey = { bugLine: bug };
  } else if (q.type === 'short_logic') {
    const accepted = q.accepted
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (accepted.length === 0) return err('add at least one accepted answer.');
    config = { maxLength: 40, ...(code ? { code, ...(lang ? { language: lang } : {}) } : {}) };
    answerKey = { acceptedAnswers: accepted, caseSensitive: q.caseSensitive };
  } else {
    config = {
      minLabel: q.minLabel.trim() || 'Not at all confident',
      maxLabel: q.maxLabel.trim() || 'Very confident',
    };
  }
  return {
    ok: true,
    value: {
      questionType: q.type,
      prompt: q.prompt.trim(),
      config,
      answerKey,
      skillCategory: q.skill,
      difficulty: q.difficulty,
      points,
    },
  };
}

/** Student-facing projection of a draft for the preview: lenient, and never includes an answer key. */
function toPublic(q: Draft, i: number): PublicQuestion {
  const code = q.code.trimEnd();
  const lang = q.language.trim();
  const codePart = code && usesCode(q.type) ? { code, ...(lang ? { language: lang } : {}) } : {};
  const opts = q.options.map((label, oi) => ({
    id: optId(oi),
    label: label.trim() || `${q.type === 'ordering' ? 'Step' : 'Option'} ${oi + 1} (empty)`,
  }));
  let config: Record<string, unknown>;
  if (q.type === 'ordering') config = { items: opts };
  else if (usesOptions(q.type)) config = { options: opts, ...codePart };
  else if (q.type === 'debugging')
    config = { ...codePart, ...(q.hint.trim() ? { hint: q.hint.trim() } : {}) };
  else if (q.type === 'short_logic') config = { maxLength: 40, ...codePart };
  else
    config = {
      minLabel: q.minLabel.trim() || 'Not at all confident',
      maxLabel: q.maxLabel.trim() || 'Very confident',
    };
  const points = q.type === 'confidence_likert' ? 0 : Number(q.points);
  return {
    id: `draft-${q.uid}`,
    type: q.type,
    prompt: q.prompt,
    config,
    skillCategory: q.skill,
    points: Number.isFinite(points) ? points : 0,
    order: i,
  };
}

type Mode = 'edit' | 'preview';

function QuestionEditor({
  q,
  n,
  total,
  headingRef,
  patch,
  onMove,
  onRemove,
}: {
  q: Draft;
  n: number;
  total: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  patch: (change: Partial<Draft>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const i = n - 1;
  return (
    <section aria-labelledby="q-editor-h" className="min-w-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3">
        <h3 id="q-editor-h" ref={headingRef} tabIndex={-1} className="t-h3 flex items-center gap-3">
          <span className="count-cell" data-current="true" aria-hidden="true">
            {n}
          </span>
          Question {n}
          <span className="t-caption t-num font-normal">of {total}</span>
        </h3>
        <div className="flex gap-2">
          <IconButton
            size="sm"
            label={`Move question ${n} up`}
            disabled={i === 0}
            onClick={() => onMove(i - 1)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            size="sm"
            label={`Move question ${n} down`}
            disabled={i === total - 1}
            onClick={() => onMove(i + 1)}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            size="sm"
            variant="danger"
            label={`Remove question ${n}`}
            disabled={total === 1}
            onClick={onRemove}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
        <Select
          label="Type"
          value={q.type}
          onChange={(e) => patch({ type: e.target.value as QType, correct: [] })}
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select
          label="Skill"
          value={q.skill}
          onChange={(e) => patch({ skill: e.target.value as SkillCategory })}
        >
          {SKILL_CATEGORIES.map((s) => (
            <option key={s} value={s}>
              {SKILL_LABELS[s]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Prompt"
          wrapperClassName="md:col-span-2"
          value={q.prompt}
          maxLength={1000}
          onChange={(e) => patch({ prompt: e.target.value })}
          hint={
            q.type === 'confidence_likert'
              ? 'Students see “How confident do you feel?” above this. Example: “…reading a for loop?”'
              : undefined
          }
        />

        {usesCode(q.type) && (
          <>
            <Textarea
              label={
                q.type === 'debugging' ||
                q.type === 'code_comprehension' ||
                q.type === 'predict_output'
                  ? 'Code snippet'
                  : 'Code snippet (optional)'
              }
              wrapperClassName="md:col-span-2"
              className="font-mono text-sm"
              rows={5}
              value={q.code}
              maxLength={4000}
              spellCheck={false}
              onChange={(e) => patch({ code: e.target.value })}
              hint="Shown with line numbers. Never executed."
            />
            <Input
              label="Language label"
              value={q.language}
              maxLength={20}
              onChange={(e) => patch({ language: e.target.value })}
              hint="python, javascript, pseudocode…"
            />
          </>
        )}

        {q.type === 'debugging' && (
          <>
            <Input
              label="Line number with the bug"
              type="number"
              min={1}
              value={q.bugLine}
              onChange={(e) => patch({ bugLine: e.target.value })}
            />
            <Input
              label="Hint (optional)"
              wrapperClassName="md:col-span-2"
              value={q.hint}
              maxLength={300}
              onChange={(e) => patch({ hint: e.target.value })}
            />
          </>
        )}

        {q.type === 'short_logic' && (
          <>
            <Textarea
              label="Accepted answers"
              wrapperClassName="md:col-span-2"
              rows={3}
              value={q.accepted}
              onChange={(e) => patch({ accepted: e.target.value })}
              hint="One per line. Extra spaces are ignored when scoring."
            />
            <Checkbox
              label="Case-sensitive"
              checked={q.caseSensitive}
              onChange={(e) => patch({ caseSensitive: e.target.checked })}
            />
          </>
        )}

        {q.type === 'confidence_likert' && (
          <>
            <Input
              label="Label for 1"
              value={q.minLabel}
              maxLength={60}
              onChange={(e) => patch({ minLabel: e.target.value })}
            />
            <Input
              label="Label for 5"
              value={q.maxLabel}
              maxLength={60}
              onChange={(e) => patch({ maxLabel: e.target.value })}
            />
          </>
        )}

        {usesOptions(q.type) && (
          <fieldset className="md:col-span-2">
            <legend className="field-label">
              {q.type === 'ordering' ? 'Steps, in the correct order' : 'Options and answer key'}
            </legend>
            <p className="field-hint mb-3 mt-0">
              {q.type === 'ordering'
                ? 'Enter the steps in the right order. Students see them shuffled.'
                : q.type === 'multiple_select'
                  ? 'Tick every correct option. Wrong picks reduce partial credit.'
                  : 'Select the one correct option.'}
            </p>
            <ul className="border-t border-ink">
              {q.options.map((opt, oi) => (
                <li key={oi} className="flex items-center gap-3 border-b border-rule py-2">
                  {q.type !== 'ordering' ? (
                    <input
                      type={q.type === 'multiple_select' ? 'checkbox' : 'radio'}
                      name={`correct-${q.uid}`}
                      className="check"
                      aria-label={`Option ${oi + 1} is correct`}
                      checked={q.correct.includes(oi)}
                      onChange={(e) =>
                        patch({
                          correct:
                            q.type === 'multiple_select'
                              ? e.target.checked
                                ? [...q.correct, oi]
                                : q.correct.filter((x) => x !== oi)
                              : [oi],
                        })
                      }
                    />
                  ) : (
                    <span className="count-cell flex-none" data-state="answered" aria-hidden="true">
                      {oi + 1}
                    </span>
                  )}
                  <span className="t-mono w-4 flex-none text-sm text-ink-3" aria-hidden="true">
                    {q.type === 'ordering' ? '' : optId(oi).toUpperCase()}
                  </span>
                  <input
                    className="input input-sm min-w-0 flex-1"
                    aria-label={q.type === 'ordering' ? `Step ${oi + 1}` : `Option ${oi + 1} text`}
                    value={opt}
                    maxLength={500}
                    onChange={(e) =>
                      patch({
                        options: q.options.map((o, x) => (x === oi ? e.target.value : o)),
                      })
                    }
                  />
                  <IconButton
                    size="sm"
                    variant="quiet"
                    label={`Remove ${q.type === 'ordering' ? 'step' : 'option'} ${oi + 1}`}
                    disabled={q.options.length <= 2}
                    onClick={() =>
                      patch({
                        options: q.options.filter((_, x) => x !== oi),
                        correct: q.correct.filter((x) => x !== oi).map((x) => (x > oi ? x - 1 : x)),
                      })
                    }
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              className="mt-3"
              icon={<Plus size={14} aria-hidden="true" />}
              disabled={q.options.length >= 8}
              onClick={() => patch({ options: [...q.options, ''] })}
            >
              Add {q.type === 'ordering' ? 'step' : 'option'}
            </Button>
          </fieldset>
        )}

        <div className="grid gap-x-4 gap-y-5 border-t border-rule pt-5 md:col-span-2 md:grid-cols-2">
          <Select
            label="Difficulty"
            value={q.difficulty}
            onChange={(e) => patch({ difficulty: e.target.value as Difficulty })}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {titleCase(d)}
              </option>
            ))}
          </Select>
          {q.type === 'confidence_likert' ? (
            <p className="t-small self-end pb-3 text-ink-2">
              Not scored — reported separately as self-reported confidence.
            </p>
          ) : (
            <Input
              label="Points"
              type="number"
              min={0}
              max={10}
              step="0.5"
              value={q.points}
              onChange={(e) => patch({ points: e.target.value })}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export default function AssessmentCreate() {
  const navigate = useNavigate();
  const toast = useToast();
  const courses = useQuery('admin-courses', (s) =>
    api.page<CourseDto>('/admin/courses', undefined, s),
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formFamily, setFormFamily] = useState('');
  const [formLabel, setFormLabel] = useState('A');
  const [courseId, setCourseId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('intro');
  const [minutes, setMinutes] = useState('5');
  const [stages, setStages] = useState<AssessmentStage[]>(['PRE', 'POST']);
  const [questions, setQuestions] = useState<Draft[]>(() => [newQuestion()]);
  const [selectedUid, setSelectedUid] = useState<number>(() => questions[0]!.uid);
  const [mode, setMode] = useState<Mode>('edit');
  const [errors, setErrors] = useState<string[]>([]);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const focusEditor = useRef(false);
  const create = useMutation((body: unknown) =>
    api.post<AssessmentSummaryDto>('/admin/assessments', body),
  );

  const selectedIndex = Math.max(
    0,
    questions.findIndex((q) => q.uid === selectedUid),
  );
  const selected = questions[selectedIndex]!;

  // After choosing or adding a question from the outline, move focus to its editor heading.
  useEffect(() => {
    if (!focusEditor.current) return;
    focusEditor.current = false;
    editorHeading.current?.focus();
  }, [selectedUid, mode]);

  const select = (uid: number) => {
    focusEditor.current = true;
    setMode('edit');
    setSelectedUid(uid);
  };
  const patch = (uid: number, change: Partial<Draft>) =>
    setQuestions((qs) => qs.map((q) => (q.uid === uid ? { ...q, ...change } : q)));
  const move = (i: number, to: number) =>
    setQuestions((qs) => {
      if (to < 0 || to >= qs.length) return qs;
      const next = [...qs];
      const [item] = next.splice(i, 1);
      next.splice(to, 0, item!);
      return next;
    });
  const addQuestion = () => {
    const q = newQuestion();
    setQuestions((qs) => [...qs, q]);
    select(q.uid);
  };
  const removeQuestion = (uid: number) => {
    const i = questions.findIndex((q) => q.uid === uid);
    const neighbour = questions[i + 1] ?? questions[i - 1];
    setQuestions((qs) => qs.filter((x) => x.uid !== uid));
    if (neighbour) select(neighbour.uid);
  };

  /** One validation pass, used both for the live "still to do" list and on save. */
  const check = () => {
    const errs: string[] = [];
    if (title.trim().length < 3) errs.push('Give the assessment a title (at least 3 characters).');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(formFamily) || formFamily.length < 2)
      errs.push('Form family must be lowercase letters, numbers and dashes, like “python-basics”.');
    if (!formLabel.trim()) errs.push('Enter a form label, like A or B.');
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 15)
      errs.push('Estimated minutes must be a whole number from 1 to 15.');
    if (stages.length === 0) errs.push('Choose at least one intended stage.');
    const built = questions.map((q, i) => build(q, i + 1));
    for (const b of built) if (!b.ok) errs.push(b.error);
    if (!questions.some((q) => q.type !== 'confidence_likert' && Number(q.points) > 0))
      errs.push('Add at least one scored question (worth more than 0 points).');
    return { errs, built, mins };
  };
  const live = check();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { errs, built, mins } = check();
    setErrors(errs);
    if (errs.length) {
      document.getElementById('form-errors')?.focus();
      return;
    }
    try {
      const created = await create.run({
        courseId: courseId || null,
        formFamily,
        formLabel: formLabel.trim(),
        title: title.trim(),
        description: description.trim(),
        difficulty,
        estimatedMinutes: mins,
        intendedStages: stages,
        questions: built.flatMap((b) => (b.ok ? [b.value] : [])),
      });
      toast.success('Draft created. Review it, then set the status to Active.');
      navigate(`/admin/assessments/${created.id}`);
    } catch (err) {
      setErrors([errorMessage(err)]);
      document.getElementById('form-errors')?.focus();
    }
  };

  const scored = questions.filter((q) => q.type !== 'confidence_likert');
  const totalPoints = scored.reduce((sum, q) => {
    const p = Number(q.points);
    return sum + (Number.isFinite(p) && p > 0 ? p : 0);
  }, 0);
  const skills = SKILL_CATEGORIES.filter((s) => scored.some((q) => q.skill === s));

  const outline = (
    <div className="lg:sticky lg:top-6">
      <p className="t-meta mb-2 mt-4">Outline</p>
      <ol className="border-t border-ink" aria-label="Question outline">
        {questions.map((q, i) => {
          const current = q.uid === selected.uid && mode === 'edit';
          const ready = live.built[i]?.ok;
          return (
            <li key={q.uid} className="border-b border-rule">
              <button
                type="button"
                className="flex w-full items-start gap-2.5 py-2.5 text-left hover:bg-sheet"
                aria-current={current ? 'true' : undefined}
                onClick={() => select(q.uid)}
              >
                <span
                  className="count-cell mt-0.5 flex-none"
                  data-state={ready ? 'answered' : 'open'}
                  data-current={current || undefined}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">Question {i + 1}: </span>
                  <span className="block truncate text-sm font-semibold text-ink">
                    {q.prompt.trim() || 'No prompt yet'}
                  </span>
                  <span className="block truncate text-[0.8125rem] font-normal normal-case tracking-normal text-ink-3">
                    {TYPE_SHORT[q.type]}
                    {!ready && ' · incomplete'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Button
        size="sm"
        className="mt-3"
        icon={<Plus size={14} aria-hidden="true" />}
        disabled={questions.length >= 30}
        onClick={addQuestion}
      >
        Add question
      </Button>
      <p className="t-num mt-2">{questions.length} of 30 questions</p>
    </div>
  );

  const summary = (
    <aside
      aria-labelledby="summary-h"
      className="border-t-2 border-ink pt-3 xl:sticky xl:top-6 xl:self-start"
    >
      <h3 id="summary-h" className="t-h4 mb-1">
        Summary
      </h3>
      <Metric size="inline" label="Questions" value={questions.length} unit="count" />
      <Metric size="inline" label="Scored questions" value={scored.length} unit="count" />
      <Metric
        size="inline"
        label="Total points"
        value={totalPoints}
        unit={Number.isInteger(totalPoints) ? 'count' : 'plain'}
      />
      <p className="t-label mt-4">Skills covered</p>
      {skills.length ? (
        <ul className="t-small mt-1 space-y-0.5 text-ink-2">
          {skills.map((s) => (
            <li key={s}>{SKILL_LABELS[s]}</li>
          ))}
        </ul>
      ) : (
        <p className="t-small mt-1 text-ink-3">None yet</p>
      )}
      <p className="t-label mt-4">Still to do</p>
      {live.errs.length ? (
        <ul className="t-small mt-1 list-disc space-y-1 pl-4 text-ink-2">
          {live.errs.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : (
        <p className="t-small mt-1 flex items-center gap-1.5 font-semibold text-green-ink">
          <Check size={15} aria-hidden="true" />
          Ready to save
        </p>
      )}
    </aside>
  );

  return (
    <>
      <PageHeader
        title="New assessment"
        back={{ to: '/admin/assessments', label: 'Assessments' }}
        description="Saved as a draft. Keep it short — students should finish in about six minutes or less."
        actions={
          <SegmentedControl<Mode>
            label="Editor mode"
            value={mode}
            onChange={setMode}
            items={[
              { value: 'edit', label: 'Edit' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
        }
      />
      <form onSubmit={submit} noValidate>
        {mode === 'preview' ? (
          <Section
            number="01"
            title="Student preview"
            aside={
              <>
                <p>
                  This is the unsaved draft as a student would see it. Answer keys are left out, and
                  nothing you pick here is saved, scored or sent anywhere.
                </p>
                {questions.some((q) => q.type === 'ordering') && (
                  <p className="mt-2">Ordering steps are shuffled for students.</p>
                )}
                {outline}
              </>
            }
          >
            <AssessmentPreview
              questions={questions.map(toPublic)}
              title={title}
              description={description}
            />
          </Section>
        ) : (
          <>
            <Section
              number="01"
              title="Details"
              aside="Forms in one family (A, B…) measure the same skills with different questions, so pre and post results can be compared."
            >
              <div className="grid max-w-4xl gap-x-4 gap-y-5 md:grid-cols-6">
                <Input
                  label="Title"
                  wrapperClassName="md:col-span-6"
                  value={title}
                  maxLength={160}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Textarea
                  label="Description for students (optional)"
                  wrapperClassName="md:col-span-6"
                  value={description}
                  maxLength={1000}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <Input
                  label="Form family"
                  wrapperClassName="md:col-span-4"
                  value={formFamily}
                  maxLength={60}
                  onChange={(e) =>
                    setFormFamily(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                  }
                  hint="Lowercase with dashes, e.g. python-basics. Forms in one family are compared pre/post."
                  spellCheck={false}
                  className="font-mono"
                />
                <Input
                  label="Form label"
                  wrapperClassName="md:col-span-2"
                  value={formLabel}
                  maxLength={4}
                  onChange={(e) => setFormLabel(e.target.value.toUpperCase())}
                  hint="A, B, C…"
                  className="font-mono"
                />
                <Select
                  label="Course (optional)"
                  wrapperClassName="md:col-span-2"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                >
                  <option value="">Any course</option>
                  {courses.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Difficulty"
                  wrapperClassName="md:col-span-2"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {titleCase(d)}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Estimated minutes"
                  wrapperClassName="md:col-span-2"
                  type="number"
                  min={1}
                  max={15}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
                <Fieldset legend="Intended stages" className="md:col-span-6">
                  <div className="flex flex-wrap gap-x-8 gap-y-3">
                    {ASSESSMENT_STAGES.map((s) => (
                      <Checkbox
                        key={s}
                        label={STAGE_LABELS[s]}
                        checked={stages.includes(s)}
                        onChange={(e) =>
                          setStages((cur) =>
                            e.target.checked ? [...cur, s] : cur.filter((x) => x !== s),
                          )
                        }
                      />
                    ))}
                  </div>
                </Fieldset>
              </div>
            </Section>

            <Section
              number="02"
              title="Questions"
              aside={
                <>
                  <p>Pick a question to edit it. A filled square means it is complete.</p>
                  {outline}
                </>
              }
            >
              <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_14rem]">
                <QuestionEditor
                  key={selected.uid}
                  q={selected}
                  n={selectedIndex + 1}
                  total={questions.length}
                  headingRef={editorHeading}
                  patch={(change) => patch(selected.uid, change)}
                  onMove={(to) => move(selectedIndex, to)}
                  onRemove={() => removeQuestion(selected.uid)}
                />
                {summary}
              </div>
            </Section>
          </>
        )}

        <Section
          number={mode === 'preview' ? '02' : '03'}
          title="Save"
          aside="Saving creates a draft. Review it, then set its status to Active so instructors can use it. Questions can’t be changed after saving."
        >
          <div id="form-errors" tabIndex={-1} aria-live="assertive">
            {errors.length > 0 && (
              <Notice
                tone="bad"
                role="alert"
                className="mb-5"
                title={
                  errors.length === 1
                    ? 'Fix this before saving'
                    : `Fix these ${errors.length} things before saving`
                }
              >
                <ul className="list-disc pl-5">
                  {errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" loading={create.loading}>
              Save as draft
            </Button>
            <Button onClick={() => navigate('/admin/assessments')}>Cancel</Button>
          </div>
        </Section>
      </form>
    </>
  );
}
