import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import type { CohortDto, CourseDto, FilterOptions, ProgramDto } from '@shared/api';
import {
  DELIVERY_MODES,
  PROGRAM_FORMATS,
  type DeliveryMode,
  type ProgramFormat,
} from '@shared/types';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
  TabPanel,
  Table,
  Tabs,
  Textarea,
  useToast,
} from '@frontend/components/ui';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { fmtDate, titleCase } from '@frontend/lib/format';

type Tab = 'programs' | 'courses' | 'cohorts';
const TABS: { value: Tab; label: string }[] = [
  { value: 'programs', label: 'Programs' },
  { value: 'courses', label: 'Courses' },
  { value: 'cohorts', label: 'Cohorts' },
];
const SINGULAR: Record<Tab, string> = { programs: 'program', courses: 'course', cohorts: 'cohort' };
const TAB_NOTE: Record<Tab, string> = {
  programs: 'A program is an offering such as a camp series or a school-year pathway.',
  courses: 'A course is the curriculum taught inside a program. Assessments belong to a course.',
  cohorts:
    'A cohort is one group of students taking a course between two dates. Open a cohort for its roster and access cards.',
};

export default function Catalog() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'courses' || tabParam === 'cohorts' ? tabParam : 'programs';
  const [dialog, setDialog] = useState<Tab | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const programs = useQuery('admin-programs', (s) =>
    api.page<ProgramDto>('/admin/programs', undefined, s),
  );
  const courses = useQuery('admin-courses', (s) =>
    api.page<CourseDto>('/admin/courses', undefined, s),
  );
  const cohorts = useQuery('admin-cohorts', (s) =>
    api.page<CohortDto>('/admin/cohorts', undefined, s),
  );
  const options = useQuery('admin-filters', (s) =>
    api.get<FilterOptions>('/admin/filters', undefined, s),
  );

  // form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<ProgramFormat>('workshop');
  const [programId, setProgramId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('in_person');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [leadInstructorId, setLeadInstructorId] = useState('');

  const create = useMutation(({ kind, body }: { kind: Tab; body: unknown }) =>
    api.post<unknown>(`/admin/${kind}`, body),
  );

  const open = (kind: Tab) => {
    setName('');
    setDescription('');
    setFormError(null);
    setStartDate('');
    setEndDate('');
    setLeadInstructorId('');
    setCourseId('');
    setProgramId(programs.data?.items[0]?.id ?? '');
    setDialog(kind);
  };

  const programName = (id: string) => programs.data?.items.find((p) => p.id === id)?.name ?? '—';
  const coursesForProgram = (courses.data?.items ?? []).filter((c) => c.programId === programId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    setFormError(null);
    if (name.trim().length < 2) return setFormError('Enter a name with at least 2 characters.');
    let body: unknown;
    if (dialog === 'programs')
      body = { name: name.trim(), description: description.trim(), format };
    else if (dialog === 'courses') {
      if (!programId) return setFormError('Choose a program.');
      body = { programId, name: name.trim(), description: description.trim() };
    } else {
      if (!programId || !courseId) return setFormError('Choose a program and a course.');
      if (!startDate || !endDate) return setFormError('Choose a start and end date.');
      if (endDate < startDate)
        return setFormError('The end date must not be before the start date.');
      body = {
        programId,
        courseId,
        name: name.trim(),
        deliveryMode,
        startDate,
        endDate,
        leadInstructorId: leadInstructorId || null,
      };
    }
    try {
      await create.run({ kind: dialog, body });
      toast.success(`${titleCase(SINGULAR[dialog])} created.`);
      setDialog(null);
      programs.refetch();
      courses.refetch();
      cohorts.refetch();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const active = tab === 'programs' ? programs : tab === 'courses' ? courses : cohorts;

  return (
    <>
      <PageHeader
        title="Programs & cohorts"
        description="Programs contain courses; courses run as cohorts. Impact is always measured within a cohort."
        actions={
          <Button
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => open(tab)}
          >
            New {SINGULAR[tab]}
          </Button>
        }
      />
      <Tabs
        items={TABS}
        value={tab}
        onChange={(v) => setParams(v === 'programs' ? {} : { tab: v })}
        label="Catalog sections"
        idBase="catalog"
        className="mb-6"
      />
      <TabPanel idBase="catalog" value={tab}>
        <div>
          <p className="t-caption mb-3 max-w-2xl">{TAB_NOTE[tab]}</p>
          {active.loading ? (
            <LoadingBlock />
          ) : active.error ? (
            <ErrorState message={errorMessage(active.error)} onRetry={active.refetch} />
          ) : active.data!.items.length === 0 ? (
            <div className="rule-heavy">
              <EmptyState
                title={`No ${tab} yet`}
                action={<Button onClick={() => open(tab)}>Create the first {SINGULAR[tab]}</Button>}
              >
                {TAB_NOTE[tab]}
              </EmptyState>
            </div>
          ) : tab === 'programs' ? (
            <Table
              stack
              caption="Programs"
              rows={programs.data!.items}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'n',
                  header: 'Program',
                  rowHeader: true,
                  cell: (r) => (
                    <span>
                      {r.name}
                      {r.description && (
                        <span className="t-caption mt-0.5 block max-w-xl font-normal">
                          {r.description}
                        </span>
                      )}
                    </span>
                  ),
                },
                { key: 'f', header: 'Format', cell: (r) => titleCase(r.format) },
                {
                  key: 's',
                  header: 'Status',
                  cell: (r) => (
                    <span>
                      <Badge tone={r.status === 'active' ? 'good' : 'neutral'}>
                        {titleCase(r.status)}
                      </Badge>
                    </span>
                  ),
                },
                { key: 'c', header: 'Courses', numeric: true, cell: (r) => r.courseCount },
                { key: 'h', header: 'Cohorts', numeric: true, cell: (r) => r.cohortCount },
                {
                  key: 'd',
                  header: <span className="sr-only">Dashboard</span>,
                  className: 'md:text-right',
                  cell: (r) => (
                    <Link
                      className="link whitespace-nowrap"
                      to={`/admin?programId=${r.id}`}
                      aria-label={`View impact for ${r.name}`}
                    >
                      View impact
                    </Link>
                  ),
                },
              ]}
            />
          ) : tab === 'courses' ? (
            <Table
              stack
              caption="Courses"
              rows={courses.data!.items}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'n',
                  header: 'Course',
                  rowHeader: true,
                  cell: (r) => (
                    <span>
                      {r.name}
                      {r.description && (
                        <span className="t-caption mt-0.5 block max-w-xl font-normal">
                          {r.description}
                        </span>
                      )}
                    </span>
                  ),
                },
                { key: 'p', header: 'Program', cell: (r) => programName(r.programId) },
                {
                  key: 's',
                  header: 'Status',
                  cell: (r) => (
                    <span>
                      <Badge tone={r.status === 'active' ? 'good' : 'neutral'}>
                        {titleCase(r.status)}
                      </Badge>
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <Table
              stack
              caption="Cohorts"
              rows={cohorts.data!.items}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'n',
                  header: 'Cohort',
                  rowHeader: true,
                  cell: (r) => (
                    <Link className="link" to={`/instructor/cohorts/${r.id}`}>
                      {r.name}
                    </Link>
                  ),
                },
                {
                  key: 'p',
                  header: 'Program · course',
                  cell: (r) => (
                    <span>
                      {r.programName}
                      <span className="t-caption block">{r.courseName}</span>
                    </span>
                  ),
                },
                { key: 'm', header: 'Delivery', cell: (r) => titleCase(r.deliveryMode) },
                {
                  key: 'd',
                  header: 'Dates',
                  cell: (r) => (
                    <span className="t-num text-[0.875rem]">
                      {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                    </span>
                  ),
                },
                {
                  key: 'l',
                  header: 'Lead instructor',
                  cell: (r) => r.leadInstructor?.displayName ?? '—',
                },
                {
                  key: 's',
                  header: 'Status',
                  cell: (r) => (
                    <span>
                      <Badge tone={r.status === 'active' ? 'good' : 'neutral'}>
                        {titleCase(r.status)}
                      </Badge>
                    </span>
                  ),
                },
                { key: 'e', header: 'Enrolled', numeric: true, cell: (r) => r.enrolledCount },
              ]}
            />
          )}
        </div>
      </TabPanel>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        busy={create.loading}
        title={dialog ? `New ${SINGULAR[dialog]}` : ''}
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          {dialog !== 'programs' && (
            <Select
              label="Program"
              value={programId}
              onChange={(e) => {
                setProgramId(e.target.value);
                setCourseId('');
              }}
            >
              <option value="">Choose a program</option>
              {programs.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          {dialog === 'cohorts' && (
            <Select
              label="Course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              hint={
                programId && coursesForProgram.length === 0
                  ? 'This program has no courses yet — create one first.'
                  : undefined
              }
            >
              <option value="">Choose a course</option>
              {coursesForProgram.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            label="Name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            data-autofocus=""
            hint={
              dialog === 'cohorts'
                ? 'For example “Summer Camp 2027 — Group B”. Don’t include student names.'
                : undefined
            }
          />
          {dialog === 'programs' && (
            <Select
              label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ProgramFormat)}
            >
              {PROGRAM_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {titleCase(f)}
                </option>
              ))}
            </Select>
          )}
          {dialog !== 'cohorts' && (
            <Textarea
              label="Description (optional)"
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          {dialog === 'cohorts' && (
            <>
              <Select
                label="Delivery"
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
              >
                {DELIVERY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {titleCase(m)}
                  </option>
                ))}
              </Select>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Start date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <Input
                  label="End date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <Select
                label="Lead instructor (optional)"
                value={leadInstructorId}
                onChange={(e) => setLeadInstructorId(e.target.value)}
              >
                <option value="">None yet</option>
                {options.data?.instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.displayName}
                  </option>
                ))}
              </Select>
            </>
          )}
          {formError && (
            <Notice tone="bad" role="alert">
              {formError}
            </Notice>
          )}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setDialog(null)} disabled={create.loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.loading}>
              Create {dialog ? SINGULAR[dialog] : ''}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
