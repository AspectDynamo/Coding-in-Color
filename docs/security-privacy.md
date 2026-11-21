# Security & Privacy Implementation Notes

Owner: lead. Describes what the platform does, what it deliberately does not do, and what still requires organizational or legal review. **Nothing here is a claim of COPPA, FERPA or state-law compliance.**

## 1. Data inventory

| Data                          | Where                                                                                  | Who can see it                                                                         | Purpose                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Student UUID                  | `students.id`                                                                          | Backend only; admins see it in URLs of individual views                                | Join key for longitudinal matching                |
| Public code (`S-XXXXXX`)      | `students.public_code`                                                                 | Instructors (roster), admins                                                           | Human-friendly pseudonymous label                 |
| Age band                      | `students.age_band`                                                                    | Instructors, admins                                                                    | Consent gating, aggregate breakdowns              |
| Seat label                    | `cohort_students.roster_label`                                                         | Instructors, admins                                                                    | Lets instructors reissue lost cards without names |
| Access code (raw)             | **Nowhere at rest.** Shown once at issuance for printing                               | The instructor who issued it, the student                                              | Sign-in                                           |
| Access code HMAC              | `student_credentials.credential_hash`                                                  | Backend only                                                                           | Lookup                                            |
| Assessment responses & scores | `assessment_attempts`, `assessment_responses`, `attempt_skill_scores`                  | Admins (individual), others aggregate                                                  | Learning measurement                              |
| Consent records               | `consent_records`                                                                      | `consent.manage` (owner/admin)                                                         | Under-13 authorization                            |
| Guardian contact              | `guardian_contacts` (separate table)                                                   | **Write-only through the API** (recorded with consent; never returned by any endpoint) | Consent verification                              |
| Staff identity                | Supabase Auth (email, password hash, MFA factors) + `staff_users` (display name, role) | Owners                                                                                 | Staff authentication                              |
| Audit log                     | `audit_log`                                                                            | Owner/admin                                                                            | Accountability (no secrets/codes/contacts)        |
| AI reports                    | `ai_reports`                                                                           | Analyst+                                                                               | Aggregate narratives + exact payload sent         |

Not collected: student names, emails, birthdates, photos, voice/video, IP addresses as identifiers, device or browser fingerprints, advertising identifiers, location.

## 2. Student credentials

- 16 Crockford base32 characters from `crypto.getRandomValues` with rejection sampling → ~80 bits of entropy. Online guessing is infeasible under rate limits.
- Stored as `HMAC-SHA256(CREDENTIAL_PEPPER, normalized)` with `key_version` to allow pepper rotation (re-issue cards after rotation; old versions can be revoked in bulk).
- Unknown, malformed, revoked and withdrawn-student codes produce the identical `401 invalid_code` response, so responses do not reveal whether a code exists.
- QR cards carry the code in the URL fragment (`/s#code=…`), which is never sent in HTTP requests, never appears in server or CDN logs, and is removed from the address bar after use.
- Codes never touch localStorage/sessionStorage; the session is an HttpOnly cookie. Assessment drafts in sessionStorage contain only answer selections keyed by attempt id.
- Raw codes are never logged. Card sheets exist only in browser memory until printed.

## 3. Sessions, CSRF, rate limiting

- Signed (HMAC-SHA256, `SESSION_SECRET`) HttpOnly, SameSite=Lax, Secure cookies. Student 4 h, staff 8 h absolute. Server re-validates the credential/staff status on every request, so revocation and disabling are immediate.
- CSRF: double-submit token (`cic_csrf` cookie ↔ `X-CSRF-Token` header, constant-time compare) plus `Origin` allow-list on all mutations.
- Rate limiting: Cloudflare Workers Rate Limiting bindings for student code redemption, staff login and AI generation, with an in-memory fallback for local dev. The connecting IP is used only as an ephemeral limiter key inside Cloudflare's limiter; the application never stores or logs it.

## 4. Authorization

- Role → permission matrix in `src/shared/constants.ts`. Instructors are restricted to assigned programs; analysts never see individual students.
- The Worker uses the Supabase **service-role key, which bypasses RLS**. Therefore the Worker is the authorization layer for every query. RLS is still enabled on all tables with no anon/authenticated policies and table grants revoked, so the public anon key cannot read data even if misused.
- Answer keys are stored in a separate table read only by the scoring path and by `catalog.manage` staff.

