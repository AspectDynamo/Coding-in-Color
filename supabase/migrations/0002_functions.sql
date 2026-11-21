-- =====================================================================================
-- SQL functions called by the Worker through supabase-js rpc() with the service role:
--   submit_attempt     — atomic submission (attempt + responses + skill scores)
--   matched_pairs      — matched pre/post(/retention) pairs, docs/architecture.md § 6
--   reissue_credential — revoke the active credential and issue a new one atomically
--
-- All functions are SECURITY INVOKER (they run with the caller's privileges — the service
-- role) with a pinned search_path. Privileges are locked down in 0003_security.sql.
--
-- Error contract (SQLSTATE class 'CI' = Coding in Color Impact; surfaced by PostgREST as
-- { code, message }):
--   CI001 attempt_not_found        CI002 already_submitted      CI003 attempt_not_in_progress
--   CI004 invalid_payload          CI010 student_not_found
-- =====================================================================================

set search_path = public, pg_catalog;

-- ---- submit_attempt -----------------------------------------------------------------
--
-- p_responses: [{ question_id, response_data, is_correct, earned_points, max_points }]
-- p_skills:    [{ skill_category, earned_points, max_points }]
-- The Worker scores; this function only persists, atomically. Row constraints and the
-- guard_response_question trigger reject inconsistent data (wrong assessment, wrong max
-- points, raw > max, percentage out of range / inconsistent with raw/max, ...).
create or replace function submit_attempt(
  p_attempt_id  uuid,
  p_student_id  uuid,
  p_raw         numeric,
  p_max         numeric,
  p_percentage  numeric,
  p_confidence  numeric,
  p_duration    integer,
  p_responses   jsonb,
  p_skills      jsonb
) returns assessment_attempts
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_attempt assessment_attempts;
begin
  if p_responses is null or jsonb_typeof(p_responses) <> 'array'
     or p_skills is null or jsonb_typeof(p_skills) <> 'array' then
    raise exception 'invalid_payload' using errcode = 'CI004',
      detail = 'p_responses and p_skills must be JSON arrays.';
  end if;

  -- Serialise concurrent submits of the same attempt.
  select * into v_attempt
  from assessment_attempts
  where id = p_attempt_id and student_id = p_student_id
  for update;

  if not found then
    -- Also covers "attempt belongs to another student": never reveal which.
    raise exception 'attempt_not_found' using errcode = 'CI001';
  end if;

  if v_attempt.status = 'submitted' then
    raise exception 'already_submitted' using errcode = 'CI002';
  elsif v_attempt.status <> 'in_progress' then
    raise exception 'attempt_not_in_progress' using errcode = 'CI003',
      detail = 'Attempt status is ' || v_attempt.status || '.';
  end if;

  insert into assessment_responses
    (attempt_id, question_id, response_data, is_correct, earned_points, max_points, submitted_at)
  select p_attempt_id, r.question_id, r.response_data, r.is_correct,
         coalesce(r.earned_points, 0), coalesce(r.max_points, 0), now()
  from jsonb_to_recordset(p_responses) as r(
    question_id   uuid,
    response_data jsonb,
    is_correct    boolean,
    earned_points numeric,
    max_points    numeric
  );

  insert into attempt_skill_scores (attempt_id, skill_category, earned_points, max_points)
  select p_attempt_id, s.skill_category, s.earned_points, s.max_points
  from jsonb_to_recordset(p_skills) as s(
    skill_category text,
    earned_points  numeric,
    max_points     numeric
  );

  update assessment_attempts
     set status = 'submitted',
         raw_score = p_raw,
         max_score = p_max,
         percentage_score = p_percentage,
         self_reported_confidence = p_confidence,
         duration_seconds = p_duration,
         submitted_at = now()
   where id = p_attempt_id
  returning * into v_attempt;

  return v_attempt;
end;
$$;

comment on function submit_attempt(uuid, uuid, numeric, numeric, numeric, numeric, integer, jsonb, jsonb) is
  'Atomically persist a scored submission. Raises attempt_not_found / already_submitted / attempt_not_in_progress.';

