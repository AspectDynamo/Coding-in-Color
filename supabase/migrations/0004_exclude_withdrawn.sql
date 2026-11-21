-- =====================================================================================
-- 0004_exclude_withdrawn — students with status = 'withdrawn' are excluded from analytics.
--
-- Replaces matched_pairs() (same signature and return type as 0002_functions.sql) so that every
-- attempt of a withdrawn student is ignored: no pre, post or retention attempt of theirs can form
-- or extend a pair. Their rows are kept until the record is deleted (a separate action).
-- 'pending_consent' students are not excluded (they have no attempts anyway).
-- Never edit 0001-0003: db-migrate checksums applied migrations.
-- =====================================================================================

set search_path = public, pg_catalog;

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
    join students st on st.id = a.student_id and st.status <> 'withdrawn'
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
  'Matched pre/post(/retention) pairs per (student, cohort, form_family), excluding withdrawn students; see docs/architecture.md section 6.';
