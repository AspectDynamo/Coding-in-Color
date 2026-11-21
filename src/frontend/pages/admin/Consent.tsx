import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import type { ConsentDto } from '@shared/api';
import { CURRENT_PRIVACY_NOTICE_VERSION } from '@shared/constants';
import {
  CONSENT_METHODS,
  CONSENT_STATUSES,
  type ConsentMethod,
  type ConsentStatus,
} from '@shared/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Table,
  Tabs,
  TabPanel,
  useToast,
} from '@frontend/components/ui';
import { ConsentBadge } from '@frontend/components/StatusBadges';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { api, errorMessage } from '@frontend/services/api';
import { AGE_BAND_LABELS, fmtDateTime, titleCase } from '@frontend/lib/format';

type Filter = 'all' | ConsentStatus;
const TABS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...CONSENT_STATUSES.map((s) => ({ value: s as Filter, label: titleCase(s) })),
];
const METHOD_LABELS: Record<ConsentMethod, string> = {
  signed_form: 'Signed form',
  email_plus: 'Email plus confirmation',
  in_person: 'In person',
  other: 'Other',
};
const LIMIT = 25;

export default function Consent() {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('pending');
  const [offset, setOffset] = useState(0);
  const [record, setRecord] = useState<ConsentDto | null>(null);
  const [withdrawRow, setWithdrawRow] = useState<ConsentDto | null>(null);
  const q = useQuery(
    `consent:${filter}:${offset}`,
    (s) =>
      api.page<ConsentDto>(
        '/admin/consent',
        { status: filter === 'all' ? undefined : filter, limit: LIMIT, offset },
        s,
      ),
    { keepPrevious: true },
  );

  const [status, setStatus] = useState<ConsentStatus>('granted');
  const [method, setMethod] = useState<ConsentMethod | ''>('signed_form');
  const [notice, setNotice] = useState(CURRENT_PRIVACY_NOTICE_VERSION);
  const [contactMethod, setContactMethod] = useState<'' | 'email' | 'phone' | 'paper'>('');
  const [contactValue, setContactValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation((body: unknown) => api.post<ConsentDto>('/admin/consent', body));
  const withdraw = useMutation((id: string) =>
    api.post<ConsentDto>(`/admin/consent/${id}/withdraw`),
  );

  const openRecord = (row: ConsentDto) => {
    setStatus(row.consentStatus === 'pending' ? 'granted' : row.consentStatus);
    setMethod(row.verificationMethod ?? 'signed_form');
    setNotice(CURRENT_PRIVACY_NOTICE_VERSION);
    setContactMethod('');
    setContactValue('');
    setFormError(null);
    setRecord(row);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!record) return;
    setFormError(null);
    if (!notice.trim()) return setFormError('Enter the privacy notice version the guardian saw.');
    if (status === 'granted' && !method) return setFormError('Choose how consent was verified.');
    if (contactMethod && !contactValue.trim())
      return setFormError('Enter the guardian contact, or set the contact type to “Don’t store”.');
    try {
      await save.run({
        studentId: record.studentId,
        consentStatus: status,
        verificationMethod: method || null,
        noticeVersion: notice.trim(),
        ...(contactMethod
          ? { guardianContact: { method: contactMethod, value: contactValue.trim() } }
          : {}),
      });
      toast.success(`Consent recorded for ${record.publicCode}.`);
      setRecord(null);
      q.refetch();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Consent"
        description="Parental consent records for students under 13. Students waiting for consent can sign in but can’t take assessments."
      />
      <Notice tone="warn" className="mb-8" title="A foundation, not legal advice">
        This tool records what you tell it. Confirm consent requirements (COPPA, FERPA, Arizona law,
        school agreements) with counsel before working with minors.
      </Notice>
      <Tabs
        items={TABS}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setOffset(0);
        }}
        label="Filter by consent status"
        idBase="consent"
        className="mb-6"
      />
      <TabPanel idBase="consent" value={filter}>
        <div aria-busy={q.loading}>
          {q.loading && !q.data ? (
            <LoadingBlock />
          ) : q.error ? (
            <ErrorState message={errorMessage(q.error)} onRetry={q.refetch} />
          ) : q.data!.items.length === 0 ? (
            <div className="rule-heavy">
              <EmptyState
                title={
                  filter === 'all'
                    ? 'No consent records'
                    : `No ${titleCase(filter).toLowerCase()} records`
                }
              >
                Records are created automatically when access cards are issued for students under
                13.
              </EmptyState>
            </div>
          ) : (
            <>
              <Table
                stack
                caption="Consent records"
                rows={q.data!.items}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'c',
                    header: 'Student',
                    rowHeader: true,
                    cell: (r) => (
                      <Link
                        className="link t-mono whitespace-nowrap"
                        to={`/admin/students/${r.studentId}`}
                      >
                        {r.publicCode}
                      </Link>
                    ),
                  },
                  { key: 'a', header: 'Age band', cell: (r) => AGE_BAND_LABELS[r.ageBand] },
                  {
                    key: 's',
                    header: 'Status',
                    cell: (r) => (
                      <span>
                        <ConsentBadge status={r.consentStatus} />
                      </span>
                    ),
                  },
                  {
                    key: 'm',
                    header: 'Verified by',
                    cell: (r) => (r.verificationMethod ? METHOD_LABELS[r.verificationMethod] : '—'),
                  },
                  {
                    key: 'n',
                    header: 'Notice',
                    cell: (r) => <span className="t-mono text-[0.875rem]">{r.noticeVersion}</span>,
                  },
                  {
                    key: 't',
                    header: 'Recorded',
                    cell: (r) => (
                      <span className="t-num text-[0.875rem]">
                        {fmtDateTime(r.consentTimestamp ?? r.withdrawalTimestamp)}
                      </span>
                    ),
                  },
                  {
                    key: 'g',
                    header: 'Guardian contact',
                    cell: (r) =>
                      r.hasGuardianContact ? (
                        <span>
                          <Badge icon={<Lock size={12} aria-hidden="true" />}>On file</Badge>
                        </span>
                      ) : (
                        '—'
                      ),
                  },
                  {
                    key: 'x',
                    header: <span className="sr-only">Actions</span>,
                    cell: (r) => (
                      <span className="flex gap-2 md:justify-end">
                        <Button
                          size="sm"
                          onClick={() => openRecord(r)}
                          aria-label={`Record consent for ${r.publicCode}`}
                        >
                          Record
                        </Button>
                        {r.consentStatus === 'granted' && (
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => setWithdrawRow(r)}
                            aria-label={`Withdraw consent for ${r.publicCode}`}
                          >
                            Withdraw
                          </Button>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
              <Pagination page={q.data!.page} onChange={setOffset} />
            </>
          )}
        </div>
      </TabPanel>

      <Dialog
        open={record !== null}
        onClose={() => setRecord(null)}
        busy={save.loading}
        title={`Record consent — ${record?.publicCode ?? ''}`}
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <Select
            label="Consent status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ConsentStatus)}
            data-autofocus=""
          >
            {CONSENT_STATUSES.filter((s) => s !== 'not_required').map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select
            label="How was it verified?"
            value={method}
            onChange={(e) => setMethod(e.target.value as ConsentMethod | '')}
          >
            <option value="">Not verified / not applicable</option>
            {CONSENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
          <Input
            label="Privacy notice version"
            value={notice}
            maxLength={40}
            onChange={(e) => setNotice(e.target.value)}
            hint={`Current version: ${CURRENT_PRIVACY_NOTICE_VERSION}`}
            spellCheck={false}
          />
          <fieldset className="border-l-4 border-rule-strong bg-paper p-4">
            <legend className="field-label float-left mb-2 w-full">
              Guardian contact (optional)
            </legend>
            <div className="clear-both grid gap-3 sm:grid-cols-[11rem_1fr]">
              <Select
                label="Contact type"
                value={contactMethod}
                onChange={(e) => setContactMethod(e.target.value as typeof contactMethod)}
              >
                <option value="">Don’t store</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="paper">Paper file reference</option>
              </Select>
              <Input
                label="Contact"
                value={contactValue}
                maxLength={254}
                disabled={!contactMethod}
                onChange={(e) => setContactValue(e.target.value)}
                autoComplete="off"
              />
            </div>
            <p className="t-caption mt-2 flex items-start gap-1.5">
              <Lock size={14} className="mt-0.5 flex-none" aria-hidden="true" />
              Stored separately from student records with restricted access. Never shown in lists,
              to instructors, in analytics or to AI.
            </p>
          </fieldset>
          {formError && (
            <Notice tone="bad" role="alert">
              {formError}
            </Notice>
          )}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setRecord(null)} disabled={save.loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.loading}>
              Save consent record
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={withdrawRow !== null}
        busy={withdraw.loading}
        onClose={() => setWithdrawRow(null)}
        tone="danger"
        title={`Withdraw consent for ${withdrawRow?.publicCode ?? ''}?`}
        description="The student is marked withdrawn and can no longer sign in or take assessments. Existing data is kept until a deletion request is made from the student’s record."
        confirmLabel="Withdraw consent"
        onConfirm={async () => {
          if (!withdrawRow) return;
          try {
            await withdraw.run(withdrawRow.id);
            toast.success(`Consent withdrawn for ${withdrawRow.publicCode}.`);
            setWithdrawRow(null);
            q.refetch();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
