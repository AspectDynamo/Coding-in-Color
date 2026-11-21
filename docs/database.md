# Database — Coding in Color Impact

Supabase PostgreSQL. The contract is `src/shared/db.ts` (row types) and `docs/architecture.md`; this file documents how the SQL implements it. Everything under `supabase/` and `src/backend/demo/` is owned by the database agent.

```
supabase/migrations/0001_schema.sql     tables, constraints, indexes, integrity triggers
supabase/migrations/0002_functions.sql  submit_attempt, matched_pairs, reissue_credential
supabase/migrations/0003_security.sql   RLS on every table + privilege lockdown
supabase/migrations/0004_exclude_withdrawn.sql  matched_pairs replaced: withdrawn students excluded
supabase/seed.sql                       GENERATED synthetic demo data (do not edit)
scripts/db-migrate.mjs                  apply migrations with psql, tracked in public._migrations
scripts/db-seed.mjs                     generate + load the synthetic seed (refuses APP_ENV=production)
scripts/generate-seed.ts                dataset -> supabase/seed.sql
src/backend/demo/                       deterministic synthetic dataset (Worker + Node + tests)
```

## Conventions

- Primary keys: `uuid default gen_random_uuid()` (core since PG13; no extension needed). Timestamps are `timestamptz`.
- **Enumerations are `text` + `CHECK`**, not Postgres enums. Adding a value is a constraint change rather than `ALTER TYPE`, and supabase-js returns plain strings that match the TypeScript unions in `src/shared/types.ts`.
- `numeric` columns come back from PostgREST as JSON numbers; timestamps come back as `2026-11-15T17:00:00+00:00` (not `...Z`) — compare instants, not strings.
- No student names, emails, birthdates, IPs or device identifiers exist in any table. Guardian contact lives only in `guardian_contacts`.
- Deletion policy: deleting a **student** cascades credentials, enrolments, consent (and guardian contacts), attempts, responses, skill scores and project evaluations. Catalogue rows (`programs`, `courses`, `cohorts`, `assessment_sessions`, `assessments` with responses, `questions` with responses) are `RESTRICT`: archive instead of delete. `audit_log` has no foreign keys, so audit rows outlive the people they describe.

## Tables

