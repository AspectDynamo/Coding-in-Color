import clsx from 'clsx';

const BLUE = '#315FA8';
const RED = '#D94335';
const YELLOW = '#E9BE43';
const INK = '#20201E';

/**
 * Original geometric mark on a 24-unit grid (not Coding in Color's site assets):
 * a blue square (baseline), a yellow circle above it (the learner) and a taller red bar
 * (the final measurement). Reads as a two-bar chart with a figure.
 */
export function BrandMark({ size = 32, mono }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="flex-none">
      <rect x="0" y="14" width="10" height="10" fill={mono ? INK : BLUE} />
      <circle cx="5" cy="5" r="5" fill={mono ? INK : YELLOW} />
      <rect x="14" y="0" width="10" height="24" fill={mono ? INK : RED} />
    </svg>
  );
}

export function Wordmark({
  sub = 'Impact',
  className,
  size = 32,
}: {
  sub?: string | null;
  className?: string;
  size?: number;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-3', className)}>
      <BrandMark size={size} />
      <span className="leading-none">
        <span className="block text-[1.0625rem] font-bold tracking-[-0.01em] text-ink">
          Coding in Color
        </span>
        {sub && (
          <span className="mt-1 block font-mono text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-3">
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}

export type SignalArea = 'student' | 'instructor' | 'admin';

/**
 * Signal block: the mark's three primitives recomposed, hanging from a page's top rule.
 * One per page header (plus landing, completion, 404/403) — never on tables, dialogs or forms.
 * Each area leads with its own primitive: student circle, instructor square, admin bar.
 */
export function Signal({ area, className }: { area: SignalArea; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={clsx('block', className)}>
      {area === 'admin' && (
        <>
          <rect x="56" y="0" width="40" height="96" fill={RED} />
          <rect x="8" y="48" width="40" height="40" fill={BLUE} />
          <circle cx="28" cy="20" r="14" fill={YELLOW} />
        </>
      )}
      {area === 'instructor' && (
        <>
          <rect x="32" y="0" width="64" height="64" fill={BLUE} />
          <rect x="8" y="0" width="16" height="96" fill={RED} />
          <circle cx="50" cy="82" r="14" fill={YELLOW} />
        </>
      )}
      {area === 'student' && (
        <>
          <circle cx="56" cy="40" r="40" fill={YELLOW} />
          <rect x="0" y="64" width="32" height="32" fill={BLUE} />
          <rect x="80" y="72" width="16" height="24" fill={RED} />
        </>
      )}
    </svg>
  );
}
