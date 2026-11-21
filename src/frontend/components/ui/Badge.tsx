import type { ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeTone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

/**
 * Status label. Every tone carries a shape glyph (or the icon you pass) as well as its text,
 * so status never depends on colour alone.
 */
export function Badge({
  tone = 'neutral',
  children,
  icon,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx('badge', tone !== 'neutral' && `badge-${tone}`, className)}>
      {icon ?? <span className="badge-glyph" aria-hidden="true" />}
      {children}
    </span>
  );
}
