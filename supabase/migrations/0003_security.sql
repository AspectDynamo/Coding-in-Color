-- =====================================================================================
-- Row Level Security and privileges.
--
-- Model: ALL data access goes through the Cloudflare Worker using the Supabase SERVICE ROLE
-- key. The service role has the BYPASSRLS attribute, so RLS does not restrict it — the Worker
-- is the authorization layer (role + program scope checks on every endpoint).
--
-- RLS is still ENABLED on every table with NO policies for anon/authenticated, and table /
-- function privileges are revoked from them, so a leaked anon (publishable) key or an
-- authenticated staff JWT used directly against PostgREST can read and write NOTHING.
-- (Default-deny: RLS on + zero policies = no rows visible; revoked privileges = permission denied.)
--
-- Roles `anon`, `authenticated`, `service_role` exist on Supabase. On a plain Postgres the
-- blocks below skip roles that do not exist (so the migration is portable).
-- =====================================================================================

set search_path = public, pg_catalog;

do $$
declare
  t text;
  r text;
  tables text[] := array[
    'programs','courses','staff_users','staff_program_assignments','cohorts',
    'students','student_credentials','cohort_students','consent_records','guardian_contacts',
    'assessments','questions','question_answer_keys','assessment_sessions',
    'assessment_attempts','assessment_responses','attempt_skill_scores',
    'project_evaluations','ai_reports','audit_log'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Lock down anon / authenticated completely (tables, sequences, functions) ...
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      -- ... and for objects created by later migrations.
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;

  -- Functions are executable by PUBLIC by default; anon/authenticated inherit that, so revoke it.
  revoke all on all functions in schema public from public;
  alter default privileges in schema public revoke all on functions from public;

  -- The Worker's role.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end;
$$;

comment on table audit_log is
  'Append-only. metadata must never contain secrets, access codes or guardian contact values. '
  'RLS on, no policies: service role (Worker) only.';
