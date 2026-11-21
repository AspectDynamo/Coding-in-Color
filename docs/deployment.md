# Deployment

Production runs as one Cloudflare Worker (`cic-impact-production`) that serves the SPA and the `/api/v1` API, backed by a Supabase project. Read this page top to bottom before the first production deploy.

**Do not start production with real student data until the data-processing review in section 6 is complete and counsel has signed off on minors' data.** The platform does not claim COPPA, FERPA or state-law compliance (see [security-privacy.md](security-privacy.md)).

## 1. Environments

| Environment | Worker                   | Config                                                                              | Data store                                                  | Use                           |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- |
| Local       | `vite dev`               | `.dev.vars`, `wrangler.jsonc` top level                                             | Memory (no Supabase values) or a dev Supabase project       | Development and tests         |
| Demo        | `cic-impact` (top level) | `wrangler.jsonc` top level: `APP_ENV=development`, `DEMO_MODE=true`                 | Memory, unless Supabase secrets are set on this Worker      | Synthetic demonstrations only |
| Production  | `cic-impact-production`  | `env.production`: `APP_ENV=production`, `DEMO_MODE=false`, `REQUIRE_ADMIN_MFA=true` | Supabase only. Missing secrets return `503 not_configured`. | Real data, after review       |

Use a separate Supabase project for staging. The Playwright suite expects the memory store, so run it against local development, not against a Supabase-backed Worker.

## 2. Production checklist

Work through this list in order. Tick each item before moving on.

### Cloudflare

- [ ] Cloudflare account with Workers, Workers AI, Workers Static Assets and Rate Limiting available. Confirm that Workers AI is enabled for the account and that the model in `AI_MODEL` is available to it.
- [ ] Custom domain attached to the production Worker. The app uses same-origin cookies, so use the production domain consistently.
- [ ] Rate-limit namespace IDs in `env.production` (`2001`, `2002`, `2003`) are unique in the account. They must not match the demo IDs (`1001` to `1003`).
- [ ] `wrangler.jsonc` `env.production.vars` reviewed: `APP_ENV=production`, `DEMO_MODE=false`, `ALLOW_PUBLIC_DEMO=false`, `REQUIRE_ADMIN_MFA=true`, `ALLOW_UNDER_13_REGISTRATION=false` (unless counsel has approved enabling it), `SUPPRESSION_THRESHOLD=10`.
- [ ] `ALLOWED_ORIGINS` is empty unless another origin genuinely needs to make mutating requests.

### Supabase

- [ ] Project created in the region chosen during the data-processing review (section 6).
- [ ] Authentication: public sign-ups disabled.
- [ ] Authentication: TOTP multi-factor enabled.
- [ ] Authentication: email confirmation required.
- [ ] Authentication: Site URL and redirect URLs set to the production origin, so invitation and recovery links land on the app.
- [ ] Authentication email: a custom SMTP provider configured for invitations and recovery emails. Review the provider under section 6.
- [ ] Database: backups and point-in-time recovery confirmed for the plan in use. Note the retention period (section 6).
- [ ] Project API keys: the service role key is copied only into Worker secrets and the local `.env` used for migrations. It must not appear in the repository or the bundle. Run `npm run scan:bundle` after every build (see Deploy below).

### Secrets (Worker secrets, not `wrangler.jsonc`)

Set each secret before the first production deploy. Missing values fail closed with `503 not_configured`.

- [ ] `SESSION_SECRET`: at least 32 characters, generated randomly. Never reuse the local value.
- [ ] `CREDENTIAL_PEPPER`: at least 32 characters, generated randomly. **Write it down in the organisation's secret store.** Losing it makes every issued access code unverifiable. Rotate it only as described in section 5.
- [ ] `CREDENTIAL_PEPPER_PREVIOUS`: leave unset until a rotation is planned (optional secret, at least 32 characters when set).
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

Generate a secret locally, then paste it at the prompt. Do not write it into a file or shell history:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set a secret:

```bash
npx wrangler secret put SESSION_SECRET --env production
```

Confirm which secrets exist (names only; values are never shown):

```bash
npx wrangler secret list --env production
```

### Database

- [ ] Migrations applied in order to the production project, using one tracker only.
  - Option A: `DATABASE_URL='postgresql://postgres:<password>@<host>:5432/postgres' npm run db:migrate`
  - Option B: `supabase init` once, then `supabase link --project-ref <ref>` and `supabase db push`. This repository does not include `supabase/config.toml`.
- [ ] `npm run db:seed` **not run** against production. It truncates application tables. Its safety checks depend on the shell's `APP_ENV` and on synthetic rows already being present, so do not rely on them.
- [ ] After migrations, this query runs without error and returns a count: `select count(*) from matched_pairs(array(select id from cohorts));`. `docs/database.md` describes the integrity guarantees.
- [ ] Row-level security is enabled on all tables (`0003_security.sql`). Confirm with the Supabase table editor that no table has a public policy.

