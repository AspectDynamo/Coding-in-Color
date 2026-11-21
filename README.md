# Coding in Color Impact

Impact measurement for Coding in Color, an Arizona nonprofit that runs workshops, hackathons, camps, K-12 courses and an AI Academy.

## What it is

Coding in Color needs evidence that participants learned something, but the people in its programs are often minors, sessions are short, and the platform must not collect names, emails, birthdates or device identifiers. That is the measurement problem this platform addresses.

Students take short pseudonymous assessments with an access code. The design target is six minutes or less. Instructors run sessions and print access cards. Administrators see matched pre/post results, skill-level changes, retention and the limitations that go with them. Small groups are suppressed in every external output. AI can draft a narrative from aggregate numbers, but the dashboards and exports work without it.

- **Students** enter a printed or QR access code, answer an assessment, and never see answer keys.
- **Instructors** run assessment sessions for their assigned programs and issue or reissue access cards.
- **Administrators** review the impact dashboard, manage the catalog, consent records and staff, and export results.
- **Analysts** see aggregates only, never individual student records.

## Feature list

- Pseudonymous access codes: 16 Crockford base32 characters (about 80 bits), stored only as an HMAC; QR cards keep the code in the URL fragment.
- Assessments with eight question types (multiple choice, multiple select, code comprehension, predict output, debugging, ordering, short logic, confidence Likert), organised into equivalent form families (A/B).
- Stages PRE, POST, RETENTION and PRACTICE, opened and closed per cohort session. Scoring runs only on the server.
- Matched pre/post impact metrics per cohort: sample size, completion and match rates, mean change in percentage points, 95% confidence interval, paired effect size, improved/unchanged/declined shares, skill breakdowns, cohort comparison and trend.
- Small-cell suppression (default n < 10) for CSV exports, printable reports, AI input and instructor session aggregates.
- Printable instructor cards, reissue of lost cards without changing the student record, and session CSV export.
- Consent records and withdrawal. Under-13 registration is off by default.
- Role-based access (owner, admin, analyst, instructor) with program scoping for instructors. Staff actions are written to an append-only audit log. Student submissions are not audited.
- AI impact summaries from an aggregate-only payload, validated against a schema, checked by a number guard, with a deterministic template fallback.
- Synthetic demo dataset and demo staff sign-in for local development and presentations.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, React Router, Recharts, Lucide icons.
- **Backend:** Hono on a single Cloudflare Worker. Workers Static Assets serves the SPA; `/api/*` runs the Worker first.
- **Data:** Supabase Postgres via supabase-js (service role, server-side only) and Supabase Auth for staff.
- **AI:** Workers AI (optional).
- **Validation and contract:** zod schemas and DTOs in `src/shared/`.
- **Tests:** Vitest (unit, integration, jsdom components) and Playwright (end to end).
- **Tooling:** Wrangler, ESLint, Prettier, TypeScript.

## Quick start (zero-config demo)

The demo needs no Supabase project and no Cloudflare login. It uses an in-memory synthetic dataset.

Install dependencies:

```bash
npm install
```

Create `.dev.vars` with generated local secrets (it never overwrites an existing file):

