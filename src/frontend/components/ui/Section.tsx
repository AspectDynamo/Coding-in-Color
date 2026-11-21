import { useId, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

export interface SheetProps extends HTMLAttributes<HTMLElement> {
  /** Heavy ink top rule (a sheet that starts a composition). */
  ruled?: boolean;
  padded?: boolean | 'sm' | 'lg';
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
}

/** Flat paper surface with a hairline border. The only "container" in the system. */
export function Sheet({ ruled, padded = true, as: Tag = 'div', className, ...rest }: SheetProps) {
  const pad = padded === 'sm' ? 'p-4' : padded === 'lg' ? 'p-5 sm:p-8' : padded ? 'p-4 sm:p-6' : '';
  return <Tag className={clsx(ruled ? 'sheet-ruled' : 'sheet', pad, className)} {...rest} />;
}

export interface SectionProps {
  /** Mono section number shown in the margin column, e.g. "01". */
  number?: string;
  title: ReactNode;
  /** Margin annotation: legend, sample size, caveats. */
  aside?: ReactNode;
  /** Controls that belong to the section (placed in the margin, under the annotation). */
  actions?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
  className?: string;
  id?: string;
  'data-testid'?: string;
}

/**
 * The annotated-sheet section: a hairline rule, a margin column (number, heading, annotation)
 * and the body. On small screens the margin stacks above the body.
 */
export function Section({
  number,
  title,
  aside,
  actions,
  children,
  level = 2,
  className,
  id,
  ...rest
}: SectionProps) {
  const auto = useId();
  const hid = id ?? auto;
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section
      className={clsx('section', className)}
      aria-labelledby={hid}
      data-testid={rest['data-testid']}
    >
      <div className="section-margin">
        {number && (
          <p className="section-number" aria-hidden="true">
            {number}
          </p>
        )}
        <H id={hid} className="section-title">
          {title}
        </H>
        {aside && <div className="section-aside">{aside}</div>}
        {actions && <div className="no-print mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