### First owner

Create the first owner with the bootstrap script, then let the owner invite everyone else. Run it from a trusted machine, with the production values in the environment (not in a committed file):

1. Create the owner. The script invites the user through Supabase Auth (sending the invitation email) and inserts the matching `staff_users` row with role `owner` and status `invited`:

   ```bash
   SUPABASE_URL='https://<project-ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY="$(cat /secure/path/service-role-key)" npm run create-owner -- --email owner@your-org.example --name "Owner Name"
   ```

   The script refuses if an owner already exists, unless `--force` is passed. It never prints the service key. Requires the invitation email to be deliverable (custom SMTP, section 2 Supabase).

2. The invitee opens the email, sets a password, and signs in at `/staff/login`. The first successful login sets the row to `active`.
3. MFA: `REQUIRE_ADMIN_MFA` defaults to true in production, so owners and admins must have a verified TOTP factor. If the account has none, the sign-in screen guides the owner through QR enrollment (`POST /auth/mfa/enroll`, then `POST /auth/mfa/verify`). Enrollment is allowed only for sign-ins that found no verified factor, and only once per account. Check this on staging before the first production sign-in.
4. As owner, invite the other staff through the admin staff page or `POST /admin/staff`. Instructors need program assignments to see anything. Owners, admins and analysts see all programs.

**Fallback (only if the script cannot run).** Create the user in the Supabase dashboard (Authentication, Users), copy the user's UUID, then insert the row in the SQL editor:

```sql
insert into public.staff_users (auth_user_id, display_name, role, status, is_synthetic)
values ('<auth-user-uuid>', '<Display Name>', 'owner', 'invited', false);
```

### Deploy

- [ ] Local checks pass: `npm run typecheck`, `npm run lint`, `npm run test`.
- [ ] Build and deploy with the production script:

  ```bash
  npm run deploy:production
  ```

- [ ] Scan the built client bundle for secret names and values. Run it after the build, and before the deploy if you split the steps. It exits non-zero on a match and prints only the file and the check that matched:

  ```bash
  npm run scan:bundle
  ```

- [ ] Health check returns `configured: true`:

  ```bash
  curl -s https://<production-domain>/api/v1/health
  ```

- [ ] Public config reports the Supabase store and no demo login:

  ```bash
  curl -s https://<production-domain>/api/v1/config
  ```

  The response must show `"dataStore":"supabase"` and `"demoLoginEnabled":false`.

- [ ] Staff sign-in works with MFA, and the owner's dashboard loads.
- [ ] A test student code from a test cohort works, using a credential issued for a test student. Remove that test data afterwards with the admin delete flow.

### Observability

- [ ] `observability.enabled: true` with `invocation_logs: false` (both in `wrangler.jsonc`). Platform invocation logs record full URLs, so they stay off. The app's own logs (`src/backend/utils/logger.ts`) record the path, status, duration and a request ID, and redact codes, cookies, tokens and contact details.
- [ ] Log retention in the Cloudflare dashboard matches the data-processing review (section 6).
- [ ] Alerts on repeated `503 not_configured`, `500 internal` and `429 rate_limited` spikes, if your monitoring tool can read them.

## 3. Build order and configuration caveats

- `npm run deploy:production` runs the build with `CLOUDFLARE_ENV=production`, then `wrangler deploy`. Wrangler deploys the configuration written by the most recent build (`.wrangler/deploy/config.json` points at `dist/cic_impact/wrangler.json`).
- If you run `npm run build` without `CLOUDFLARE_ENV=production`, the `dist/` configuration is the top-level one. Then `wrangler deploy --env production` deploys a configuration that does not match the build. Always use `npm run deploy:production`.
- After editing `wrangler.jsonc`, rebuild before deploying. Changes to `vars`, bindings or rate-limit namespaces are not picked up until the next build.
- Secrets are per Worker. Setting a secret on `cic-impact` does not affect `cic-impact-production`, and the reverse is also true.
- Environments do not inherit `vars`, bindings or `ratelimits`. Repeat them in `env.production` when you change them.

## 4. Rollback

**Worker code.** Find the previous version and roll back:

```bash
npx wrangler deployments list --env production
```

```bash
npx wrangler rollback --env production
```

Confirm the rollback target with the deployment list before you run it. Rolling back the Worker does not change the database or secrets.

**Database.** Migrations are forward only. `npm run db:migrate` refuses to run if an applied file has changed, so fix mistakes with a new migration. Before applying a migration to production, take a backup or confirm point-in-time recovery, and record the time. Data changed after a migration is not reverted by a Worker rollback.

