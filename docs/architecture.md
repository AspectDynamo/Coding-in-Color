# Architecture — Coding in Color Impact

Owner: lead (Opus). This document is the binding spec for all agents. Contract files in `src/shared/` are the source of truth for names and shapes; this file explains the decisions behind them.

## 1. Purpose

Credible, low-friction learning-outcome measurement for Coding in Color's workshops, hackathons, camps, semester/year-long K-12 courses and AI Academy programs. Students take ≤ 6-minute assessments with a pseudonymous access code; instructors run sessions and print access cards; administrators see matched pre/post impact, skill-level gains, retention and honest limitations; AI drafts narratives from aggregates only.

Not an LMS/SIS. No student names, emails, birthdates, IPs or device fingerprints.

## 2. System

```
Browser (React SPA, Vite, Tailwind, Recharts)
   │  same-origin fetch /api/v1/*  (HttpOnly cookies + CSRF header)
   ▼
Cloudflare Worker (Hono)  ── serves SPA via Workers Static Assets (SPA fallback; /api/* runs Worker first)
   ├─ middleware: request id → security headers → CSRF/Origin → session (student | staff) → rate limit
   ├─ routes/: auth, student, instructor, admin, config, health
   ├─ services/: crypto, session-token, cookies, credentials, rate-limit, audit, dashboard, supabase-auth
   ├─ scoring/: pure server-side scoring registry + public question projection
   ├─ analytics/: pure functions — impact metrics, suppression, CSV, AI payload, number guard, template narrative
   ├─ repositories/: DataStore interface → MemoryStore (synthetic demo) | SupabaseStore (supabase-js, service role)
   └─ bindings: AI (Workers AI), STUDENT_LOGIN_LIMITER, STAFF_LOGIN_LIMITER, AI_LIMITER
   ▼
Supabase PostgreSQL (+ Supabase Auth for staff only)
```

### Data store selection

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set → `SupabaseStore`.
- Otherwise, if `DEMO_MODE=true` → `MemoryStore` seeded with the deterministic synthetic dataset from `src/backend/demo/` (per-isolate, resets on restart). This is what `npm run dev` uses with zero setup.
- Otherwise → every data route returns `503 not_configured`.
- **Production guard:** with `APP_ENV=production` the memory store is used only if `DEMO_MODE=true` **and** `ALLOW_PUBLIC_DEMO=true` (an intentional public synthetic demo). A missing or mistyped Supabase secret therefore fails closed instead of silently serving demo data.
- Environments: top-level `wrangler.jsonc` = local/demo (`npm run deploy`); `env.production` = Worker `cic-impact-production` (`npm run deploy:production`, secrets via `wrangler secret put NAME --env production`).
- **Demo staff login (`/auth/demo-login`) works only when the store is `MemoryStore`.** It can never grant access to real data.

The same synthetic generator produces `supabase/seed.sql`, so the memory store and a seeded Supabase project contain the same data and produce the same metrics.

### Why supabase-js with the service role

Workers can't hold long-lived Postgres connections without Hyperdrive; PostgREST over HTTPS via supabase-js is simple and reliable. The service-role key **bypasses RLS**, so:

- it lives only in Worker secrets, never in the bundle;
- the Worker authorizes every operation (role + program scope) before touching the store;
- RLS is still enabled on every table with no anon/authenticated policies, so a leaked anon key reads nothing;
- multi-row writes that must be atomic (submission + responses + skill scores; credential reissue) run inside SQL functions called via `rpc()`.

## 3. Identity and access

### Students (pseudonymous)

- `students.id`: UUID from `gen_random_uuid()`; never shown to students, printed, or sent to AI.
- `students.public_code`: short non-secret label (e.g. `S-7KQ2M9`) shown on cards, rosters and admin views.
- `cohort_students.roster_label`: cohort-local seat number (`07`). Instructors may keep their own paper mapping of seat → child offline; the system never stores it.
- **Access code**: 16 Crockford base32 chars from `crypto.getRandomValues` (~80 bits), displayed `XXXX-XXXX-XXXX-XXXX`. Stored only as `HMAC-SHA256(CREDENTIAL_PEPPER, normalizedCode)` hex + `key_version`. Pepper rotation: set `CREDENTIAL_PEPPER_PREVIOUS` and bump `CREDENTIAL_KEY_VERSION`; sign-in computes both hashes every time and accepts a previous-pepper match only for credentials with an older `key_version`; new cards use the current pepper. Lookup is by hash (unique index). Unknown, revoked and malformed codes return the identical `401 invalid_code` with the same message. Rate limited (binding + in-memory fallback, keyed on connecting IP _only_ inside the limiter — never stored or logged).
- QR cards encode `${origin}/s#code=XXXX-...` — the code is in the URL **fragment**, which browsers never send to the server. The SPA reads it, POSTs it, then clears the fragment with `history.replaceState`.
- Session: `cic_student` cookie = signed token `{sub: studentId, cid: credentialId, typ: 'student', iat, exp}` (HMAC-SHA256 with `SESSION_SECRET`, 4h). Every request re-checks that the credential is not revoked and the student is `active`.
- Students with status `pending_consent` can sign in but get `403 consent_required` on assessment routes (UI explains a grown-up needs to complete a form).
- Lost card → instructor reissues by `(cohortId, rosterLabel)`: old credential revoked, new one issued for the **same** student UUID, audited. If the seat can't be identified, the instructor issues a new card (new student record) — never guess. Admin merges (future) must be audited.

