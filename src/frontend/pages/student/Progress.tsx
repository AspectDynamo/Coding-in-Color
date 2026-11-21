import { Link } from 'react-router';
import type { StudentProgress } from '@shared/api';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Signal,
  useDocumentTitle,
} from '@frontend/components/ui';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { STAGE_STUDENT, fmtDate } from '@frontend/lib/format';

export default function Progress() {
  useDocumentTitle('My check-ins');
  const q = useQuery('student-progress', (signal) =>
    api.get<StudentProgress>('/student/progress', undefined, signal),
  );
  const attempts = q.data?.attempts ?? [];
  return (
    <div>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/s/home">Back to my check-ins</Link>
      </nav>
      <header className="page-header">
        <Signal area="student" className="page-header-signal" />
        <div className="pr-16 md:pr-28">
          <h1 className="t-display" tabIndex={-1} data-page-heading>
            My past check-ins
          </h1>
          <p className="t-lede mt-4">
            Scores show what you knew on that day — they’re a snapshot, not a grade. Learning takes
            time.
          </p>
        </div>
      </header>
      {q.loading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={q.refetch} />
      ) : attempts.length === 0 ? (
        <EmptyState title="No finished check-ins yet">
          When you turn one in, it will show up here.
        </EmptyState>
      ) : (
        <ol className="timeline">
          {attempts.map((a) => (
            <li key={a.attemptId} className="timeline-item">
              <span className="timeline-mark" data-stage={a.stage} aria-hidden="true" />
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="min-w-0">
                  <p className="t-small text-ink-2">
                    <span className="t-num">{fmtDate(a.submittedAt)}</span> ·{' '}
                    {STAGE_STUDENT[a.stage]}
                  </p>
                  <h2 className="t-h3 mt-0.5 break-words">{a.title}</h2>
                </div>
                <p className="t-figure text-[2.4375rem]">
                  {Math.round(a.percentageScore)}
                  <span className="text-base text-ink-2">%</span>
                </p>
              </div>
              {/* 0–100 scale, never truncated */}
              <div
                role="img"
                aria-label={`Score for ${a.title}: ${Math.round(a.percentageScore)} out of 100`}
                className="mt-3 h-3"
              >
                <div className="bar-track">
                  <div
                    className="bar bg-ink"
                    style={{ width: `${Math.max(0, Math.min(100, a.percentageScore))}%` }}
                  />
                </div>
              </div>
              <p className="t-caption t-num mt-1 flex justify-between" aria-hidden="true">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
