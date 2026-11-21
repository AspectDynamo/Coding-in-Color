import clsx from 'clsx';

/** Thin measured bar. Used for completion and participation — never for scores vs. scores. */
export function Meter({
  value,
  max = 100,
  label,
  showValue,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 10) / 10}
        className="meter"
      >
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      {showValue && <span className="t-num w-12 text-right text-sm">{Math.round(pct)}%</span>}
    </div>
  );
}

/**
 * "The count": one numbered square per question. Outline = unanswered, ink = answered,
 * red with an ink underline = the question on screen. A progressbar for assistive tech.
 */
export function QuestionCount({
  answered,
  current,
  label,
  className,
}: {
  /** One entry per question, in order. */
  answered: boolean[];
  /** Zero-based index of the question on screen; omit on review screens. */
  current?: number;
  label: string;
  className?: string;
}) {
  const done = answered.filter(Boolean).length;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={answered.length}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${answered.length} answered`}
      className={clsx('count', className)}
    >
      {answered.map((a, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="count-cell"
          data-state={a ? 'answered' : 'open'}
          data-current={i === current || undefined}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}

/** Numbered steps for short multi-step forms. */
export function Stepper({
  steps,
  current,
  label = 'Progress',
}: {
  steps: string[];
  current: number;
  label?: string;
}) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={s}
            className="flex items-center gap-2"
            aria-current={active ? 'step' : undefined}
          >
            <span
              className="count-cell"
              data-state={done ? 'answered' : 'open'}
              data-current={active || undefined}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className={clsx('text-sm font-semibold', active ? 'text-ink' : 'text-ink-3')}>
              {s}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