| Table                       | Notes                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs`                  | `slug` unique (`^[a-z0-9]+(-[a-z0-9]+)*$`). `updated_at` trigger.                                                                                                                                                               |
| `courses`                   | `unique (id, program_id)` (FK target), `unique (program_id, name)`.                                                                                                                                                             |
| `staff_users`               | `auth_user_id` unique; may be NULL **only** when `is_synthetic` (`staff_auth_required`). FK to `auth.users` is added only if that table exists (Supabase), `ON DELETE RESTRICT` — disable staff instead of deleting auth users. |
| `staff_program_assignments` | PK `(staff_id, program_id)`, cascade from both parents.                                                                                                                                                                         |
| `cohorts`                   | `end_date >= start_date`. Composite FK `(course_id, program_id) -> courses (id, program_id)` guarantees the course belongs to the cohort's program. `lead_instructor_id` `ON DELETE SET NULL`.                                  |
| `students`                  | `public_code` unique, `^S-[0-9A-HJKMNP-TV-Z]{6}$`. `updated_at` trigger.                                                                                                                                                        |
| `student_credentials`       | `credential_hash` unique, `^[0-9a-f]{64}$` (hex HMAC-SHA256). **Partial unique index: one active (`revoked_at is null`) credential per student.**                                                                               |
| `cohort_students`           | `unique (cohort_id, roster_label)`, `unique (cohort_id, student_id)`.                                                                                                                                                           |
| `consent_records`           | `granted` requires `consent_timestamp` + `verification_method`; `withdrawn` requires `withdrawal_timestamp`.                                                                                                                    |
| `guardian_contacts`         | Restricted. Cascades from `consent_records`. Never selected by analytics or instructor routes.                                                                                                                                  |
| `assessments`               | `unique (form_family, form_label, version)`, `unique (id, version)`, `estimated_minutes 1..15`, `intended_stages`/`skill_categories` arrays constrained to the shared vocabularies.                                             |
| `questions`                 | `unique (assessment_id, display_order)`; `confidence_likert` must have `points = 0`; `config` is a JSON object that may not contain answer keys (`correctOptionId`, `bugLine`, ... top-level guard).                            |
| `question_answer_keys`      | Backend-only, PK `question_id`.                                                                                                                                                                                                 |
| `assessment_sessions`       | `ends_at > starts_at`; `unique (id, cohort_id, assessment_id, stage)` is the target of the attempt FK.                                                                                                                          |
| `assessment_attempts`       | See below.                                                                                                                                                                                                                      |
| `assessment_responses`      | `unique (attempt_id, question_id)`; `0 <= earned <= max`. Trigger: the question must belong to the attempt's assessment and `max_points` must equal the question's `points`.                                                    |
| `attempt_skill_scores`      | PK `(attempt_id, skill_category)`, `max_points > 0`, `earned <= max`.                                                                                                                                                           |
| `project_evaluations`       | `rubric_score <= rubric_max`; composite FK `(cohort_id, student_id) -> cohort_students`.                                                                                                                                        |
| `ai_reports`                | Aggregate-only AI/template reports (`generation_mode in ('ai','template')`).                                                                                                                                                    |
| `audit_log`                 | Append-only (trigger rejects UPDATE/DELETE; `TRUNCATE` is intentionally allowed for the demo seed). `target_id` is `text` (uuid or public code).                                                                                |

### `assessment_attempts` integrity

| Guarantee                                                                                                 | Mechanism                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `cohort_id`, `assessment_id`, `stage` equal the session's                                                 | composite FK `(assessment_session_id, cohort_id, assessment_id, stage) -> assessment_sessions` |
| Recorded `assessment_version` is the assessment's real version                                            | composite FK `(assessment_id, assessment_version) -> assessments (id, version)`                |
| Student is enrolled in the attempt's cohort                                                               | composite FK `(cohort_id, student_id) -> cohort_students`                                      |
| One attempt per student per session for PRE/POST/RETENTION                                                | partial unique index `(student_id, assessment_session_id) where stage <> 'PRACTICE'`           |
| No two concurrent in-progress attempts for a student/session (start is idempotent)                        | partial unique index `... where status = 'in_progress'`                                        |
| submitted ⇒ `raw_score`, `max_score`, `percentage_score`, `submitted_at` not null; unsubmitted ⇒ all null | `attempts_submitted_scores_ck`, `attempts_unsubmitted_clean_ck`                                |
| `0 <= raw <= max`, `max > 0`, `0 <= percentage <= 100`, `1 <= confidence <= 5`                            | check constraints                                                                              |
| `percentage = round(100*raw/max, 2)` (±0.0051 so JS and Postgres rounding of exact halves never disagree) | `attempts_pct_consistent_ck`                                                                   |
| A submitted attempt is terminal and its identity/score columns are immutable                              | trigger `guard_attempt_update` (`CI005 attempt_immutable`)                                     |

Because of the composite FKs, **pre/post matching can never cross cohorts**: an attempt cannot point at one cohort's session while claiming another cohort.

### Indexes (dashboard paths)

`attempts (cohort_id, stage, status, submitted_at)`; partial `attempts (cohort_id, student_id, stage, submitted_at) where status='submitted'` (matching); partial `attempts (submitted_at) where status='submitted'` (date ranges); `attempts (student_id, stage)`; `cohorts (program_id)`, `(course_id)`, `(lead_instructor_id)`, `(status, start_date)`; `cohort_students (student_id)`; credentials by hash (unique) and by `student_id`; `students (public_code)` (unique); sessions by `(cohort_id, status)`; responses by `question_id`; skill scores by `skill_category`; audit log by time, actor, action, target.

## Retake policy

Exactly one attempt per student per session for PRE, POST and RETENTION (unique index). `PRACTICE` sessions allow unlimited attempts and are excluded from impact metrics and from `matched_pairs`. A second submit of the same attempt raises `already_submitted`; a second _start_ in a non-practice session hits the unique index, so the Worker's `start` must look up the existing attempt first (idempotent).

## Matching rule — `matched_pairs`

`matched_pairs(p_cohort_ids uuid[], p_from date default null, p_to date default null) returns setof matched_pair_row`

Implements `docs/architecture.md` § 6 exactly. Per `(student, cohort, form_family)`:

1. Only **submitted** attempts of stage `PRE`, `POST`, `RETENTION` in the requested cohorts (`PRACTICE`, in-progress and abandoned never count). `form_family` comes from the attempt's assessment. Students with status `withdrawn` are excluded from all analytics (counts, completions, pairs) until their record is deleted. (Since `0004_exclude_withdrawn.sql`; `pending_consent` students are not excluded.)
2. **PRE** = the earliest submitted PRE.
3. **POST** = the latest submitted POST with `submitted_at > pre.submitted_at` (no such POST ⇒ no pair).
4. **RETENTION** (optional) = the latest submitted RETENTION in the same cohort/family with `submitted_at > post.submitted_at`.
5. `p_from` / `p_to` (inclusive UTC calendar dates) filter on the **POST** `submitted_at`, applied after the pair is chosen.
6. `pre_skills` / `post_skills` are jsonb objects `{ skill_category: percentage 0..100 }` containing only the skills that exist on that attempt. A `NULL`/empty cohort list returns no rows. Output is ordered by `(cohort_id, student_id, form_family)`.

The composite type `matched_pair_row` mirrors `MatchedPairRow` in `src/shared/db.ts`. The function is `STABLE`, `SECURITY INVOKER`, with a pinned `search_path`.

## Functions and their errors

All run as the caller (the service role), pin `search_path = public, pg_temp`, and have `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated`. Custom errors use SQLSTATE class `CI`; PostgREST returns `{ code, message }`, so the Worker can branch on `message`.

| Function                                                                                                                                                          | Behaviour                                                                                                                                                                                                                                                                                                                                                                                          | Errors                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_attempt(p_attempt_id, p_student_id, p_raw, p_max, p_percentage, p_confidence, p_duration, p_responses jsonb, p_skills jsonb) returns assessment_attempts` | Locks the attempt row (`FOR UPDATE`), verifies ownership + `in_progress`, inserts responses `[{question_id, response_data, is_correct, earned_points, max_points}]` and skill scores `[{skill_category, earned_points, max_points}]`, then marks the attempt `submitted` with `submitted_at = now()` and returns it. Everything is one transaction: any constraint failure leaves no partial rows. | `attempt_not_found` (`CI001`, also for another student's attempt), `already_submitted` (`CI002`), `attempt_not_in_progress` (`CI003`), `invalid_payload` (`CI004`); table constraints raise `23514`/`23503`/`23505`, trigger errors `CI006` (`question_not_in_assessment`) and `CI007` (`max_points_mismatch`). |
| `matched_pairs(...)`                                                                                                                                              | See above.                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                                                                                               |
| `reissue_credential(p_student_id, p_new_hash, p_key_version, p_staff_id, p_reason) returns student_credentials`                                                   | Locks the student, revokes any active credential (`revoked_at = now()`, `revoked_reason = p_reason`), inserts the new one with `created_by = p_staff_id`, returns it. The Worker generates the code, hashes it and writes the audit row.                                                                                                                                                           | `student_not_found` (`CI010`); duplicate hash `23505`.                                                                                                                                                                                                                                                          |

`submit_attempt` does **not** re-check that the session is still open or that the student is `active`: the Worker validates both before calling (architecture § 5).

## RLS and the service-role tradeoff

- RLS is **enabled on every table** (`0003_security.sql`) with **no policies** for `anon` or `authenticated`, and table, sequence and function privileges are revoked from them (including default privileges for future objects, and `EXECUTE` from `PUBLIC`).
- The Worker uses the **service role**, which has the `BYPASSRLS` attribute, so RLS does not constrain it. **Authorization is entirely the Worker's job** (role + program scope on every endpoint). There is deliberately no row-level policy that could silently diverge from `ROLE_PERMISSIONS`.
- Benefit of keeping RLS on anyway: a leaked anon/publishable key, or a staff JWT replayed directly against PostgREST, can read and write nothing (permission denied). Risk accepted: a leaked **service-role key** is full access, so it lives only in Worker secrets, never in the bundle, and the audit log is append-only.
- The migrations skip `anon`/`authenticated`/`service_role` if they do not exist, so they also apply to plain Postgres.

## Credentials

Stored only as hex `HMAC-SHA256(key = CREDENTIAL_PEPPER as UTF-8, message = normalized code)` plus `key_version`. Normalization (identical in Worker and seed script): uppercase, strip spaces/dashes, `I`/`L` -> `1`, `O` -> `0`, drop `U`. Lookup is by hash on the unique index.

## Synthetic demo dataset

`src/backend/demo/generateDemoDataset(anchor = '2026-11-15')` is pure and deterministic (a seeded PRNG used **only** for synthetic data; no `Math.random`, no Node APIs, no fs), so it runs identically in the Worker (MemoryStore), in Node (seed script) and in tests. Contents (default anchor): 3 programs, 5 courses, 8 cohorts (mixed delivery modes, ~14 months), 6 synthetic staff (`Demo Owner/Admin/Analyst/Instructor`, plus two more instructors), ~142 students, ~320 submitted attempts (PRE/POST/RETENTION/PRACTICE) with realistic missingness, a mix of improving, unchanged and declining students, loops weakest and debugging gaining most, 3 question families (`cs-fundamentals`, `ai-literacy`, `workshop-quick`) with equivalent forms A/B using every question type except `project_rubric`, 8 under-13 students with consent records (7 granted, 1 pending), and every student gets a deterministic demo access code (`DEMS-XXXX-XXXX-XXXX`).

Responses are generated first and then **scored with a local scorer** that follows `src/shared/constants.ts`, so raw/max/percentage, `is_correct`, earned points, skill scores and confidence are internally consistent (cross-checked against `src/backend/scoring` in development: identical for every attempt).

Presenter flow (demo-only access codes, never real secrets):

| Label                            | Code                  | State                                                                                                    |
| -------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| Presenter — fresh pre-assessment | `DEMA-FRSH-PRE0-2026` | Active cohort `CS Fundamentals (Tempe, late start)` with an **open PRE** session; no attempts yet.       |
| Presenter — ready for post       | `DEMA-RDY2-P0ST-2026` | Active cohort `Building with AI (hybrid)` with an **open POST** session; PRE already submitted, no POST. |

`Demo Instructor` leads both cohorts and is assigned to both programs (K-12 CS Pathways, AI Academy).

## Seeding

```
npm run setup                      # creates .dev.vars with CREDENTIAL_PEPPER
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run db:migrate                 # applies supabase/migrations/*.sql in order via psql
npm run db:seed                    # generates supabase/seed.sql and loads it
```

- `db:migrate` records each applied file and its SHA-256 in `public._migrations`; a file edited after being applied is rejected (add a new migration instead). Each migration and its bookkeeping row run in one transaction.
- `db:seed` runs `scripts/generate-seed.ts` (reads `CREDENTIAL_PEPPER` and optional `CREDENTIAL_KEY_VERSION` from the environment or `.dev.vars`) and then `psql -f supabase/seed.sql`. It **refuses to run when `APP_ENV=production`**, and the generated file itself aborts if any non-synthetic student or staff row exists. If `CREDENTIAL_PEPPER` is missing the credential rows are omitted and a warning is printed.
- The pepper used when generating must equal the Worker's `CREDENTIAL_PEPPER` (and key version) or the demo codes will not match.
- `supabase/seed.sql` contains HMAC hashes derived from your local pepper: treat it as a build artefact and do not commit a file generated with a real pepper.
- **Supabase CLI alternative:** `supabase link --project-ref <ref>` then `supabase db push` applies the same migration files with the CLI's own tracking (use one tracker per database, not both). `supabase db reset` (local stack) applies migrations and then `supabase/seed.sql`.

## Local validation (how this was verified)

A throwaway cluster with stub roles — never commit or reuse it:

```bash
export PATH=$PATH:/opt/homebrew/bin LC_ALL=en_US.UTF-8
D=$(mktemp -d); initdb -D "$D/data" -U postgres --auth=trust -E UTF8
pg_ctl -D "$D/data" -o "-p 54329 -c unix_socket_directories= -c listen_addresses=127.0.0.1" -l "$D/log" -w start
psql -h 127.0.0.1 -p 54329 -U postgres -c "create role anon nologin" -c "create role authenticated nologin" \
     -c "create role service_role nologin bypassrls" -c "create database cic"
export DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cic
npm run db:migrate && npm run db:seed
psql "$DATABASE_URL" -c "select count(*) from matched_pairs(array(select id from cohorts))"
pg_ctl -D "$D/data" -m fast stop && rm -rf "$D"
```

(`unix_socket_directories=` is empty because macOS temp paths exceed the 103-byte socket limit; a stub `auth.users` is optional — without it the `staff_users` FK to `auth.users` is simply not created.) Checks run: row counts, `matched_pairs` count against an independent query, duplicate-submission rejection, cross-cohort / stage / assessment / enrolment / version mismatches, score-range and consent checks, `submit_attempt` (success, `already_submitted`, `attempt_not_found`, atomic rollback on an inconsistent percentage), `reissue_credential`, student cascade delete, `anon`/`authenticated` permission-denied and `service_role` success. Also applied cleanly to PostgreSQL 15 and 17.

Unit tests: `npx vitest run tests/unit/demo` (determinism, counts, scoring consistency, zod validation of every config/answer key, presenter codes, no identifying fields).
