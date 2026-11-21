import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

function useRoving<T extends string>(items: TabItem<T>[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = items.findIndex((t) => t.value === value);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    const next = items[n];
    if (next) {
      onChange(next.value);
      refs.current[n]?.focus();
    }
  };
  return { refs, onKeyDown };
}

/** Tabs: underlined tablist. Pair with <TabPanel>. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idBase: string;
  className?: string;
}) {
  const { refs, onKeyDown } = useRoving(items, value, onChange);
  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx('tabs', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.value}`}
          aria-controls={`${idBase}-panel-${t.value}`}
          aria-selected={t.value === value}
          tabIndex={t.value === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idBase,
  value,
  children,
  className,
}: {
  idBase: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${value}`}
      aria-labelledby={`${idBase}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}

/** SegmentedControl: single-choice radiogroup styled as a joined row of boxes. */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const { refs, onKeyDown } = useRoving(items, value, onChange);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('segmented', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={t.value === value}
          tabIndex={t.value === value ? 0 : -1}
          className="segmented-item"
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
