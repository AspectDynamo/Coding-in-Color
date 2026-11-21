import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Button';

export interface LegendItem {
  label: string;
  color: string;
  /** solid square · outline square (baseline) · line. */
  shape?: 'solid' | 'outline' | 'line';
  /** Fill colour inside an outline swatch. */
  fill?: string;
}
export interface ChartTable {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="figure-legend" aria-label="Legend">
      {items.map((l) => (
        <li key={l.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={clsx(
              'swatch',
              l.shape === 'outline' && 'swatch-outline',
              l.shape === 'line' && 'swatch-line',
            )}
            style={{ '--swatch': l.color, '--swatch-fill': l.fill } as CSSProperties}
          />
          {l.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A captioned figure: title, plain-language note, legend, and a toggle that swaps the graphic
 * for an accessible data table carrying the same numbers. No box — a rule above and the caption.
 */
export function Figure({
  title,
  description,
  legend,
  table,
  children,
  footnote,
  summary,
  className,
  actions,
  level = 3,
}: {
  title: string;
  description?: ReactNode;
  legend?: LegendItem[];
  table: ChartTable;
  children: ReactNode;
  footnote?: ReactNode;
  /** One-sentence text alternative announced for the graphic. */
  summary: string;
  className?: string;
  actions?: ReactNode;
  level?: 2 | 3 | 4;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  const H = `h${level}` as 'h2' | 'h3' | 'h4';
  return (
    <section aria-labelledby={`${id}-t`} className={clsx('min-w-0', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <H id={`${id}-t`} className="t-h4">
            {title}
          </H>
          {description && <p className="t-caption mt-0.5 max-w-prose">{description}</p>}
        </div>
        <div className="no-print flex items-center gap-2">
          {actions}
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
            icon={
              showTable ? (
                <BarChart3 size={15} aria-hidden="true" />
              ) : (
                <Table2 size={15} aria-hidden="true" />
              )
            }
          >
            {showTable ? 'View chart' : 'View as table'}
          </Button>
        </div>
      </div>
      {legend && legend.length > 1 && !showTable && (
        <div className="mb-3">
          <Legend items={legend} />
        </div>
      )}
      {showTable ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={table.caption}>
          <table className="table">
            <caption className="sr-only">{table.caption}</caption>
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} scope="col" className={i > 0 ? 'num' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((v, ci) =>
                    ci === 0 ? (
                      <th key={ci} scope="row">
                        {v}
                      </th>
                    ) : (
                      <td key={ci} className="num">
                        {v}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <figure className="m-0">
          <div role="img" aria-label={summary}>
            {children}
          </div>
        </figure>
      )}
      {footnote && <p className="t-caption mt-3">{footnote}</p>}
    </section>
  );
}
