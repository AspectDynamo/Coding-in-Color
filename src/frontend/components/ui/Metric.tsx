import type { ReactNode } from 'react';
import clsx from 'clsx';
import { fmtInt, DASH } from '@frontend/lib/format';
import { formatStat, type StatUnit } from './stat-format';
import { Tooltip } from './Tooltip';

export interface MetricProps {
  label: string;
  value: number | null | undefined;
  unit?: StatUnit;
  /** hero = the page's 2–3 headline numbers; standard = supporting; inline = one ruled row. */
  size?: 'hero' | 'standard' | 'inline';
  /** Sample size behind the value. Rendered as "n = 42 matched". */
  n?: number | null;
  nLabel?: string;
  help?: ReactNode;
  /** Shown instead of the value when it is null (e.g. "undefined (baseline 0)", "suppressed"). */
  emptyText?: string;
  sub?: ReactNode;
  className?: string;
}

/** A measured number with its unit and sample size. No box: type and rules do the work. */
export function Metric({
  label,
  value,
  unit = 'plain',
  size = 'standard',
  n,
  nLabel = 'matched',
  help,
  emptyText,
  sub,
  className,
}: MetricProps) {
  const f = formatStat(value, unit);
  const isEmpty = f.text === DASH;
  const labelRow = (
    <div className="flex min-w-0 items-center gap-1">
      <span className="metric-label">{label}</span>
      {help && <Tooltip content={help} label={`About: ${label}`} align="start" />}
    </div>
  );
  const valueRow = (
    <p
      className={clsx(
        'metric-value flex items-baseline gap-x-1.5',
        size === 'inline' ? 'flex-none' : 'flex-wrap',
      )}
    >
      {isEmpty && emptyText ? (
        <span className="font-sans text-base font-semibold tracking-normal text-ink-2">
          {emptyText}
        </span>
      ) : (
        <>
          <span data-testid="stat-value">{f.text}</span>
          {f.unit && (
            <span className="metric-unit" data-testid="stat-unit">
              {f.unit}
            </span>
          )}
        </>
      )}
    </p>
  );
  const foot = (n !== undefined && n !== null) || sub;
  const footRow = foot ? (
    <p className="metric-foot">
      {n !== undefined && n !== null && (
        <span data-testid="stat-n">
          n = {fmtInt(n)} {nLabel}
        </span>
      )}
      {n !== undefined && n !== null && sub && <span aria-hidden="true"> · </span>}
      {sub && <span>{sub}</span>}
    </p>
  ) : null;

  if (size === 'inline') {
    return (
      <div className={clsx('metric metric-inline', className)} data-testid="stat-tile">
        <div className="min-w-0">
          {labelRow}
          {footRow}
        </div>
        {valueRow}
      </div>
    );
  }
  return (
    <div className={clsx('metric', `metric-${size}`, className)} data-testid="stat-tile">
      {labelRow}
      {valueRow}
      {footRow}
    </div>
  );
}