## 5. AI data handling (Workers AI)

- Input = aggregate metrics after small-cell suppression; built by `analytics/ai-payload.ts` and checked by `assertNoIdentifiers` (rejects UUIDs, access-code and public-code patterns, denylisted keys).
- No student IDs, codes, public codes, responses, histories, consent or guardian data are ever sent.
- Output is schema-validated and passed through a number guard; unverified numbers are surfaced to the admin. The exact payload is stored with the report for transparency.
- Workers AI runs inference on Cloudflare's network. Review Cloudflare's current Workers AI terms regarding prompt retention and model training before production use; the platform sends only aggregates either way.

## 6. Small-cell suppression

Default threshold 10 (`SUPPRESSION_THRESHOLD`) for all external outputs (CSV, printable reports, AI payloads, instructor session aggregates) and for every dashboard view served to roles without `students.view_individual` (analysts). Internal admin views show small groups with a warning. Suppression lowers re-identification risk but is not a legal de-identification standard.

## 7. Consent & minors

- Under-13 credential issuance is disabled by default (`ALLOW_UNDER_13_REGISTRATION=false`).
- When enabled, under-13 students start `pending_consent` and cannot take assessments until an admin records consent (status, method, notice version, timestamp). Withdrawal blocks access immediately; deletion is a hard delete with an audit entry.
- **Before enabling for minors in production**, counsel must confirm: whether COPPA applies to Coding in Color's programs (and whether school-authorized consent applies), FERPA obligations under school partnerships (school official exception / data-sharing agreements), Arizona student-privacy law, notice text and verification method, retention schedule.

## 8. Infrastructure providers (to review before production)

| Provider                                                                           | Processes                                                                                                                    | Review items                                                                                                                  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare (Workers, Static Assets, Workers AI, Rate Limiting, Observability logs) | HTTP requests incl. network metadata (IP, user agent) as part of service delivery; Worker logs; AI prompts (aggregates only) | DPA, log retention (Workers Logs/observability), data localization options, AI prompt retention/training terms, subprocessors |
| Supabase (Postgres, Auth)                                                          | All application data; staff emails/passwords; backups                                                                        | DPA, region selection, backup/PITR retention and deletion propagation, subprocessors, Auth email provider                     |

Application-level choices that reduce exposure: no third-party scripts, fonts, analytics, or session replay; observability logs exclude bodies, cookies and codes; structured logs carry request ids only.

## 9. Retention & deletion (policy to be set by Coding in Color)

Supported mechanisms: student withdrawal, hard deletion per student, credential revocation, AI report deletion. Recommended defaults to adopt: delete individual-level records N months after program end unless longitudinal follow-up is consented; keep aggregate reports. Database backups retain deleted rows until backup expiry — document this in the privacy notice.

## 10. Known gaps / future work

- Guardian contacts are protected by access control, not application-level encryption.
- Admin record merges (duplicate student records) are not implemented; reissue preserves the UUID instead.
- No comparison-group/waitlist design yet — causal claims are not supported.
- Supabase-mode integration is validated against migrations on local Postgres and unit tests; run the Playwright suite against a staging Supabase project before launch.
- Session tokens are stateless: logout clears the cookie but a stolen token stays valid until expiry (student 4 h, staff 8 h). Disabling staff, revoking/reissuing a credential or withdrawing a student _does_ take effect immediately. Add a session-version column if server-side logout revocation is needed.
- Cookies do not use the `__Host-` prefix; CSRF relies on double-submit + Origin/Sec-Fetch-Site checks. Serve production from a domain without untrusted sibling subdomains, or add the prefix.
- Instructors attest each student's age band and can issue up to 60 cards per request; there are no issuance quotas yet. Under-13 gating relies on that attestation.
- The MFA single-use check is per isolate (best effort); Supabase's TOTP limits are the backstop.
- An AI narrative whose numbers fail the number guard is still shown, flagged, and must be explicitly acknowledged before saving; the deterministic template is always available.
- Small-cell suppression has no complementary-cell protection; differencing across filters is possible.
- Supabase project settings to apply: disable public sign-ups, enable MFA, require email confirmation.