-- ---- matched_pairs ------------------------------------------------------------------
--
-- Matching rule (docs/architecture.md § 6): a pair exists for (student, cohort, form_family)
-- when the student has a submitted PRE and a later submitted POST in sessions of that same
-- cohort whose assessments share form_family. Earliest PRE, latest POST after that PRE,
-- optional latest RETENTION after the POST. PRACTICE and non-submitted attempts never count.
-- p_from / p_to (inclusive, UTC calendar dates) filter on the POST submitted_at.
-- A NULL / empty p_cohort_ids returns no rows.
create type matched_pair_row as (
  student_id            uuid,
  cohort_id             uuid,
  program_id            uuid,
  course_id             uuid,
  form_family           text,
  pre_attempt_id        uuid,
  post_attempt_id       uuid,
  pre_percentage        numeric,
  post_percentage       numeric,
  pre_submitted_at      timestamptz,
  post_submitted_at     timestamptz,
  pre_confidence        numeric,
  post_confidence       numeric,
  retention_attempt_id  uuid,
  retention_percentage  numeric,
  pre_skills            jsonb,
  post_skills           jsonb
);

create or replace function matched_pairs(
  p_cohort_ids uuid[],
  p_from       date default null,
  p_to         date default null
) returns setof matched_pair_row
language sql
stable
set search_path = public, pg_temp
as $$
  with sub as (
    select a.id, a.student_id, a.cohort_id, a.stage, a.submitted_at,
           a.percentage_score, a.self_reported_confidence, s.form_family
    from assessment_attempts a
    join assessments s on s.id = a.assessment_id
    where a.status = 'submitted'
      and a.stage in ('PRE', 'POST', 'RETENTION')
      and a.cohort_id = any (p_cohort_ids)
  ),
  pre as (
    select distinct on (student_id, cohort_id, form_family) *
    from sub
    where stage = 'PRE'
    order by student_id, cohort_id, form_family, submitted_at asc, id asc
  ),
  pairs as (
    select pre.student_id, pre.cohort_id, pre.form_family,
           pre.id as pre_id, pre.percentage_score as pre_pct,
           pre.submitted_at as pre_at, pre.self_reported_confidence as pre_conf,
           po.id as post_id, po.percentage_score as post_pct,
           po.submitted_at as post_at, po.self_reported_confidence as post_conf
    from pre
    join lateral (
      select x.*
      from sub x
      where x.stage = 'POST'
        and x.student_id = pre.student_id
        and x.cohort_id = pre.cohort_id
        and x.form_family = pre.form_family
        and x.submitted_at > pre.submitted_at
      order by x.submitted_at desc, x.id desc
      limit 1
    ) po on true
  )
  select p.student_id, p.cohort_id, c.program_id, c.course_id, p.form_family,
         p.pre_id, p.post_id,
         p.pre_pct, p.post_pct, p.pre_at, p.post_at, p.pre_conf, p.post_conf,
         r.id, r.percentage_score,
         coalesce((select jsonb_object_agg(k.skill_category, round(100.0 * k.earned_points / k.max_points, 2))
                   from attempt_skill_scores k where k.attempt_id = p.pre_id), '{}'::jsonb),
         coalesce((select jsonb_object_agg(k.skill_category, round(100.0 * k.earned_points / k.max_points, 2))
                   from attempt_skill_scores k where k.attempt_id = p.post_id), '{}'::jsonb)
  from pairs p
  join cohorts c on c.id = p.cohort_id
  left join lateral (
    select x.*
    from sub x
    where x.stage = 'RETENTION'
      and x.student_id = p.student_id
      and x.cohort_id = p.cohort_id
      and x.form_family = p.form_family
      and x.submitted_at > p.post_at
    order by x.submitted_at desc, x.id desc
    limit 1
  ) r on true
  where (p_from is null or (p.post_at at time zone 'UTC')::date >= p_from)
    and (p_to   is null or (p.post_at at time zone 'UTC')::date <= p_to)
  order by p.cohort_id, p.student_id, p.form_family;
$$;

comment on function matched_pairs(uuid[], date, date) is
  'Matched pre/post(/retention) pairs per (student, cohort, form_family); see docs/architecture.md section 6.';

-- ---- reissue_credential -------------------------------------------------------------
--
-- Revokes the student's active credential(s) and inserts the new one in one transaction so a
-- student never has zero or two active credentials. The Worker generates the code, computes
-- the HMAC and writes the audit row.
create or replace function reissue_credential(
  p_student_id   uuid,
  p_new_hash     text,
  p_key_version  integer,
  p_staff_id     uuid,
  p_reason       text
) returns student_credentials
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row student_credentials;
begin
  perform 1 from students where id = p_student_id for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'CI010';
  end if;

  update student_credentials
     set revoked_at = now(),
         revoked_reason = p_reason
   where student_id = p_student_id
     and revoked_at is null;

  insert into student_credentials (student_id, credential_hash, key_version, created_by)
  values (p_student_id, p_new_hash, p_key_version, p_staff_id)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function reissue_credential(uuid, text, integer, uuid, text) is
  'Atomically revoke the active credential and insert a new one. Raises student_not_found.';