### Staff

- Supabase Auth (email+password, TOTP MFA). No public registration: owners invite staff (`auth.admin.inviteUserByEmail`) and create `staff_users` rows. Password reset via Supabase recovery email; endpoint always returns `{ ok: true }`.
- `/auth/login`: Worker calls Supabase Auth password grant, loads `staff_users` by `auth_user_id`, rejects disabled. If admin MFA is required (default **on** in production unless `REQUIRE_ADMIN_MFA=false`; off locally) and the user is owner/admin, require AAL2 via `/auth/mfa/verify` before issuing a session.
- MFA enrollment: an owner/admin who must use MFA but has no verified TOTP factor gets `{status:'mfa_enroll_required'}` plus a 5-minute encrypted `cic_mfa` cookie carrying an `enr` claim (set only when no verified factor existed). `POST /auth/mfa/enroll` creates a Supabase TOTP factor and returns the QR + secret once; `/auth/mfa/verify` verifies the first code and issues the session. Enroll is refused without `enr`, so a stolen password cannot add a second authenticator.
- First owner: `npm run create-owner -- --email … --name …` invites the user via Supabase admin API and creates the `staff_users` owner row (`invited` → `active` on first login).
- `cic_staff` cookie = signed token `{sub: staffId, typ: 'staff', role, iat, exp}` (8h). Every request reloads the staff row (status/role/assignments) — role changes and disables take effect immediately.
- Roles and permissions: `src/shared/constants.ts#ROLE_PERMISSIONS`. Instructors are scoped to `staff_program_assignments`; owners/admins/analysts see all programs. Analysts never see individual students.

### Cookies & CSRF

- `HttpOnly; SameSite=Lax; Path=/; Secure` (Secure omitted only for `http://localhost` in development).
- `cic_csrf` (readable) is set when absent; every mutating request needs `X-CSRF-Token` equal to the cookie **and** an `Origin` matching the request host or `ALLOWED_ORIGINS`.
- Nothing auth-related is ever stored in localStorage/sessionStorage.

## 4. Age bands & consent

- Age bands only (`UNDER_13`, `AGE_13_17`, `AGE_18_PLUS`).
- `ALLOW_UNDER_13_REGISTRATION=false` by default: issuing under-13 credentials returns `403 forbidden` with an explanatory message. When enabled, under-13 students are created `pending_consent` with a `consent_records` row (`pending`) and cannot take assessments until an admin records `granted`.
- Consent records: status, verification method, notice version (`CURRENT_PRIVACY_NOTICE_VERSION`), timestamps, recorder. Withdrawal sets the student to `withdrawn` (blocks access; data kept until a deletion request).
- Guardian contact lives in `guardian_contacts` (separate table, restricted to `consent.manage`, never returned in lists or joined into analytics).
- Deletion request (`DELETE /admin/students/:id`): hard delete cascades credentials, enrollments, attempts, responses, consent and guardian contact; the audit log keeps only `student.delete` with the public code. Aggregate AI reports saved earlier contain no student-level data.
- The platform provides a foundation; **legal requirements (COPPA, FERPA, Arizona law, school contracts) must be confirmed by counsel before production use with minors.**

## 5. Assessments

- `assessments` belong to a `form_family`; forms `A`/`B` of a family are equivalent and measure the same skills with different items. Each has `version`; editing questions means a new version.
- `questions.config` is public; answer keys live in `question_answer_keys` and are only read by the scoring service and by staff with `catalog.manage`.
- `assessment_sessions` bind an assessment + stage to a cohort with an open/closed status (and optional window). Students see open sessions for cohorts they're enrolled in.
- Flow: `GET /student/assessments` → `GET /student/assessments/:sessionId` (questions, ordering items shuffled server-side) → `POST .../start` (idempotent; creates `in_progress` attempt with `started_at`) → `POST .../submit` → completion screen. Drafts are kept client-side in sessionStorage keyed by attempt id (answers only).
- Submit validates: session open, student enrolled in the session cohort, attempt belongs to student and is `in_progress`, `assessmentVersion` matches, every questionId belongs to the assessment, response `kind` matches `RESPONSE_KIND_BY_TYPE`, no duplicates. Then scores and writes attempt + responses + skill scores atomically (`submit_attempt` SQL function / memory equivalent). A second submit returns `409 conflict`.
- **Retake policy**: one attempt per student per session for PRE/POST/RETENTION (unique index); PRACTICE sessions allow unlimited attempts and are excluded from impact metrics.
- No student code is ever executed.

### Scoring (single convention)

See `src/shared/constants.ts`. Auto-scored items are all-or-nothing except `multiple_select` (partial credit with penalty for wrong picks, floored at 0). Skipped items earn 0 and count toward max. Likert confidence is excluded from score and averaged into `self_reported_confidence`. `percentage_score = round(100·raw/max, 2)`.

