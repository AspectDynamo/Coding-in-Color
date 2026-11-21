-- =====================================================================================
-- Coding in Color Impact — schema (tables, constraints, indexes, triggers)
--
-- Contract: src/shared/db.ts. Column names/types here MUST match those row types.
-- Design notes (see docs/database.md):
--   * Enumerations are `text` + CHECK constraints (not Postgres enums) so adding a value is a
--     one-line constraint change instead of ALTER TYPE, and supabase-js returns plain strings.
--   * Primary keys are uuid default gen_random_uuid() (built in since Postgres 13).
--   * No student names, emails, birthdates, IPs or device identifiers exist anywhere.
--   * Pre/post matching can never cross cohorts: attempts carry a denormalised
--     (assessment_session_id, cohort_id, assessment_id, stage) that is enforced by a composite
--     foreign key to the session, and the student must be enrolled in that cohort.
--   * Deletion policy: student deletion cascades everything that references the student;
--     catalogue rows (programs, courses, cohorts, sessions, assessments, questions) are
--     RESTRICTed once data hangs off them — archive instead of delete.
-- =====================================================================================

set search_path = public, pg_catalog;

-- ---- generic helpers ----------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---- programs / courses / staff / cohorts -------------------------------------------

create table programs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  format      text not null check (format in
                ('workshop','hackathon','camp','semester','year_long','ai_academy','community')),
  status      text not null default 'active' check (status in ('active','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger programs_set_updated_at before update on programs
  for each row execute function set_updated_at();

create table courses (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs (id),
  name        text not null check (length(btrim(name)) between 2 and 120),
  description text not null default '',
  status      text not null default 'active' check (status in ('active','archived')),
  created_at  timestamptz not null default now(),
  -- target of cohorts' composite FK: guarantees cohort.course belongs to cohort.program
  constraint courses_id_program_uq unique (id, program_id),
  constraint courses_program_name_uq unique (program_id, name)
);
create index courses_program_idx on courses (program_id);

create table staff_users (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique,   -- Supabase auth.users.id; FK added at the bottom when auth.users exists
  display_name   text not null check (length(btrim(display_name)) between 1 and 80),
  role           text not null check (role in ('owner','admin','analyst','instructor')),
  status         text not null default 'invited' check (status in ('invited','active','disabled')),
  is_synthetic   boolean not null default false,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  -- only synthetic demo staff may exist without a Supabase Auth identity
  constraint staff_auth_required check (auth_user_id is not null or is_synthetic)
);

create table staff_program_assignments (
  staff_id    uuid not null references staff_users (id) on delete cascade,
  program_id  uuid not null references programs (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (staff_id, program_id)
);
create index staff_program_assignments_program_idx on staff_program_assignments (program_id);

create table cohorts (
  id                  uuid primary key default gen_random_uuid(),
  program_id          uuid not null references programs (id),
  course_id           uuid not null,
  name                text not null check (length(btrim(name)) between 2 and 160),
  delivery_mode       text not null check (delivery_mode in ('in_person','remote','hybrid')),
  start_date          date not null,
  end_date            date not null,
  lead_instructor_id  uuid references staff_users (id) on delete set null,
  status              text not null default 'planned'
                        check (status in ('planned','active','completed','archived')),
  created_at          timestamptz not null default now(),
  constraint cohorts_dates_ck check (end_date >= start_date),
  -- composite FK: the course must belong to the cohort's program
  constraint cohorts_course_program_fk foreign key (course_id, program_id)
    references courses (id, program_id)
);
create index cohorts_program_idx    on cohorts (program_id);
create index cohorts_course_idx     on cohorts (course_id);
create index cohorts_lead_idx       on cohorts (lead_instructor_id);
create index cohorts_status_dates_idx on cohorts (status, start_date);

-- ---- students (pseudonymous) --------------------------------------------------------


create table students (
  id            uuid primary key default gen_random_uuid(),
  public_code   text not null unique
                  check (public_code ~ '^S-[0-9A-HJKMNP-TV-Z]{6}$'),   -- Crockford base32, no I L O U
  age_band      text not null check (age_band in ('UNDER_13','AGE_13_17','AGE_18_PLUS')),
  status        text not null default 'active'
                  check (status in ('active','pending_consent','withdrawn')),
  is_synthetic  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table students is
  'Pseudonymous students. NO names, emails, birthdates, IPs or device identifiers. UUID is internal only.';
create trigger students_set_updated_at before update on students
  for each row execute function set_updated_at();

create table student_credentials (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students (id) on delete cascade,
  credential_hash  text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  key_version      integer not null default 1 check (key_version >= 1),
  created_by       uuid references staff_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_reason   text,
  last_used_at     timestamptz,
  constraint credentials_revoked_reason_ck check (revoked_reason is null or revoked_at is not null)
);
comment on table student_credentials is
  'Access codes are stored only as hex HMAC-SHA256(pepper[key_version], normalized code).';
-- exactly one active (non-revoked) credential per student
create unique index student_credentials_one_active_uq
  on student_credentials (student_id) where revoked_at is null;
create index student_credentials_student_idx on student_credentials (student_id);

create table cohort_students (
  id            uuid primary key default gen_random_uuid(),
  cohort_id     uuid not null references cohorts (id) on delete cascade,
  student_id    uuid not null references students (id) on delete cascade,
  roster_label  text not null check (length(btrim(roster_label)) between 1 and 12),
  enrolled_at   timestamptz not null default now(),
  status        text not null default 'enrolled' check (status in ('enrolled','withdrawn')),
  constraint cohort_students_roster_uq  unique (cohort_id, roster_label),
  constraint cohort_students_student_uq unique (cohort_id, student_id)   -- also FK target for attempts
);
create index cohort_students_student_idx on cohort_students (student_id);

-- ---- consent & guardian contact (restricted) ---------------------------------------

create table consent_records (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references students (id) on delete cascade,
  consent_status        text not null
                          check (consent_status in ('not_required','pending','granted','denied','withdrawn')),
  verification_method   text check (verification_method in ('signed_form','email_plus','in_person','other')),
  notice_version        text not null,
  consent_timestamp     timestamptz,
  withdrawal_timestamp  timestamptz,
  recorded_by           uuid references staff_users (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint consent_granted_ck   check (consent_status <> 'granted'
                                         or (consent_timestamp is not null and verification_method is not null)),
  constraint consent_withdrawn_ck check (consent_status <> 'withdrawn' or withdrawal_timestamp is not null)
);
create index consent_records_student_idx on consent_records (student_id);
create index consent_records_status_idx  on consent_records (consent_status);

create table guardian_contacts (
  id                 uuid primary key default gen_random_uuid(),
  consent_record_id  uuid not null references consent_records (id) on delete cascade,
  contact_method     text not null check (contact_method in ('email','phone','paper')),
  contact_value      text not null check (length(contact_value) between 1 and 254),
  created_at         timestamptz not null default now()
);
comment on table guardian_contacts is
  'RESTRICTED. Guardian contact for consent only. Never joined into analytics, lists or instructor views.';
create index guardian_contacts_consent_idx on guardian_contacts (consent_record_id);

-- ---- assessment catalogue -----------------------------------------------------------

create table assessments (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid references courses (id) on delete set null,
  form_family        text not null check (form_family ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  form_label         text not null check (length(btrim(form_label)) between 1 and 4),
  title              text not null check (length(btrim(title)) between 3 and 160),
  description        text not null default '',
  version            integer not null default 1 check (version >= 1),
  difficulty         text not null check (difficulty in ('intro','intermediate','advanced')),
  estimated_minutes  integer not null check (estimated_minutes between 1 and 15),
  intended_stages    text[] not null
                       check (cardinality(intended_stages) >= 1
                              and intended_stages <@ array['PRE','POST','RETENTION','PRACTICE']::text[]),
  skill_categories   text[] not null default '{}'
                       check (skill_categories <@ array['programming_fundamentals','variables','data_types',
                         'conditionals','loops','functions','debugging','logic','problem_solving',
                         'code_comprehension','computational_thinking']::text[]),
  status             text not null default 'draft' check (status in ('draft','active','retired')),
  created_at         timestamptz not null default now(),
  constraint assessments_form_version_uq unique (form_family, form_label, version),
  -- target of attempts' composite FK so the recorded version must be the assessment's version
  constraint assessments_id_version_uq unique (id, version)
);
create index assessments_family_idx on assessments (form_family);
create index assessments_course_idx on assessments (course_id);

create table questions (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references assessments (id) on delete cascade,
  question_type   text not null check (question_type in ('multiple_choice','multiple_select',
                    'code_comprehension','predict_output','debugging','ordering','short_logic',
                    'confidence_likert','project_rubric')),
  prompt          text not null check (length(btrim(prompt)) >= 3),
  config          jsonb not null default '{}'::jsonb,
  skill_category  text not null check (skill_category in ('programming_fundamentals','variables','data_types',
                    'conditionals','loops','functions','debugging','logic','problem_solving',
                    'code_comprehension','computational_thinking')),
  difficulty      text not null check (difficulty in ('intro','intermediate','advanced')),
  points          numeric(5,2) not null default 1 check (points >= 0),
  display_order   integer not null check (display_order >= 0),
  constraint questions_order_uq unique (assessment_id, display_order),
  constraint questions_likert_points_ck check (question_type <> 'confidence_likert' or points = 0),
  -- defence in depth: public config must never carry answer data (top-level keys only)
  constraint questions_config_no_answers_ck check (
    jsonb_typeof(config) = 'object'
    and not (config ?| array['correctOptionId','correctOptionIds','bugLine','correctOrder',
                             'acceptedAnswers','answer_key','answerKey'])
  )
);

create table question_answer_keys (
  question_id  uuid primary key references questions (id) on delete cascade,
  answer_key   jsonb not null,
  constraint answer_key_object_ck check (jsonb_typeof(answer_key) = 'object')
);
comment on table question_answer_keys is 'Backend-only. Never selected by student-facing queries.';

-- ---- sessions & attempts ------------------------------------------------------------

create table assessment_sessions (
  id             uuid primary key default gen_random_uuid(),
  cohort_id      uuid not null references cohorts (id),
  assessment_id  uuid not null references assessments (id),
  stage          text not null check (stage in ('PRE','POST','RETENTION','PRACTICE')),
  title          text not null default '',
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text not null default 'scheduled' check (status in ('scheduled','open','closed')),
  created_by     uuid references staff_users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint sessions_window_ck check (starts_at is null or ends_at is null or ends_at > starts_at),
  -- target of attempts' composite FK
  constraint sessions_identity_uq unique (id, cohort_id, assessment_id, stage)
);
create index sessions_cohort_status_idx on assessment_sessions (cohort_id, status);
create index sessions_assessment_idx    on assessment_sessions (assessment_id);

create table assessment_attempts (
  id                        uuid primary key default gen_random_uuid(),
  student_id                uuid not null references students (id) on delete cascade,
  assessment_session_id     uuid not null,
  assessment_id             uuid not null,
  assessment_version        integer not null check (assessment_version >= 1),
  cohort_id                 uuid not null,
  stage                     text not null check (stage in ('PRE','POST','RETENTION','PRACTICE')),
  status                    text not null default 'in_progress'
                              check (status in ('in_progress','submitted','abandoned')),
  raw_score                 numeric(8,2),
  max_score                 numeric(8,2),
  percentage_score          numeric(5,2),
  self_reported_confidence  numeric(3,2),
  started_at                timestamptz not null default now(),
  submitted_at              timestamptz,
  duration_seconds          integer check (duration_seconds is null or duration_seconds >= 0),
  created_at                timestamptz not null default now(),

  -- attempt must carry exactly its session's cohort / assessment / stage
  constraint attempts_session_fk foreign key (assessment_session_id, cohort_id, assessment_id, stage)
    references assessment_sessions (id, cohort_id, assessment_id, stage),
  -- attempt must record the assessment's actual version
  constraint attempts_version_fk foreign key (assessment_id, assessment_version)
    references assessments (id, version),
  -- the student must be enrolled in the cohort whose session they are attempting
  constraint attempts_enrollment_fk foreign key (cohort_id, student_id)
    references cohort_students (cohort_id, student_id),

  constraint attempts_submitted_scores_ck check (
    status <> 'submitted'
    or (raw_score is not null and max_score is not null and percentage_score is not null
        and submitted_at is not null)),
  constraint attempts_unsubmitted_clean_ck check (
    status = 'submitted'
    or (raw_score is null and max_score is null and percentage_score is null and submitted_at is null)),
  constraint attempts_raw_range_ck check (
    raw_score is null or (raw_score >= 0 and max_score is not null and raw_score <= max_score)),
  constraint attempts_max_positive_ck check (max_score is null or max_score > 0),
  constraint attempts_pct_range_ck check (percentage_score is null or percentage_score between 0 and 100),
  -- percentage = round(100*raw/max, 2); tolerance covers JS-vs-Postgres rounding of exact halves
  constraint attempts_pct_consistent_ck check (
    percentage_score is null
    or abs(percentage_score - 100.0 * raw_score / max_score) <= 0.0051),
  constraint attempts_confidence_ck check (
    self_reported_confidence is null or self_reported_confidence between 1 and 5),
  constraint attempts_time_order_ck check (submitted_at is null or submitted_at >= started_at)
);
comment on column assessment_attempts.cohort_id is
  'Denormalised from the session (enforced by composite FK). Pre/post matching never crosses cohorts.';

-- Retake policy: one attempt per student per session for PRE/POST/RETENTION; PRACTICE is unlimited.
create unique index attempts_one_per_session_uq
  on assessment_attempts (student_id, assessment_session_id) where stage <> 'PRACTICE';
-- ...and never two concurrent in-progress attempts for the same student/session (start is idempotent).
create unique index attempts_one_in_progress_uq
  on assessment_attempts (student_id, assessment_session_id) where status = 'in_progress';

create index attempts_dashboard_idx   on assessment_attempts (cohort_id, stage, status, submitted_at);
create index attempts_submitted_idx   on assessment_attempts (cohort_id, student_id, stage, submitted_at)
  where status = 'submitted';
create index attempts_submitted_at_idx on assessment_attempts (submitted_at) where status = 'submitted';
create index attempts_student_idx     on assessment_attempts (student_id, stage);
create index attempts_session_idx     on assessment_attempts (assessment_session_id);
create index attempts_assessment_idx  on assessment_attempts (assessment_id);

-- submitted is terminal and its identity/score columns are immutable
create or replace function guard_attempt_update() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'submitted' and (
       new.status is distinct from old.status
    or new.student_id is distinct from old.student_id
    or new.assessment_session_id is distinct from old.assessment_session_id
    or new.assessment_id is distinct from old.assessment_id
    or new.assessment_version is distinct from old.assessment_version
    or new.cohort_id is distinct from old.cohort_id
    or new.stage is distinct from old.stage
    or new.raw_score is distinct from old.raw_score
    or new.max_score is distinct from old.max_score
    or new.percentage_score is distinct from old.percentage_score
    or new.self_reported_confidence is distinct from old.self_reported_confidence
    or new.submitted_at is distinct from old.submitted_at
  ) then
    raise exception 'attempt_immutable' using errcode = 'CI005',
      detail = 'A submitted attempt cannot be changed.';
  end if;
  return new;
end;
$$;
create trigger attempts_guard_update before update on assessment_attempts
  for each row execute function guard_attempt_update();

create table assessment_responses (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references assessment_attempts (id) on delete cascade,
  question_id    uuid not null references questions (id),
  response_data  jsonb not null,
  is_correct     boolean,
  earned_points  numeric(6,2) not null default 0,
  max_points     numeric(6,2) not null default 0,
  submitted_at   timestamptz not null default now(),
  constraint responses_attempt_question_uq unique (attempt_id, question_id),
  constraint responses_points_ck check (earned_points >= 0 and max_points >= 0 and earned_points <= max_points),
  constraint responses_data_object_ck check (jsonb_typeof(response_data) = 'object')
);
create index responses_question_idx on assessment_responses (question_id);

-- A response's question must belong to the attempt's assessment, and max_points must equal the
-- question's points (so scores cannot drift from the catalogue).
create or replace function guard_response_question() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_attempt_assessment uuid;
  v_q_assessment uuid;
  v_q_points numeric;
begin
  select assessment_id into v_attempt_assessment from assessment_attempts where id = new.attempt_id;
  select assessment_id, points into v_q_assessment, v_q_points from questions where id = new.question_id;
  if v_attempt_assessment is distinct from v_q_assessment then
    raise exception 'question_not_in_assessment' using errcode = 'CI006',
      detail = 'Response question does not belong to the attempt''s assessment.';
  end if;
  if new.max_points is distinct from v_q_points then
    raise exception 'max_points_mismatch' using errcode = 'CI007',
      detail = 'Response max_points must equal the question points.';
  end if;
  return new;
end;
$$;
create trigger responses_guard_question before insert or update of attempt_id, question_id, max_points
  on assessment_responses for each row execute function guard_response_question();

create table attempt_skill_scores (
  attempt_id      uuid not null references assessment_attempts (id) on delete cascade,
  skill_category  text not null check (skill_category in ('programming_fundamentals','variables','data_types',
                    'conditionals','loops','functions','debugging','logic','problem_solving',
                    'code_comprehension','computational_thinking')),
  earned_points   numeric(6,2) not null check (earned_points >= 0),
  max_points      numeric(6,2) not null check (max_points > 0),
  primary key (attempt_id, skill_category),
  constraint skill_scores_range_ck check (earned_points <= max_points)
);
create index attempt_skill_scores_skill_idx on attempt_skill_scores (skill_category);

-- ---- projects, AI reports, audit ----------------------------------------------------

create table project_evaluations (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students (id) on delete cascade,
  cohort_id      uuid not null references cohorts (id),
  project_key    text not null check (length(btrim(project_key)) between 1 and 80),
  rubric_score   numeric(6,2) not null check (rubric_score >= 0),
  rubric_max     numeric(6,2) not null check (rubric_max > 0),
  rubric_details jsonb not null default '{}'::jsonb,
  evaluated_at   timestamptz not null default now(),
  evaluator_id   uuid references staff_users (id) on delete set null,
  constraint project_score_range_ck check (rubric_score <= rubric_max),
  constraint project_enrollment_fk foreign key (cohort_id, student_id)
    references cohort_students (cohort_id, student_id)
);
create index project_evaluations_student_idx on project_evaluations (student_id);
create index project_evaluations_cohort_idx  on project_evaluations (cohort_id);

create table ai_reports (
  id                 uuid primary key default gen_random_uuid(),
  report_type        text not null check (report_type in ('program_impact','cohort_summary','grant_narrative',
                       'donor_update','board_summary','instructional_insights')),
  filters            jsonb not null default '{}'::jsonb,
  input_metrics      jsonb not null default '{}'::jsonb,
  generated_content  jsonb not null default '{}'::jsonb,
  generation_mode    text not null check (generation_mode in ('ai','template')),
  model_id           text,
  prompt_version     text not null,
  validation         jsonb not null default '{}'::jsonb,
  saved              boolean not null default false,
  created_by         uuid references staff_users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index ai_reports_created_idx on ai_reports (created_at desc);
create index ai_reports_saved_idx   on ai_reports (saved, created_at desc);

create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_type   text not null check (actor_type in ('staff','student','system')),
  actor_id     uuid,        -- deliberately no FK: audit rows outlive deleted staff/students
  action       text not null check (length(action) between 1 and 80),
  target_type  text,
  target_id    text,        -- text: may reference a uuid or a public code
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
comment on table audit_log is 'Append-only. metadata must never contain secrets, access codes or guardian contact values.';
create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_actor_idx   on audit_log (actor_id, created_at desc);
create index audit_log_action_idx  on audit_log (action, created_at desc);
create index audit_log_target_idx  on audit_log (target_type, target_id);

create or replace function audit_log_append_only() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_log_append_only' using errcode = 'CI008',
    detail = 'audit_log rows cannot be updated or deleted.';
end;
$$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_append_only();
-- (TRUNCATE is not blocked on purpose: the demo seed and retention tooling run as the table owner.)

-- ---- Supabase Auth link (only when running on Supabase / a database that has auth.users) ----
do $$
begin
  if to_regclass('auth.users') is not null then
    alter table public.staff_users
      add constraint staff_users_auth_user_fk
      foreign key (auth_user_id) references auth.users (id) on delete restrict;
  else
    raise notice 'auth.users not found: staff_users.auth_user_id left without a foreign key (non-Supabase database).';
  end if;
end;
$$;