```bash
npm run setup
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:5173. The port is fixed (`strictPort`), so if it is busy, see [docs/troubleshooting.md](docs/troubleshooting.md).

## Demo walkthrough

The demo data is fictional. Restarting `npm run dev` resets the in-memory store.

1. **Student.** Enter the presenter code `DEMA-FRSH-PRE0-2026` on the student entry page (`/s`). It opens a fresh pre-assessment for the cohort "CS Fundamentals (Tempe, late start)". Start it, answer, and submit.
2. **Instructor.** Go to `/staff/login` and click **Demo Instructor**. The instructor dashboard and session detail show the submission in the session progress. Session aggregates stay hidden until at least 10 submissions exist, which is the suppression threshold.
3. **Administrator.** Sign out, then go to `/staff/login` and click **Demo Admin**. The dashboard at `/admin` shows the impact KPIs. Your PRE submission counts as a PRE completion only. To create a matched pair, enter `DEMA-RDY2-P0ST-2026` as a student and submit the post-assessment for "Building with AI (hybrid)". The PRE for that cohort already exists, so the post creates a new pair and the dashboard changes.
4. **AI summary.** On the reports page, choose **Generate AI Impact Summary**. Locally there is no Workers AI binding, so the request returns `503 ai_unavailable` and the UI shows the deterministic template summary. This is expected.
5. **CSV and print.** On the admin dashboard, download the impact or skills CSV. Use **Printable report** for the print view, then **Print / Save as PDF**.

Demo staff buttons (Owner, Admin, Analyst, Instructor) appear on `/staff/login` only when the memory store is active.

## Scripts

| Script                      | What it does                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run setup`             | Creates `.dev.vars` with random `SESSION_SECRET` and `CREDENTIAL_PEPPER` if it does not exist.               |
| `npm run dev`               | Starts Vite with the Cloudflare plugin on port 5173 (strict).                                                |
| `npm run build`             | Builds the SPA and the Worker bundle into `dist/`.                                                           |
| `npm run preview`           | Runs `npm run build`, then `vite preview`.                                                                   |
| `npm run deploy`            | Builds, then `wrangler deploy` for the top-level (demo) Worker.                                              |
| `npm run deploy:production` | Builds with `CLOUDFLARE_ENV=production`, then deploys the production Worker.                                 |
| `npm run cf-typegen`        | Regenerates `worker-configuration.d.ts` with `wrangler types`.                                               |
| `npm run typecheck`         | Type-checks the app, worker and node configs.                                                                |
| `npm run lint`              | Runs ESLint.                                                                                                 |
| `npm run format`            | Runs Prettier over the repo.                                                                                 |
| `npm run test`              | Runs all Vitest projects once (node and jsdom).                                                              |
| `npm run test:watch`        | Runs Vitest in watch mode.                                                                                   |
| `npm run test:e2e`          | Runs Playwright (starts `npm run dev` unless a server is already running).                                   |
| `npm run db:migrate`        | Applies `supabase/migrations/*.sql` to `DATABASE_URL` with `psql`.                                           |
| `npm run db:seed`           | Generates `supabase/seed.sql` and loads it into `DATABASE_URL`. Demo and dev databases only.                 |
| `npm run create-owner`      | Invites the first owner (`-- --email <addr> --name "<name>"`). Refuses if an owner exists, unless `--force`. |
| `npm run scan:bundle`       | Fails if `dist/client` contains a secret name or a `.dev.vars` secret value. Run after `npm run build`.      |

## Configure Supabase

Use a development or staging project first. Production steps are in [docs/deployment.md](docs/deployment.md).

1. **Create a project** in the Supabase dashboard. Note the project URL, the anon key and the service role key under Project Settings, API. Note the Postgres connection string under Project Settings, Database.
2. **Set the Worker's local secrets.** Add these to `.dev.vars`:

   ```text
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```

   With all three set, `npm run dev` uses Supabase instead of the demo store. Remove them to return to the demo.

3. **Apply migrations.** The migration runner reads `DATABASE_URL` from the environment, `.env`, or `.dev.vars`. Put it in `.env` (see `.env.example`), or pass it inline:

   ```bash
   DATABASE_URL='postgresql://postgres:<password>@<host>:5432/postgres' npm run db:migrate
   ```

   Alternatively, use the Supabase CLI. This repository does not include `supabase/config.toml`, so initialize it once:

   ```bash
   supabase init
   ```

   ```bash
   supabase link --project-ref <project-ref>
   ```

   ```bash
   supabase db push
   ```

   Use one migration tracker per database: either `npm run db:migrate` or `supabase db push`, not both.

4. **Load synthetic data (optional, dev and demo only).** `npm run db:seed` truncates the application tables, then loads the synthetic dataset. It refuses when `APP_ENV=production` is set in the shell, `.env` or `.dev.vars`. The generated SQL also aborts if any non-synthetic student or staff row exists. Do not rely on either guard for a production database.

   ```bash
   npm run db:seed
   ```

