import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import type { PublicQuestion, ResponseValue } from '@shared/api';
import { Badge, IconButton, Button } from '@frontend/components/ui';
import { CodeBlock } from './CodeBlock';
import { readConfig } from './config';

export interface QuestionProps {
  question: PublicQuestion;
  value: ResponseValue | undefined;
  /** undefined clears the answer. */
  onChange: (value: ResponseValue | undefined) => void;
  /** Staff preview: controls are shown but cannot be changed. */
  disabled?: boolean;
  /** id of the element that labels the answer group (the prompt heading). */
  labelledBy: string;
}

const LETTERS = 'ABCDEFGH';

/** Renders the answer area for one question. Add a case here when a new QUESTION_TYPE is added. */
export function QuestionRenderer(props: QuestionProps) {
  switch (props.question.type) {
    case 'multiple_choice':
    case 'code_comprehension':
    case 'predict_output':
      return <SingleChoice {...props} />;
    case 'multiple_select':
      return <MultiSelect {...props} />;
    case 'debugging':
      return <Debugging {...props} />;
    case 'ordering':
      return <Ordering {...props} />;
    case 'short_logic':
      return <ShortLogic {...props} />;
    case 'confidence_likert':
      return <Likert {...props} />;
    default:
      return <p className="t-small">This kind of question isn’t answered here. You can skip it.</p>;
  }
}

function SingleChoice({ question, value, onChange, disabled, labelledBy }: QuestionProps) {
  const cfg = readConfig(question);
  const name = useId();
  const selected = value?.kind === 'single' ? value.optionId : null;
  return (
    <div className="space-y-4">
      {cfg.code && <CodeBlock code={cfg.code} language={cfg.language} />}
      <div role="radiogroup" aria-labelledby={labelledBy} className="space-y-3">
        {cfg.options.map((o, i) => (
          <label key={o.id} className="option">
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={o.id}
              checked={selected === o.id}
              disabled={disabled}
              onChange={() => onChange({ kind: 'single', optionId: o.id })}
            />
            <span className="option-mark" aria-hidden="true">
              {LETTERS[i] ?? i + 1}
            </span>
            <span className="option-body break-words">{o.label}</span>
            <Check size={20} className="option-check" aria-hidden="true" />
          </label>
        ))}
      </div>
    </div>
  );
}