**Secrets.** To revoke everyone's sessions, rotate `SESSION_SECRET` (all staff and students are signed out; students must enter a code again). Do not rotate `CREDENTIAL_PEPPER` as a rollback step (section 5).

**Stop the bleeding.** If a credential or staff account is compromised, revoke the credential (`POST /instructor/student-credentials/reissue`), disable the staff account (`PATCH /admin/staff/:id` with `status: "disabled"`), or withdraw the student. Each takes effect on the next request.

## 5. Pepper and key rotation

`CREDENTIAL_PEPPER` is part of the hash of every access code. Changing it without a previous pepper makes every issued code fail, including real students' cards. Rotation keeps old cards working:

1. Set the secret `CREDENTIAL_PEPPER_PREVIOUS` to the **current** pepper value, and set `CREDENTIAL_PEPPER` to the new value:

   ```bash
   npx wrangler secret put CREDENTIAL_PEPPER_PREVIOUS --env production
   ```

   ```bash
   npx wrangler secret put CREDENTIAL_PEPPER --env production
   ```

2. Bump `CREDENTIAL_KEY_VERSION` in `env.production.vars` of `wrangler.jsonc` (for example from `1` to `2`), then rebuild and deploy with `npm run deploy:production` followed by `npm run scan:bundle`.
3. Behaviour after the deploy: new codes are hashed with the new pepper and recorded with the new key version. Old codes are tried against the previous pepper and sign in while their key version is lower than the current one. Both lookups run on every sign-in, so timing does not reveal which case applied.
4. Reissue cards for students as they come up for reissue (`POST /instructor/student-credentials/reissue`). Each reissue moves that student to the new pepper.
5. When no credential remains at the old key version (check with the database before you proceed), remove the `CREDENTIAL_PEPPER_PREVIOUS` secret:

   ```bash
   npx wrangler secret delete CREDENTIAL_PEPPER_PREVIOUS --env production
   ```

   Then deploy again. Codes still on the old version stop working at that point, so confirm first.

Rules: do not bump `CREDENTIAL_KEY_VERSION` without also setting `CREDENTIAL_PEPPER_PREVIOUS`, or old codes stop working. Do not roll back to an older pepper value once new credentials exist. Record each rotation in the change log, with the date and the key version it moved to.

## 6. Data-processing review

These items come from [security-privacy.md](security-privacy.md) sections 8 and 9. Each needs an owner and a decision before production.

| Provider                                                                      | Review items                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare (Workers, Static Assets, Workers AI, Rate Limiting, Observability) | Data processing agreement. Log retention for Workers Logs and observability. Data-location options. Workers AI prompt retention and training terms (the payload is aggregates only). Subprocessors. Network metadata (IP address, user agent) processed to deliver the service. |
| Supabase (Postgres, Auth, email)                                              | Data processing agreement. Region. Backup and point-in-time recovery retention, and how deleted rows propagate into backups. Subprocessors. The email provider used for invitations and recovery.                                                                               |

Retention and deletion decisions to record before launch:

- Individual-level records: how many months after program end they are kept, unless longitudinal follow-up is consented.
- Aggregate reports: kept, with the saved-report deletion path documented.
- Backups: deleted student rows remain in backups until backup expiry. This must appear in the privacy notice.
- Guardian contacts: protected by access control only, not encrypted at the application level (a known gap).

Legal review (not optional before real use with minors): COPPA applicability and school-authorized consent, FERPA obligations under school partnerships, Arizona student-privacy law, notice text and version, verification method, and the retention schedule. Keep `ALLOW_UNDER_13_REGISTRATION=false` until this is done.

## 7. Known gaps to accept or close before launch

From [security-privacy.md](security-privacy.md) section 10, with deployment impact:

- Sessions are stateless. Logout clears the cookie, but a stolen token stays valid until it expires (4 hours for students, 8 hours for staff). Disabling staff or revoking a credential takes effect immediately.
- Cookies do not use the `__Host-` prefix. Serve production from a domain without untrusted sibling subdomains.
- There are no issuance quotas. Instructors can issue up to 60 cards per request, without a limit on requests.
- Under-13 gating relies on the instructor's age-band attestation.
- The MFA single-use check is per isolate (best effort). Supabase's TOTP limits are the backstop.
- An AI narrative whose numbers fail the number guard is shown with a flag and must be acknowledged before it is saved. The template summary is always available.
- Small-cell suppression has no complementary-cell protection. Differencing across filters is possible.
- Pepper rotation needs `CREDENTIAL_PEPPER_PREVIOUS` and a key-version bump (section 5). Retirement of the old pepper is manual.
