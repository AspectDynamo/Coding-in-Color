import { useState } from 'react';
import type { AuditEntryDto } from '@shared/api';
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pagination,
  Table,
} from '@frontend/components/ui';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { fmtDateTime } from '@frontend/lib/format';

const LIMIT = 50;

function meta(m: Record<string, unknown>): string {
  const entries = Object.entries(m).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '—';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function Audit() {
  const [offset, setOffset] = useState(0);
  const q = useQuery(
    `audit:${offset}`,
    (s) => api.page<AuditEntryDto>('/admin/audit-log', { limit: LIMIT, offset }, s),
    { keepPrevious: true },
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        description="A record of sensitive actions: sign-ins, card issue and reissue, exports, consent changes, deletions and staff changes. Access codes and answers are never logged."
      />
      {q.loading && !q.data ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={q.refetch} />
      ) : q.data!.items.length === 0 ? (
        <div className="rule-heavy">
          <EmptyState title="Nothing logged yet">
            Entries appear here as staff sign in, issue cards, export data or change records.
          </EmptyState>
        </div>
      ) : (
        <div aria-busy={q.loading}>
          <p className="t-caption mb-2">Newest first. Times are shown in your local time zone.</p>
          <Table
            stack
            caption="Audit log entries, newest first"
            rows={q.data!.items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 't',
                header: 'When',
                rowHeader: true,
                cell: (r) => (
                  <span className="t-num whitespace-nowrap text-[0.875rem] font-medium">
                    {fmtDateTime(r.createdAt)}
                  </span>
                ),
              },
              {
                key: 'a',
                header: 'Who',
                cell: (r) => (
                  <span className="block">
                    <span className="block text-ink">{r.actorLabel ?? '—'}</span>
                    <span className="t-caption">{r.actorType}</span>
                  </span>
                ),
              },
              {
                key: 'x',
                header: 'Action',
                cell: (r) => (
                  <code className="whitespace-nowrap text-[0.875rem] font-medium text-ink">
                    {r.action}
                  </code>
                ),
              },
              {
                key: 'g',
                header: 'Target',
                cell: (r) =>
                  r.targetType ? (
                    <span className="whitespace-nowrap">
                      {r.targetType}
                      {r.targetId ? (
                        <span className="t-caption t-mono"> {r.targetId.slice(0, 8)}</span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'm',
                header: 'Details',
                cell: (r) => (
                  <span className="t-caption t-mono block max-w-sm break-words">
                    {meta(r.metadata)}
                  </span>
                ),
              },
            ]}
          />
          <Pagination page={q.data!.page} onChange={setOffset} />
        </div>
      )}
    </>
  );
}
