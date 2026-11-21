import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import type { AssessmentSummaryDto } from '@shared/api';
import {
  Badge,
  ButtonLink,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Section,
  Table,
  type BadgeTone,
} from '@frontend/components/ui';
import { StageBadge } from '@frontend/components/StatusBadges';
import { useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { titleCase } from '@frontend/lib/format';

const ASSESSMENT_STATUS_TONE: Record<AssessmentSummaryDto['status'], BadgeTone> = {
  draft: 'warn',
  active: 'good',
  retired: 'neutral',
};

export default function Assessments() {
  const q = useQuery('admin-assessments', (s) =>
    api.page<AssessmentSummaryDto>('/admin/assessments', undefined, s),
  );
  const items = q.data?.items ?? [];
  const active = items.filter((a) => a.status === 'active').length;
  return (
    <>
      <PageHeader
        title="Assessments"
        description="Forms in the same family (A, B…) measure the same skills with different questions, so pre and post can be compared."
        actions={
          <ButtonLink
            to="/admin/assessments/new"
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
          >
            New assessment
          </ButtonLink>
        }
      />
      <Section
        number="01"
        title="All forms"
        aside={
          q.data ? (
            <>
              <p className="t-num">
                {items.length} {items.length === 1 ? 'form' : 'forms'} · {active} active
              </p>
              <p className="mt-2">
                Only active assessments can be assigned to new sessions. Questions can’t be changed
                after creation — create a new version instead.
              </p>
            </>
          ) : undefined
        }
      >
        {q.loading ? (
          <LoadingBlock />
        ) : q.error ? (
          <ErrorState message={errorMessage(q.error)} onRetry={q.refetch} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No assessments yet"
            action={<ButtonLink to="/admin/assessments/new">Create an assessment</ButtonLink>}
          >
            An assessment is a short set of questions students answer before and after a program.
          </EmptyState>
        ) : (
          <Table
            stack
            caption="Assessments"
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 't',
                header: 'Assessment',
                rowHeader: true,
                className: 'lg:min-w-64',
                cell: (r) => (
                  <>
                    <Link className="link" to={`/admin/assessments/${r.id}`}>
                      {r.title}
                    </Link>
                    <span className="t-mono mt-1 block whitespace-nowrap text-[0.8125rem] text-ink-3">
                      {r.formFamily} · {r.formLabel} · v{r.version}
                    </span>
                  </>
                ),
              },
              {
                key: 'g',
                header: 'Stages',
                cell: (r) => (
                  <span className="flex flex-wrap gap-x-3 gap-y-1 md:flex-nowrap md:whitespace-nowrap">
                    {r.intendedStages.map((s) => (
                      <StageBadge key={s} stage={s} />
                    ))}
                  </span>
                ),
              },
              { key: 'q', header: 'Questions', numeric: true, cell: (r) => r.questionCount },
              { key: 'm', header: 'Minutes', numeric: true, cell: (r) => r.estimatedMinutes },
              {
                key: 's',
                header: 'Status',
                cell: (r) => (
                  <span>
                    <Badge tone={ASSESSMENT_STATUS_TONE[r.status]}>{titleCase(r.status)}</Badge>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Section>
    </>
  );
}
