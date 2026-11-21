# Troubleshooting

Each entry gives the symptom, the cause, and the fix. Error codes refer to the envelope described in [api.md](api.md#conventions).

## Quick diagnosis

Ask the Worker what it thinks of its own configuration. These routes work without secrets:

```bash
curl -s http://localhost:5173/api/v1/health
```

```bash
curl -s http://localhost:5173/api/v1/config
```

`configured: false` in `/health` means a data route will return `503 not_configured`. `/config` shows the store (`dataStore` is `supabase` or `memory`), whether demo login is enabled, and whether AI is bound (`aiEnabled`). An unconfigured Worker reports `memory` with demo login and AI off, so check `/health` `configured` to tell the cases apart.

## Dev server: port 5173 is already in use

**Symptom.** `npm run dev` exits with a message that port 5173 is in use.

**Cause.** Vite runs with `strictPort: true`, so it refuses to pick another port. An earlier dev server, or a Playwright run that left one behind, still holds the port.

**Fix.** Find the process and stop it:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Stop the process ID shown, then start again:

```bash
npm run dev
```

Do not change the port. The Playwright configuration and this documentation assume `http://localhost:5173`.

## CSRF 403 on every POST

**Symptom.** Any `POST`, `PUT`, `PATCH` or `DELETE` returns `403 csrf_failed` ("Your session check failed"), including the sign-in and student code entry.

**Cause.** The CSRF check needs three things: the `cic_csrf` cookie, an `X-CSRF-Token` header equal to it, and an `Origin` that matches the request. The cookie is created by the first request that does not have one. A script or `curl` that sends a `POST` first has no cookie and fails. A browser that never loaded the app has the same problem.

**Fix.** Make one `GET` to bootstrap the cookie, keep it in a cookie jar, and send the same value in the header. Send `Origin` explicitly, because `curl` sends no `Sec-Fetch-Site` header:

```bash
curl -s -c cookies.txt -b cookies.txt http://localhost:5173/api/v1/config
```

```bash
curl -s -b cookies.txt -c cookies.txt -H "Origin: http://localhost:5173" -H "X-CSRF-Token: $(awk '$6=="cic_csrf"{print $7}' cookies.txt)" -H "Content-Type: application/json" -d '{"role":"admin"}' http://localhost:5173/api/v1/auth/demo-login
```

Also check the origin. `http://127.0.0.1:5173` and `http://localhost:5173` are different origins. Use the one the browser shows in the address bar, and send the same string in `Origin`.

## 503 `not_configured` on data routes

**Symptom.** Every route except `/health` and `/config` returns `503 not_configured` ("This service is not configured yet").

**Cause.** One of these:

- `SESSION_SECRET` or `CREDENTIAL_PEPPER` is missing or shorter than 32 characters. `/health` shows `configured: false`.
- `.dev.vars` does not exist. Run `npm run setup`.
- You edited `.dev.vars` while `npm run dev` was running. Restart the dev server.
- In production (`APP_ENV=production`), the Supabase URL or service role key is not set as a Worker secret. The Worker refuses the in-memory store on purpose and fails closed.

**Fix.** For local development:

```bash
npm run setup
```

Then restart `npm run dev`. Check `/health` again.

For production, list the secret names and add any that are missing:

```bash
npx wrangler secret list --env production
```

Secret values are never shown by this command.

**Subtle case.** In development with `DEMO_MODE=true`, setting `SUPABASE_URL` without `SUPABASE_SERVICE_ROLE_KEY` does not fail. The Worker silently uses the in-memory demo store. Check `/config`: `dataStore` shows which store is active.

## AI is unavailable locally

**Symptom.** Generating an AI summary returns `503 ai_unavailable`. The UI shows a template summary.

**Cause.** Expected. Workers AI has no local simulator. `vite dev` runs with `remoteBindings: false`, so the `AI` binding is absent. `/config` reports `aiEnabled: false`. The backend then produces the deterministic template summary, with `generationMode: "template"` and `details.fallback` in the response.

**Fix.** Nothing is broken, and no fix is needed for development. To test AI output, use a deployed Worker with the `AI` binding. If a deployed Worker still falls back, check these in order:

1. `aiEnabled` is true in `/config` on the deployed Worker.
2. `AI_MODEL` names a model your account can use, and the model supports JSON-schema response format.
3. The Worker logs for `ai.model_error` (the model call failed or timed out at 25 seconds) or `ai.invalid_output` (the response failed schema validation). The logs never contain prompts or output.

## Safari and `Secure` cookies on localhost

**Symptom.** Sign-in appears to succeed, but the next page says you are signed out. Student code entry loops back to the start. The cookie does not appear in the browser's storage inspector.

**Cause.** Session cookies (`cic_student`, `cic_staff`, `cic_mfa`) are `Secure` except when the request is plain HTTP to `localhost`, `127.0.0.1` or `[::1]`. Browsers will not store `Secure` cookies that arrive over plain HTTP. Two things commonly break this:

- Opening the app over HTTP on a LAN address, such as `http://192.168.x.x:5173`. The hostname is not local, so the server marks the cookies `Secure`, and the browser refuses to store them.
- Safari's own cookie rules for `localhost`, which the app does not control.

**Fix.** Open the app at `http://localhost:5173`. Use HTTPS through a tunnel or a proxy if you need another device. If sign-in does not persist in Safari, use Chrome or Firefox for local demos. Clear old `cic_*` cookies for `localhost` after changing hosts, because a stale cookie can look like a valid session.

## psql: socket path, or `psql` not found

**Symptom 1.** The migration or seed script fails with a message about a Unix socket, `No such file or directory`, or a path that is too long.

**Cause.** The scripts connect over TCP when the URL has a host, which the examples do (`127.0.0.1`). The socket message usually comes from a local cluster started in a long temporary directory. macOS limits Unix socket paths to about 103 bytes, so the server cannot create its socket.

**Fix.** Use the TCP URL, for example `postgresql://postgres@127.0.0.1:54322/postgres`. If you start your own cluster, disable the socket directory as in [database.md](database.md#local-validation-how-this-was-verified), or keep the data directory path short.

**Symptom 2.** `psql not found on PATH. Install PostgreSQL client tools.`

**Fix.** On macOS with Homebrew, install the client library and add it to `PATH`:

```bash
brew install libpq
```

```bash
export PATH="$(brew --prefix libpq)/bin:$PATH"
```

Add the export to your shell profile to keep it.

## Re-seed after a pepper change

**Symptom.** Presenter codes (`DEMA-FRSH-PRE0-2026`, `DEMA-RDY2-P0ST-2026`) or other demo codes return `401 invalid_code` against a Supabase database.

**Cause.** Access codes are stored as `HMAC-SHA256(CREDENTIAL_PEPPER, normalized code)`. The seed script hashes the demo codes with the pepper it finds when it runs (the environment, then `.dev.vars`). If the pepper changed after seeding, or the seed ran without a pepper, the stored hashes do not match the Worker's pepper. If the pepper was missing, the seed omits credentials and prints a warning.

The in-memory demo store has no stored hashes. It recomputes them from the current pepper every time the Worker starts. Restarting `npm run dev` is enough there.

**Fix (development Supabase database).** Make sure `CREDENTIAL_PEPPER` is the same value in `.dev.vars`, then reseed. The seed truncates and reloads all application data:

```bash
npm run db:seed
```

Restart `npm run dev` so the Worker uses the same pepper.

**Production.** Do not change `CREDENTIAL_PEPPER` on its own. It invalidates issued access codes, including real students' cards. To rotate safely, set `CREDENTIAL_PEPPER_PREVIOUS` to the old value and bump `CREDENTIAL_KEY_VERSION`, as described in [deployment.md](deployment.md#5-pepper-and-key-rotation).

## Demo login is missing, or `/auth/demo-login` returns 404

**Cause.** Demo login works only on the in-memory store. If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set in `.dev.vars`, the Worker uses Supabase and `/config` shows `demoLoginEnabled: false`.

**Fix.** Remove the Supabase values from `.dev.vars` and restart `npm run dev`. To test real staff sign-in, use a Supabase project and a real staff account instead.

## Playwright: `Demo login as ... failed`

**Cause.** The end-to-end suite signs in with demo staff. It fails if the dev server uses Supabase, or if the staff login limiter returns `429`.

**Fix.** Remove the Supabase values from `.dev.vars`, restart `npm run dev` (or stop it so Playwright starts a fresh one), and wait a minute if the message mentions `429`. The limit is 10 staff logins per minute.

## `429 rate_limited` on sign-in

**Cause.** `POST /auth/login`, `/auth/mfa/verify`, `/auth/demo-login` and `/auth/password-reset` share a limit of 10 requests per minute per IP, and a separate limit per email or staff member. Repeated tests can exhaust it. The fallback limiter in development counts per process, not per browser.

**Fix.** Wait 60 seconds (the response sends `Retry-After: 60`). Do not work around the limit by changing IPs.

## Staff sign-in returns `503 not_configured`

**Cause.** `/auth/login` needs both `SUPABASE_URL` and `SUPABASE_ANON_KEY`. In the demo, they are not set.

**Fix.** Use demo login locally. For Supabase, set both values in `.dev.vars` and restart `npm run dev`.

## Staff sign-in asks to set up an authenticator

**Cause.** In production, owners and admins must have a verified TOTP factor (`REQUIRE_ADMIN_MFA` defaults to true). An account without one gets `mfa_enroll_required` from `POST /auth/login`, and the sign-in screen starts QR enrollment through `POST /auth/mfa/enroll`. This is expected for a new owner or admin.

**Fix.** Scan the QR code (or enter the secret) in an authenticator app, then enter the six-digit code. A `403 forbidden` on enrollment means the account already has a verified factor, so sign in with the code instead. Enrollment is allowed only on sign-ins that found no verified factor. See [api.md](api.md#staff-authentication).

## Dashboard shows values as "suppressed" or hides session aggregates

**Cause.** Expected. Any group with fewer than `SUPPRESSION_THRESHOLD` (default 10) is suppressed in external outputs, including session aggregates in `/instructor/assessment-sessions/:id/progress`. The admin dashboard flags small groups but shows the values.

**Fix.** None needed. For the demo, submit more attempts or check the admin dashboard, which shows the values.

## `Migration ... was modified after being applied`

**Cause.** `npm run db:migrate` stores a SHA-256 checksum of each applied file. An edited file no longer matches its checksum, and the runner refuses to continue.

**Fix.** Do not edit applied migrations. Add a new file with the next number (for example `0004_fix_something.sql`) that makes the change.

## `seed.sql refused: non-synthetic students or staff exist`

**Cause.** The generated seed refuses to truncate a database that contains real rows (`is_synthetic = false`). This is a safety check, not a bug.

**Fix.** Do not force it. Seed only a development or demo database. If the database is production, do not seed it.

## Students get `consent_required` or `403` on assessments

**Cause.** The student is `pending_consent`. This can happen only when `ALLOW_UNDER_13_REGISTRATION=true` and the student is under 13. Assessments stay closed until an admin records consent.

**Fix.** An owner or admin records consent at `POST /admin/consent` (or the consent page). Do not bypass the check.

## Instructor sees `403 forbidden` on a cohort or session

**Cause.** Instructors see only programs listed in their `staff_program_assignments`. The same is true of any program-scoped route.

**Fix.** An owner updates the instructor's program list with `PATCH /admin/staff/:id` (`programIds`). Only owners have `staff.manage`.
