import type { ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2">
      <Loader2 size={size} className="anim-spin" aria-hidden="true" />
      {label && <span className="t-small">{label}</span>}
    </span>
  );
}

export function Skeleton({ className, lines }: { className?: string; lines?: number }) {
  if (lines) {
    return (
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={clsx('skeleton h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    );
  }
  return <div className={clsx('skeleton', className ?? 'h-3 w-full')} aria-hidden="true" />;
}

/** Wraps skeleton content with a polite status for assistive tech. */
export function LoadingBlock({
  label = 'Loading…',
  children,
}: {
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children ?? (
        <div className="rule-heavy py-6">
          <Skeleton className="mb-5 h-8 w-1/2" />
          <Skeleton lines={4} />
        </div>
      )}
    </div>
  );
}

/** Nothing here yet: a dot-grid square (the "not yet measured" motif) and plain words. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-8 sm:flex-row sm:items-center sm:gap-6">
      <span
        className="dot-grid h-16 w-16 flex-none border border-dashed border-rule-strong"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <h3 className="t-h3">{title}</h3>
        {children && <p className="t-small mt-1 max-w-xl text-ink-2">{children}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="notice notice-bad flex-col items-start sm:flex-row sm:items-center"
    >
      <AlertTriangle size={22} className="flex-none text-red-ink" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h3 className="t-h4">{title}</h3>
        {message && <p className="t-small mt-0.5 text-ink-2">{message}</p>}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          <span>Try again</span>
        </button>
      )}
    </div>
  );
}

const NOTICE_ICON = {
  info: <Info size={18} className="text-blue-deep" />,
  good: <CheckCircle2 size={18} className="text-green-ink" />,
  warn: <AlertTriangle size={18} className="text-ink" />,
  bad: <AlertTriangle size={18} className="text-red-ink" />,
} as const;

/** Inline notice: info / good / warn / bad. Always carries an icon as well as its tint. */
export function Notice({
  tone = 'info',
  title,
  children,
  icon,
  className,
  role,
  ...rest
}: {
  'data-testid'?: string;
  tone?: 'info' | 'good' | 'warn' | 'bad';
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
  role?: 'alert' | 'status' | 'note';
}) {
  return (
    <div
      role={role}
      data-testid={rest['data-testid']}
      className={clsx('notice', `notice-${tone}`, className)}
    >
      <span className="mt-0.5 flex-none" aria-hidden="true">
        {icon ?? NOTICE_ICON[tone]}
      </span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
    </div>
  );
}
