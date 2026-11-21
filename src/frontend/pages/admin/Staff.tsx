import { useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import type { ProgramDto, StaffDto } from '@shared/api';
import { STAFF_ROLES, type StaffRole } from '@shared/types';
import { PROGRAM_SCOPED_ROLES } from '@shared/constants';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Fieldset,
  Input,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
  Table,
  Toggle,
  useToast,
} from '@frontend/components/ui';
import { useMutation, useQuery } from '@frontend/hooks/useApi';
import { useStaff } from '@frontend/hooks/contexts';
import { api, errorMessage } from '@frontend/services/api';
import { ROLE_LABELS, fmtDateTime, titleCase } from '@frontend/lib/format';

const ROLE_HELP: Record<StaffRole, string> = {
  owner: 'Full access, including staff management.',
  admin: 'Dashboard, students, catalog, consent and audit log.',
  analyst: 'Aggregate dashboard and reports only — never individual students.',
  instructor: 'Sessions and access cards for assigned programs only.',
};

export default function Staff() {
  const toast = useToast();
  const { staff: me } = useStaff();
  const list = useQuery('admin-staff', (s) => api.page<StaffDto>('/admin/staff', undefined, s));
  const programs = useQuery('admin-programs', (s) =>
    api.page<ProgramDto>('/admin/programs', undefined, s),
  );
  const [mode, setMode] = useState<'invite' | 'edit' | null>(null);
  const [editing, setEditing] = useState<StaffDto | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<StaffRole>('instructor');
  const [active, setActive] = useState(true);
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const invite = useMutation((body: unknown) => api.post<StaffDto>('/admin/staff', body));
  const update = useMutation(({ id, body }: { id: string; body: unknown }) =>
    api.patch<StaffDto>(`/admin/staff/${id}`, body),
  );
  const busy = invite.loading || update.loading;
  const isSelf = editing?.id === me?.id;
  const scoped = PROGRAM_SCOPED_ROLES.includes(role);

  const openInvite = () => {
    setEmail('');
    setDisplayName('');
    setRole('instructor');
    setProgramIds([]);
    setFormError(null);
    setEditing(null);
    setMode('invite');
  };
  const openEdit = (s: StaffDto) => {
    setEditing(s);
    setRole(s.role);
    setActive(s.status !== 'disabled');
    setProgramIds(s.programIds);
    setFormError(null);
    setMode('edit');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      if (mode === 'invite') {
        if (!/^\S+@\S+\.\S+$/.test(email.trim()))
          return setFormError('Enter a valid email address.');
        if (!displayName.trim()) return setFormError('Enter a display name.');
        await invite.run({
          email: email.trim(),
          displayName: displayName.trim(),
          role,
          programIds: scoped ? programIds : [],
        });
        toast.success(`Invitation created for ${displayName.trim()}.`);
      } else if (editing) {
        const body: Record<string, unknown> = { programIds: scoped ? programIds : [] };
        if (!isSelf) {
          if (role !== editing.role) body.role = role;
          const nextStatus = active ? 'active' : 'disabled';
          if (editing.status !== 'invited' ? nextStatus !== editing.status : !active)
            body.status = nextStatus;
        }
        await update.run({ id: editing.id, body });
        toast.success(`${editing.displayName} updated.`);
      }
      setMode(null);
      list.refetch();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const programName = (id: string) =>
    programs.data?.items.find((p) => p.id === id)?.name ?? 'Program';

  return (
    <>
      <PageHeader
        title="Staff"
        description="Accounts are by invitation only. Role changes and disabling take effect immediately."
        actions={
          <Button
            variant="primary"
            icon={<UserPlus size={16} aria-hidden="true" />}
            onClick={openInvite}
          >
            Invite staff
          </Button>
        }
      />
      <div>
        {list.loading ? (
          <LoadingBlock />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={list.refetch} />
        ) : list.data!.items.length === 0 ? (
          <div className="rule-heavy">
            <EmptyState title="No staff yet">
              Invite the first staff member to get started.
            </EmptyState>
          </div>
        ) : (
          <Table
            stack
            caption="Staff members"
            rows={list.data!.items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'n',
                header: 'Name',
                rowHeader: true,
                cell: (r) => (
                  <span className="flex flex-wrap items-center gap-2">
                    {r.displayName}
                    {r.id === me?.id && <Badge tone="info">You</Badge>}
                    {r.isSynthetic && <Badge tone="warn">Demo</Badge>}
                  </span>
                ),
              },
              { key: 'r', header: 'Role', cell: (r) => ROLE_LABELS[r.role] },
              {
                key: 's',
                header: 'Status',
                cell: (r) => (
                  <span>
                    <Badge
                      tone={
                        r.status === 'active' ? 'good' : r.status === 'invited' ? 'info' : 'bad'
                      }
                    >
                      {titleCase(r.status)}
                    </Badge>
                  </span>
                ),
              },
              {
                key: 'p',
                header: 'Programs',
                cell: (r) =>
                  PROGRAM_SCOPED_ROLES.includes(r.role)
                    ? r.programIds.length
                      ? r.programIds.map(programName).join(', ')
                      : 'None assigned'
                    : 'All programs',
              },
              {
                key: 'l',
                header: 'Last sign-in',
                cell: (r) => (
                  <span className="t-num text-[0.875rem]">{fmtDateTime(r.lastLoginAt)}</span>
                ),
              },
              {
                key: 'a',
                header: <span className="sr-only">Actions</span>,
                className: 'md:text-right',
                cell: (r) => (
                  <Button
                    size="sm"
                    onClick={() => openEdit(r)}
                    aria-label={`Edit ${r.displayName}`}
                  >
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
        <p className="t-caption mt-4 max-w-2xl">
          Owners and administrators see every program. Analysts see aggregate results only.
          Instructors see the programs assigned to them.
        </p>
      </div>

      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        busy={busy}
        title={mode === 'invite' ? 'Invite staff' : `Edit ${editing?.displayName ?? ''}`}
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          {mode === 'invite' && (
            <>
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                data-autofocus=""
                hint="Used only to send the invitation through the sign-in provider."
              />
              <Input
                label="Display name"
                value={displayName}
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="off"
              />
            </>
          )}
          {isSelf && (
            <Notice tone="info">
              You can’t change your own role or status. Ask another owner.
            </Notice>
          )}
          <Select
            label="Role"
            value={role}
            disabled={isSelf}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            hint={ROLE_HELP[role]}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          {mode === 'edit' && (
            <Toggle
              checked={active}
              onChange={setActive}
              disabled={isSelf}
              label="Account enabled"
              hint="Disabled staff are signed out and can’t sign in."
            />
          )}
          {scoped ? (
            <Fieldset
              legend="Assigned programs"
              hint="Instructors only see cohorts and sessions in these programs."
            >
              {programs.loading ? (
                <LoadingBlock />
              ) : (programs.data?.items.length ?? 0) === 0 ? (
                <p className="t-small">No programs exist yet.</p>
              ) : (
                <div className="space-y-2">
                  {programs.data!.items.map((p) => (
                    <Checkbox
                      key={p.id}
                      label={p.name}
                      checked={programIds.includes(p.id)}
                      onChange={(e) =>
                        setProgramIds((cur) =>
                          e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </Fieldset>
          ) : (
            <p className="t-small text-ink-2">{ROLE_LABELS[role]}s can see all programs.</p>
          )}
          {formError && (
            <Notice tone="bad" role="alert">
              {formError}
            </Notice>
          )}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              {mode === 'invite' ? 'Send invitation' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
