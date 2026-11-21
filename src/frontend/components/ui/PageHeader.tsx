import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useDocumentTitle } from './useDocumentTitle';
import { Signal, type SignalArea } from './Brand';

function areaFor(pathname: string): SignalArea {
  if (pathname.startsWith('/instructor')) return 'instructor';
  if (pathname.startsWith('/admin')) return 'admin';
  return 'student';
}

/**
 * Page header of the annotated sheet: breadcrumb line, heavy ink rule, large title, lede,
 * actions — and the page's single signal block hanging from the rule.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  eyebrow,
  documentTitle,
  signal = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Parent page; rendered as a breadcrumb trail. */
  back?: { to: string; label: string };
  eyebrow?: ReactNode;
  /** Plain-text title for the browser tab when `title` is not a string. */
  documentTitle?: string;
  signal?: boolean;
}) {
  const plain = documentTitle ?? (typeof title === 'string' ? title : '');
  useDocumentTitle(plain);
  const { pathname } = useLocation();
  return (
    <header>
      {back && (
        <nav aria-label="Breadcrumb" className="crumbs no-print">
          <Link to={back.to}>{back.label}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="max-w-[60vw] truncate text-ink">
            {plain || 'This page'}
          </span>
        </nav>
      )}
      <div className="page-header">
        {signal && <Signal area={areaFor(pathname)} className="page-header-signal no-print" />}
        <div className={signal ? 'pr-16 md:pr-28' : undefined}>
          {eyebrow && <p className="t-meta mb-2">{eyebrow}</p>}
          <h1 className="t-h1 break-words" tabIndex={-1} data-page-heading>
            {title}
          </h1>
          {description && <p className="t-lede mt-3">{description}</p>}
        </div>
        {actions && (
          <div className="no-print mt-4 flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