## 6. Impact metrics

### Matching rule

A matched pair exists for `(student_id, cohort_id)` when the student has a submitted **PRE** attempt and a submitted **POST** attempt, both from sessions of that same cohort, whose assessments share `form_family`, and `post.submitted_at > pre.submitted_at`. Use the **earliest** PRE and the **latest** POST. Optional retention = latest submitted RETENTION attempt in the same cohort/family after the POST. Pairs never cross cohorts. Improvement is never computed from unmatched groups. Students with status `withdrawn` are excluded from all analytics (counts, completions, pairs) until their record is deleted.

### Filters

`programId`, `courseId`, `cohortId`, `instructorId` (cohort lead instructor) restrict cohorts. `from`/`to` restrict by the POST `submitted_at` for pairs and by `submitted_at` for completion counts. `stage` narrows completion counts/trend only. `skill` switches headline pre/post values to that skill's sub-score (pairs lacking the skill on either form are excluded) — the UI says so.

### Definitions (`src/backend/analytics/metrics.ts`)

- Percentage-point change = `post% − pre%`; headline = mean over matched pairs.
- Relative change % = `(meanPost − meanPre) / meanPre × 100`; **undefined** (null + flag) when `meanPre = 0`.
- Improved / unchanged / declined % = count / n × 100 (comparison at 2 dp).
- 95% CI of mean change via t-distribution; paired effect size `d_z = mean(diff)/sd(diff)`; null when n < 2.
- Completion rate = POST completions / enrolled; match rate = matched / PRE completions.
- All rounded to 1 dp for display, computed on unrounded values.

### Small-cell suppression

`SUPPRESSION_THRESHOLD` (default 10). Internal admin dashboard shows values but flags groups with n < threshold. **External outputs** (CSV exports, printable reports, AI inputs, instructor session aggregates) null out any cell with n < threshold and mark it `suppressed`. This is a protective default, not a legal de-identification guarantee.

### Honest language

UI and AI use "observed improvement", "measured learning gains", "assessment performance increased". Never "caused", "proved", "because of the program". Always show n, completion rate, assessment period, pre/post averages and `limitations`. Percentage points are labelled "pts"; percents "%". Confidence is labelled "self-reported".

## 7. AI summaries (Workers AI)

1. Admin with `reports.ai` clicks _Generate AI Impact Summary_ (rate limited per staff via `AI_LIMITER`).
2. Backend computes the dashboard for the filters, applies suppression, builds a **minimal aggregate payload** (`analytics/ai-payload.ts`): program/cohort names, counts, averages, change, improved %, skill-level averages with n ≥ threshold, period, limitations. Never IDs, codes, public codes, responses or histories.
3. `env.AI.run(env.AI_MODEL, { messages, response_format: { type: 'json_schema', ... } })` with a system prompt that forbids invented numbers and causal claims and requires saying when data are insufficient (n below threshold).
4. Output validated against `AiSummaryContent`; a **number guard** extracts every number from the text and flags any not derivable from the payload. Results stored in `ai_reports` with model id, prompt version, payload and validation.
5. On timeout/failure/invalid JSON → `503 ai_unavailable` with a deterministic **template** narrative (`generationMode: 'template'`) built from the same payload. Dashboards and exports never depend on AI.

## 8. Frontend

- React + react-router SPA under `src/frontend/`. Routes:
  - `/` landing (student entry + staff sign-in)
  - `/s` student code entry (reads `#code=` fragment), `/s/home`, `/s/assess/:sessionId`, `/s/done/:sessionId`
  - `/staff/login`
  - `/instructor`, `/instructor/sessions/new`, `/instructor/sessions/:id`, `/instructor/cohorts/:id`, `/instructor/cards` (printable cards for just-issued codes, held in memory only)
  - `/admin` (impact dashboard), `/admin/students`, `/admin/students/:id`, `/admin/catalog` (programs/courses/cohorts), `/admin/assessments`, `/admin/assessments/:id`, `/admin/consent`, `/admin/reports`, `/admin/reports/print`, `/admin/staff`, `/admin/audit`
- `services/api.ts`: fetch wrapper (same-origin, `credentials: 'same-origin'`, attaches `X-CSRF-Token` from the `cic_csrf` cookie on mutations, unwraps envelopes, typed errors).
- Navigation adapts to `StaffProfile.permissions`; the backend is still the authority.
- Demo banner whenever `PublicConfig.dataStore === 'memory'`.
- Self-hosted fonts; no third-party scripts, analytics, trackers or session replay.

## 9. Testing

- Vitest (node): scoring, metrics, suppression, number guard, credentials, sessions/CSRF, route authorization and full student/instructor/admin flows against `MemoryStore` via `app.request()`.
- Vitest (jsdom): key frontend components.
- Playwright: demo flow (student code → assessment → submit; instructor progress; admin dashboard filters; AI summary fallback; CSV export), mobile viewport.
- Bundle scan: built `dist/` must not contain secret names/values.
- SQL: migrations applied to a local Postgres with stubbed Supabase roles.
