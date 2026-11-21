import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Page } from '@shared/api';
import { Button } from './Button';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  numeric?: boolean;
  className?: string;
  /** Mark this column as the row header (<th scope="row">). */
  rowHeader?: boolean;
  /** Label shown beside the value in stacked (mobile) mode. Defaults to `header` when it is text. */
  stackLabel?: string;
}

/**
 * Ruled table: heavy rule above, hairlines between rows, sentence-case semi-condensed heads,
 * mono right-aligned numerals. With `stack`, rows become labelled blocks below 768px instead
 * of scrolling sideways.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  className,
  footnote,
  stack,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Required: accessible caption (visually hidden). */
  caption: string;
  className?: string;
  footnote?: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={className}>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table className={clsx('table', stack && 'table-stack')}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx(c.numeric && 'num', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {columns.map((c) =>
                  c.rowHeader ? (
                    <th key={c.key} scope="row" className={c.className}>
                      {c.cell(row, i)}
                    </th>
                  ) : (
                    <td
                      key={c.key}
                      className={clsx(c.numeric && 'num', c.className)}
                      data-label={
                        stack
                          ? (c.stackLabel ?? (typeof c.header === 'string' ? c.header : undefined))
                          : undefined
                      }
                    >
                      {c.cell(row, i)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && <p className="t-caption mt-3">{footnote}</p>}
    </div>
  );
}

export function Pagination({
  page,
  onChange,
  label = 'Pagination',
}: {
  page: Page;
  onChange: (offset: number) => void;
  label?: string;
}) {
  const { limit, offset, total } = page;
  if (total <= limit && offset === 0) {
    return (
      <p className="t-caption t-num mt-3" role="status">
        {total} {total === 1 ? 'result' : 'results'}
      </p>
    );
  }
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="t-caption t-num" role="status">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          icon={<ChevronLeft size={16} aria-hidden="true" />}
          disabled={offset <= 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          iconRight={<ChevronRight size={16} aria-hidden="true" />}
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