5. **Harden Supabase Auth** in the dashboard:
   - Disable public sign-ups.
   - Enable TOTP multi-factor authentication.
   - Require email confirmation.
   - Set the Site URL and redirect URLs to the app origin, so invitation and recovery links land on the app.

6. **Create the first owner.** Run the bootstrap script with the Supabase URL and service role key in the environment (or `.dev.vars`):

   ```bash
   npm run create-owner -- --email you@your-org.example --name "Your Name"
   ```

   The script sends a Supabase invitation email and inserts the matching `staff_users` row (role `owner`, status `invited`). It refuses if an owner already exists, unless you pass `--force`. Open the invitation, set a password, and sign in at `/staff/login`. The first successful login sets the row to `active`.

   If the script is unavailable, insert the row by hand after creating the auth user in the dashboard, as a fallback only:

   ```sql
   insert into public.staff_users (auth_user_id, display_name, role, status, is_synthetic)
   values ('<auth-user-uuid>', 'Your Name', 'owner', 'invited', false);
   ```

   In production, owners and admins must complete TOTP at login (`REQUIRE_ADMIN_MFA` defaults to true). If an owner has no authenticator yet, the sign-in screen guides them through QR enrollment (`POST /auth/mfa/enroll`). See [docs/deployment.md](docs/deployment.md).

## Configure Workers AI (optional)

AI summaries use the `AI` binding declared in `wrangler.jsonc`:

```jsonc
"ai": { "binding": "AI" }
```

The model is set by `AI_MODEL`, which defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The model must support JSON-schema response format.

AI is optional. Without the binding (local development, for example), the summary endpoint returns `503 ai_unavailable` with a template summary, and `/config` reports `aiEnabled: false`. Workers AI has no local simulator, and `vite dev` runs with `remoteBindings: false`, so AI calls can only succeed in a deployed Worker.

## Environment variables

Secrets live in `.dev.vars` locally and in Worker secrets (`wrangler secret put <NAME> [--env production]`) when deployed. Values in `wrangler.jsonc` `vars` are not secret. `DATABASE_URL` is used only by the migration and seed scripts.

