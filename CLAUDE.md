# CLAUDE.md — Coding in Color Impact

Impact-measurement platform for **Coding in Color** (Arizona nonprofit; workshops, hackathons, camps, K-12 courses, AI Academy). Students take short pseudonymous assessments; instructors run sessions and print access cards; admins see matched pre/post learning gains and generate honest AI summaries from aggregates.

Read `docs/architecture.md` before changing anything. `src/shared/` is the contract.

## Stack

React 19 + TypeScript + Vite + Tailwind (Bauhaus-inspired editorial design system — see `docs/design-brief-bauhaus.md`) + Recharts + Lucide · Hono on one Cloudflare Worker (Workers Static Assets serves the SPA; `/api/*` runs the Worker first) · Supabase Postgres (supabase-js, service role, server-side only) + Supabase Auth for staff · Workers AI · Vitest + Playwright · Wrangler.

## Layout

- `src/frontend/` — SPA (owner: frontend-fable)
- `src/backend/` — Worker: `routes/ middleware/ services/ repositories/ analytics/ scoring/ demo/ utils/`
- `src/shared/` — types, zod validation, API DTOs, DB row types, constants (owner: lead)
- `supabase/migrations/`, `supabase/seed.sql` — schema + synthetic seed
- `tests/unit|integration|e2e/`, `docs/`

## Commands

`npm run setup` (creates `.dev.vars` with random dev secrets) · `npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm run test` · `npm run test:e2e` · `npm run db:migrate` · `npm run db:seed` · `npm run deploy`

Fast iteration: `npm run test:frontend` / `npm run test:backend` / `npm run test:e2e:fast` (desktop only). Visual QA: `npm run shots -- --routes admin-*,landing --viewports 1440,390` (parallel, ~16 s for all 84 captures; `--list` shows routes; output in `screenshots/`, which Playwright never wipes; fails on blank pages, console errors or horizontal overflow). Run the full suites once at the end.

With no Supabase env vars and `DEMO_MODE=true`, the app runs on an in-memory synthetic dataset — zero setup demo.

## Agent delegation (mandatory)

| Work                                                                        | Agent               | Model             |
| --------------------------------------------------------------------------- | ------------------- | ----------------- |
| Orchestration, architecture, contracts, security decisions, final QA        | main session        | claude-opus-5-5   |
| **All** frontend code (`src/frontend`, `tests/e2e`, `index.html`, `public`) | `frontend-fable`    | claude-fable-5-2  |
| Backend routes/services/stores, scoring, analytics                          | `backend-sonnet`    | claude-sonnet-5-5 |
| Schema, migrations, SQL functions, seed generator                           | `database-sonnet`   | claude-sonnet-5-5 |
| Security & privacy review (findings only)                                   | `security-reviewer` | claude-sonnet-5-5 |
| Running tests/lint/typecheck, fixtures                                      | `qa-haiku`          | claude-haiku-5-5  |
| README and docs                                                             | `docs-haiku`        | claude-haiku-5-5  |

Rules: only Fable changes frontend code (others report bugs to it). One owner per file at a time. Never silently substitute a model. Contract changes go through the lead.

## Hard rules

- No student names, emails, birthdates, IPs-as-identity, device/browser fingerprints, ad IDs, trackers, session replay, third-party font/script CDNs.
- Student UUIDs are pseudonymous, not anonymous. Never print or expose them to students; never send to AI.
- Access codes: CSPRNG, stored only as HMAC + key version, never logged, never in localStorage, QR uses URL fragment. Identical error for unknown/revoked codes. Rate limited.
- Sessions in signed HttpOnly cookies; CSRF double-submit + Origin check on all mutations.
- Answer keys never reach students; scoring only on the server; validate ownership, versions, question ids, response kinds.
- Every endpoint validates input (zod) and checks role + program scope. Service role bypasses RLS — the Worker is the authorization layer.
- Improvement metrics only from matched pre/post pairs within the same cohort and form family. Always show n, completion rate, period, limitations. Percentage points ≠ percent. Confidence is self-reported and shown separately.
- External outputs (CSV, print, AI, instructor aggregates) suppress groups with n < `SUPPRESSION_THRESHOLD` (default 10).
- AI receives aggregate metrics only, output is schema-validated and number-guarded, never states causation; dashboards work without AI.
- Never claim COPPA/FERPA compliance. Under-13 registration is off by default and gated by consent.
- No inert UI controls. WCAG 2.2 AA. Don't report a test as passing unless it ran.
