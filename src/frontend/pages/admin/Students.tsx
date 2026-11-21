import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import type { CohortDto, StudentListItem } from '@shared/api';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@frontend/components/ui';
import { StudentStatusBadge } from '@frontend/components/StatusBadges';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { AGE_BAND_LABELS, fmtDate, fmtPct } from '@frontend/lib/format';

const LIMIT = 25;

export default function Students() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const cohortId = params.get('cohortId') ?? '';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const [draft, setDraft] = useState(q);

  const cohorts = useQuery('admin-cohorts', (s) =>
    api.page<CohortDto>('/admin/cohorts', undefined, s),
  );
  const list = useQuery(
    `students:${q}:${cohortId}:${offset}`,
    (s) =>
      api.page<StudentListItem>(
        '/admin/students',
        { q: q || undefined, cohortId: cohortId || undefined, limit: LIMIT, offset },
        s,
      ),
    { keepPrevious: true },
  );

  const update = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: draft.trim().toUpperCase().slice(0, 20), offset: '' });
  };
  const filtered = Boolean(q || cohortId);

  return (
    <>
      <PageHeader
        title="Students"
        description="Pseudonymous records. Students are identified by a public code and seat number only — the platform holds no names, emails or birthdates."
      />

      <form
        onSubmit={onSearch}
        role="search"
        className="mb-6 grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,20rem)_auto_1fr] sm:items-end"
      >
        <Input
          label="Public code"
          placeholder="S-7KQ2"
          className="t-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
        />
        <Select
          label="Cohort"
          value={cohortId}
          onChange={(e) => update({ cohortId: e.target.value, offset: '' })}
        >
          <option value="">All cohorts</option>
          {cohorts.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button type="submit" icon={<Search size={16} aria-hidden="true" />}>
            Search
          </Button>
          {filtered && (
            <Button
              variant="quiet"
              onClick={() => {
                setDraft('');
                setParams(new URLSearchParams());
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="t-caption sm:pb-3 sm:text-right">
          Search by the start of a public code.
          {cohorts.error ? ' Cohort list unavailable.' : ''}
        </p>
      </form>

      {list.loading && !list.data ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorState message={errorMessage(list.error)} onRetry={list.refetch} />
      ) : list.data!.items.length === 0 ? (
        <div className="rule-heavy">
          <EmptyState title="No students match">Check the code, or clear the filters.</EmptyState>
        </div>
      ) : (
        <div aria-busy={list.loading}>
          <Table
            stack
            caption="Student records"
            rows={list.data!.items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'code',
                header: 'Public code',
                rowHeader: true,
                cell: (r) => (
                  <Link to={`/admin/students/${r.id}`} className="link t-mono whitespace-nowrap">
                    {r.publicCode}
                  </Link>
                ),
              },
              {
                key: 'cohorts',
                header: 'Cohort · seat',
                cell: (r) =>
                  r.cohorts.length ? (
                    <span className="block min-w-0">
                      {r.cohorts.map((c) => (
                        <span key={c.id} className="block">
                          {c.name} <span className="t-mono text-ink-3">· {c.rosterLabel}</span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              { key: 'age', header: 'Age band', cell: (r) => AGE_BAND_LABELS[r.ageBand] },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => (
                  <span className="flex flex-wrap gap-1.5">
                    <StudentStatusBadge status={r.status} />
                    {r.isSynthetic && <Badge tone="warn">Synthetic</Badge>}
                  </span>
                ),
              },
              { key: 'att', header: 'Attempts', numeric: true, cell: (r) => r.attemptCount },
              {
                key: 'latest',
                header: 'Latest score',
                numeric: true,
                cell: (r) => fmtPct(r.latestScore),
              },
              {
                key: 'created',
                header: 'Created',
                numeric: true,
                cell: (r) => fmtDate(r.createdAt),
              },
            ]}
          />
          <Pagination
            page={list.data!.page}
            onChange={(o) => update({ offset: o ? String(o) : '' })}
          />
        </div>
      )}
    </>
  );
}