| Name                          | Where                       | Secret                  | Default                                                                                 | Purpose                                                                                                                                             |
| ----------------------------- | --------------------------- | ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`              | `.dev.vars` / Worker secret | Yes                     | none (required, at least 32 chars)                                                      | Signs session cookies. Also keys rate-limit hashing and encrypts the MFA token. Changing it signs everyone out.                                     |
| `CREDENTIAL_PEPPER`           | `.dev.vars` / Worker secret | Yes                     | none (required, at least 32 chars)                                                      | HMAC key for access codes. New codes always use it. To rotate, see `CREDENTIAL_PEPPER_PREVIOUS` and `CREDENTIAL_KEY_VERSION`.                       |
| `CREDENTIAL_PEPPER_PREVIOUS`  | `.dev.vars` / Worker secret | Yes                     | unset                                                                                   | Previous pepper, kept during rotation. Codes issued under it still sign in while their key version is lower than the current one.                   |
| `SUPABASE_URL`                | `.dev.vars` / Worker secret | No                      | unset (demo store)                                                                      | Supabase project URL.                                                                                                                               |
| `SUPABASE_ANON_KEY`           | `.dev.vars` / Worker secret | Keep out of git         | unset                                                                                   | Staff password sign-in, MFA and password reset. Needed with `SUPABASE_URL` for staff sign-in.                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`   | `.dev.vars` / Worker secret | Yes                     | unset (demo store)                                                                      | Server-only key that bypasses RLS. Selects the Supabase store.                                                                                      |
| `DATABASE_URL`                | `.env` or shell             | Yes (contains password) | none                                                                                    | Postgres connection for `db:migrate` and `db:seed`.                                                                                                 |
| `APP_ENV`                     | `wrangler.jsonc` vars       | No                      | `development` (top level), `production` (production env)                                | `development` or `production`. In production, the in-memory store is refused unless `DEMO_MODE` and `ALLOW_PUBLIC_DEMO` are both true.              |
| `DEMO_MODE`                   | `wrangler.jsonc` vars       | No                      | `true` (top level), `false` (production)                                                | Enables the synthetic memory store and demo staff login when no Supabase store is configured.                                                       |
| `ALLOW_PUBLIC_DEMO`           | `wrangler.jsonc` vars       | No                      | `false`                                                                                 | With `APP_ENV=production` and `DEMO_MODE=true`, allows the memory store (a deliberately public synthetic demo).                                     |
| `REQUIRE_ADMIN_MFA`           | `wrangler.jsonc` vars       | No                      | `false` (top level), `true` (production); code default `true` when `APP_ENV=production` | Owners and admins need an AAL2 session (TOTP) before a staff session is issued.                                                                     |
| `AI_MODEL`                    | `wrangler.jsonc` vars       | No                      | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`                                              | Workers AI model used for summaries.                                                                                                                |
| `SUPPRESSION_THRESHOLD`       | `wrangler.jsonc` vars       | No                      | `10`                                                                                    | Minimum group size (n) shown in external outputs and session aggregates.                                                                            |
| `ALLOW_UNDER_13_REGISTRATION` | `wrangler.jsonc` vars       | No                      | `false`                                                                                 | Allows issuing cards to under-13 students, who start as `pending_consent`. Enable only after legal review.                                          |
| `CREDENTIAL_KEY_VERSION`      | `wrangler.jsonc` vars       | No                      | `1`                                                                                     | Version recorded with each new credential. Bump it when rotating the pepper, so older credentials are matched against `CREDENTIAL_PEPPER_PREVIOUS`. |
| `ALLOWED_ORIGINS`             | `wrangler.jsonc` vars       | No                      | empty (same origin only)                                                                | Extra origins allowed for mutating requests, comma-separated.                                                                                       |

Bindings (configured in `wrangler.jsonc`, not environment variables): `AI` (Workers AI), `STUDENT_LOGIN_LIMITER` (60 per 60 seconds per IP), `STAFF_LOGIN_LIMITER` (10 per 60 seconds per IP and per account), `AI_LIMITER` (5 per 60 seconds per staff member, as the code keys it; `wrangler.jsonc` comments say per location), and `ASSETS` (static assets).

## Run tests

Run the full Vitest suite (unit, integration and jsdom component tests):

```bash
npm run test
```

Run only the unit tests:

```bash
npx vitest run tests/unit
```

Run only the integration tests, which exercise the Worker through `app.request()` against the memory store:

```bash
npx vitest run tests/integration
```

Type-check and lint:

```bash
npm run typecheck
```

```bash
npm run lint
```

End-to-end tests need the Playwright browser once:

```bash
npx playwright install chromium
```

Then run the suite. It signs in as demo staff, so `.dev.vars` must not contain Supabase values:

```bash
npm run test:e2e
```

The staff login limiter allows 10 attempts per minute. The suite signs in once per role in global setup to stay under it. If you see `429`, wait a minute.

## Deploy

**Demo deploy.** `npm run deploy` builds and deploys the top-level Worker `cic-impact` with `APP_ENV=development`, `DEMO_MODE=true`, `ALLOW_PUBLIC_DEMO=false` and `REQUIRE_ADMIN_MFA=false`. If no Supabase secrets are set on that Worker, it serves the synthetic memory store and demo login. Because it runs in development mode, a missing Supabase secret falls back to the demo store silently instead of returning `503`. Never put real data behind the demo Worker.

A public synthetic demo in production mode requires `APP_ENV=production` with both `DEMO_MODE=true` and `ALLOW_PUBLIC_DEMO=true`. That is a deliberate configuration change, not a flag on the existing commands.

```bash
npm run deploy
```

**Production deploy.** Set the production secrets first, then build and deploy:

```bash
npx wrangler secret put SESSION_SECRET --env production
```

```bash
npx wrangler secret put CREDENTIAL_PEPPER --env production
```

```bash
npx wrangler secret put SUPABASE_URL --env production
```

```bash
npx wrangler secret put SUPABASE_ANON_KEY --env production
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
```

```bash
npm run deploy:production
```

Then scan the built client bundle for secrets. It exits non-zero on a match:

```bash
npm run scan:bundle
```

The production Worker is named `cic-impact-production`. Without its Supabase secrets it answers `503 not_configured` on every data route (fail closed). See [docs/deployment.md](docs/deployment.md) for the full checklist.

**Build-order caveat.** `wrangler deploy` deploys the configuration that the most recent build wrote to `dist/` (`.wrangler/deploy/config.json` points there). The production environment exists only in the build that ran with `CLOUDFLARE_ENV=production`. Always deploy production with `npm run deploy:production`, not with a bare `wrangler deploy --env production` after a normal build. After editing `wrangler.jsonc`, run the build again before deploying.

## Project structure

```text
src/backend/     Hono Worker: routes/, middleware/, services/, repositories/ (MemoryStore, SupabaseStore),
                 analytics/, scoring/, demo/, utils/