function MultiSelect({ question, value, onChange, disabled, labelledBy }: QuestionProps) {
  const cfg = readConfig(question);
  const selected = value?.kind === 'multi' ? value.optionIds : [];
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length ? { kind: 'multi', optionIds: next } : undefined);
  };
  return (
    <div className="space-y-4">
      {cfg.code && <CodeBlock code={cfg.code} language={cfg.language} />}
      <p className="font-semibold text-ink">
        Pick every answer that fits — there may be more than one.
      </p>
      <div role="group" aria-labelledby={labelledBy} className="space-y-3">
        {cfg.options.map((o) => (
          <label key={o.id} className="option">
            <input
              type="checkbox"
              className="sr-only"
              checked={selected.includes(o.id)}
              disabled={disabled}
              onChange={() => toggle(o.id)}
            />
            <span className="option-mark option-mark-square" aria-hidden="true">
              {selected.includes(o.id) ? <Check size={18} /> : ''}
            </span>
            <span className="option-body break-words">{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Debugging({ question, value, onChange, disabled, labelledBy }: QuestionProps) {
  const cfg = readConfig(question);
  const name = useId();
  const lines = (cfg.code ?? '').replace(/\n$/, '').split('\n');
  const selected = value?.kind === 'line' ? value.line : null;
  return (
    <div className="space-y-3">
      <p className="font-semibold text-ink">Tap the line that has the bug.</p>
      <div role="radiogroup" aria-labelledby={labelledBy} className="codeblock">
        {lines.map((line, i) => (
          <label key={i} className="codeblock-line">
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={selected === i + 1}
              disabled={disabled}
              onChange={() => onChange({ kind: 'line', line: i + 1 })}
              aria-label={`Line ${i + 1}: ${line.trim() || 'blank line'}`}
            />
            <span className="codeblock-ln" aria-hidden="true">
              {i + 1}
            </span>
            <code aria-hidden="true">{line || ' '}</code>
          </label>
        ))}
      </div>
      <p className="t-small t-num min-h-6 text-ink-2" aria-live="polite">
        {selected ? `You picked line ${selected}.` : 'No line picked yet.'}
      </p>
      {cfg.hint && <p className="t-caption">Hint: {cfg.hint}</p>}
    </div>
  );
}

function Ordering({ question, value, onChange, disabled, labelledBy }: QuestionProps) {
  const cfg = readConfig(question);
  const [announce, setAnnounce] = useState('');
  const presented = cfg.items.map((i) => i.id);
  const saved =
    value?.kind === 'order' && value.itemIds.length === presented.length ? value.itemIds : null;
  const order = saved ?? presented;
  const byId = new Map(cfg.items.map((i) => [i.id, i.label]));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    onChange({ kind: 'order', itemIds: next });
    setAnnounce(`${byId.get(item) ?? 'Item'} moved to position ${to + 1} of ${next.length}.`);
  };

  return (
    <div className="space-y-3">
      <p className="font-semibold text-ink">
        Use the arrows to put the steps in order, first step at the top.
      </p>
      <ol aria-labelledby={labelledBy} className="border-t border-ink">
        {order.map((id, i) => {
          const label = byId.get(id) ?? id;
          return (
            <li
              key={id}
              className="flex items-center gap-3 border-b border-ink bg-sheet py-2 pl-2 pr-2"
            >
              <span className="count-cell flex-none" data-state="answered" aria-hidden="true">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 break-words font-medium text-ink">
                <span className="sr-only">Step {i + 1}: </span>
                {label}
              </span>
              <span className="flex flex-none gap-1.5">
                <IconButton
                  label={`Move “${label}” up`}
                  disabled={disabled || i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp size={18} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move “${label}” down`}
                  disabled={disabled || i === order.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown size={18} aria-hidden="true" />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {!disabled &&
        (saved ? (
          <Badge tone="good" icon={<Check size={13} aria-hidden="true" />}>
            Order saved
          </Badge>
        ) : (
          <Button size="sm" onClick={() => onChange({ kind: 'order', itemIds: presented })}>
            This order is already right
          </Button>
        ))}
    </div>
  );
}

function ShortLogic({ question, value, onChange, disabled, labelledBy }: QuestionProps) {
  const cfg = readConfig(question);
  const id = useId();
  const text = value?.kind === 'text' ? value.text : '';
  const max = Math.min(cfg.maxLength, 100);
  return (
    <div className="space-y-4">
      {cfg.code && <CodeBlock code={cfg.code} language={cfg.language} />}
      <div>
        <input
          id={id}
          className="input input-code !normal-case"
          aria-labelledby={labelledBy}
          aria-describedby={`${id}-h`}
          value={text}
          maxLength={max}
          disabled={disabled}
          placeholder={cfg.placeholder ?? 'Type your answer'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          onChange={(e) => {
            const t = e.target.value.slice(0, max);
            onChange(t.trim() ? { kind: 'text', text: t } : undefined);
          }}
        />
        <p id={`${id}-h`} className="field-hint">
          Short answer — a number or a word or two. Up to {max} characters.
        </p>
      </div>
    </div>
  );
}

const LIKERT = [1, 2, 3, 4, 5] as const;

function Likert({ question, value, onChange, disabled, labelledBy }: QuestionProps) {
  const cfg = readConfig(question);
  const name = useId();
  const selected = value?.kind === 'likert' ? value.value : null;
  return (
    <div className="border-l-4 border-sage bg-sheet p-4 sm:p-5" data-testid="likert-panel">
      <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-sage-ink">
        <span className="h-2.5 w-2.5 rounded-full bg-sage" aria-hidden="true" />
        About you — not scored
      </p>
      <p className="mb-4 text-ink">
        How confident do you feel? There’s no right or wrong answer — this never changes your score.
      </p>
      <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-5">
        {LIKERT.map((n) => (
          <label key={n} className="likert-cell">
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={selected === n}
              disabled={disabled}
              onChange={() => onChange({ kind: 'likert', value: n })}
              aria-label={`${n} out of 5${n === 1 ? ` — ${cfg.minLabel}` : n === 5 ? ` — ${cfg.maxLabel}` : ''}`}
            />
            <span aria-hidden="true">{n}</span>
          </label>
        ))}
      </div>
      <div className="t-small mt-2 flex justify-between gap-4 text-ink-2" aria-hidden="true">
        <span>1 = {cfg.minLabel}</span>
        <span className="text-right">5 = {cfg.maxLabel}</span>
      </div>
    </div>
  );
}