src/frontend/    React SPA (pages/, components/, layouts/, hooks/, services/)
src/shared/      API contract (api.ts), zod validation, types, DB row types, constants
supabase/        migrations/0001_schema.sql, 0002_functions.sql, 0003_security.sql; generated seed.sql
scripts/         setup-dev.mjs, db-migrate.mjs, db-seed.mjs, generate-seed.ts
tests/           unit/, integration/, e2e/ (Playwright), setup/
docs/            architecture.md, security-privacy.md, database.md, api.md, deployment.md, troubleshooting.md
.claude/agents/  Agent definitions for this repository
```

## Agent workflow

This repository is built with specialized agents. Their definitions live in `.claude/agents/`: `frontend-fable`, `backend-sonnet`, `database-sonnet`, `security-reviewer`, `qa-haiku` and `docs-haiku`. The delegation table in `CLAUDE.md` says which agent owns which files, and only the frontend agent changes frontend code. Read `docs/architecture.md` before changing contracts.

## Privacy and limitations

- **Pseudonymous, not anonymous.** Students are identified by a UUID and a short public code. Instructors may keep a paper mapping from seat numbers to children, which the system never stores. Anyone holding that mapping can re-identify a participant.
- **No compliance claim.** The platform does not claim COPPA, FERPA or Arizona student-privacy compliance. It is a foundation. Under-13 registration is off by default. Before enabling it, or using the platform with minors in production, counsel must review COPPA and school-consent obligations, FERPA data-sharing terms, Arizona law, notice text, verification method and retention. See [docs/security-privacy.md](docs/security-privacy.md) section 7.
- **Small-cell suppression is protective, not a de-identification standard.** It does not protect against differencing across filters.
- **Pre/post design without a comparison group.** Observed change is not evidence that a program caused it. The UI and AI output must say so, and they do.
- **Self-reported confidence** is shown separately and is not a measure of skill.
- **AI output can still be wrong.** The model sees only aggregates, its output is validated, and numbers are checked against the input. Review every summary before sharing it.
- **Demo data is synthetic.** Students, staff, cohorts and scores are fictional, and the presenter codes work only for the demo dataset.
- **Known gaps** are listed in [docs/security-privacy.md](docs/security-privacy.md) section 10. Examples: logout does not revoke a stolen session token before it expires, admin merges are not implemented, and there is no issuance quota.

## Documentation

- [docs/architecture.md](docs/architecture.md): system design, identity, scoring and impact definitions.
- [docs/security-privacy.md](docs/security-privacy.md): data inventory, controls, review items and known gaps.
- [docs/database.md](docs/database.md): schema, integrity rules and SQL functions.
- [docs/api.md](docs/api.md): endpoints, permissions, DTOs and error codes.
- [docs/deployment.md](docs/deployment.md): production checklist, rollback and data-processing review.
- [docs/troubleshooting.md](docs/troubleshooting.md): common problems and fixes.
