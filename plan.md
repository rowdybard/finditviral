# FindItViral Public Launch Plan

Last updated: 2026-07-12

## Goal

Launch `https://finditviral.com` as a trustworthy public early-access page that:

- explains FindItViral in two to three short paragraphs;
- captures an email address and reason for interest reliably;
- keeps the product prototype accessible only to the owner;
- fails safely, protects applicant data, and can be operated after launch.

The private prototype is not part of the public launch. Public visitors should only see the landing page and privacy notice.

## Current launch decision

**Hold public promotion until the Supabase launch gate is complete.**

The landing page is deployed and the application-level launch hardening is in place. The remaining release-critical work is to apply and verify the production waitlist schema, prove a real submission is persisted, confirm the owner account, and disable public Auth signups. Bot protection and a public contact address then remain before announcing broadly. The `www` redirect, CSP/metadata update, and production smoke suite are implemented locally and awaiting deployment verification.

## Status

- `[x]` complete and verified in the repository or production
- `[~]` in progress or implemented but awaiting production verification
- `[ ]` not complete

## 1. Public application foundation

- [x] Public landing page is the root route.
- [x] Landing copy explains the product in the requested brief format.
- [x] Early-access form collects email and a 10-1,200 character reason.
- [x] Public privacy notice explains collection, use, processors, and 24-month retention.
- [x] Private application code is lazy-loaded separately from the public page.
- [x] Private routes are guarded by Supabase authentication and the owner allow-list.
- [x] Client-side public signup support was removed.
- [x] Missing Supabase configuration fails closed instead of reporting fake success.
- [x] Submission failures and timeouts return the form to a usable state.
- [x] Form success and error states are announced accessibly.

Evidence:

- `src/pages/EarlyAccess.tsx`
- `src/pages/Privacy.tsx`
- `src/lib/earlyAccess.ts`
- `src/PrivateApp.tsx`
- `src/components/OwnerGate.tsx`

## 2. Supabase production launch gate

- [x] The deployed bundle points to Supabase project `hsrfyiazliydrpgtwwul` with a browser-safe publishable key.
- [ ] The 2026-07-12 production probe currently returns `PGRST205` for the waitlist table and `PGRST202` for the RPC; the launch migration has not been applied yet.
- [ ] Authenticate database administration locally with `npx supabase login`, or open the production project in the Supabase SQL Editor.
- [ ] Apply `supabase/migrations/20260711000000_launch_waitlist.sql` to project `hsrfyiazliydrpgtwwul`.
- [ ] Verify `public.early_access_requests` exists with RLS enabled.
- [ ] Verify `anon` and `authenticated` cannot select, update, delete, or insert directly into the table.
- [ ] Verify only the `request_early_access(text, text)` RPC is executable publicly.
- [ ] Submit one launch-test request through the production UI.
- [ ] Confirm the normalized email and reason appear in Supabase Table Editor.
- [ ] Confirm submitting the same email again gives the same public response and creates no duplicate row.
- [ ] Delete the launch-test row after verification.
- [ ] Confirm the owner Auth user exists and can enter `/home`.
- [ ] Add the owner user to `private.app_owners` if the private schema is installed.
- [ ] Disable new-user signups in Supabase Auth after the owner account is confirmed. The 2026-07-12 production settings probe reports `disable_signup: false`.

The canonical `supabase/migrations` directory contains only the public-launch migration and is safe to apply as a chain with `supabase db push`. Prototype upgrade scripts live under `supabase/legacy-migrations` and are excluded from automated migration runs. After deployment, run `supabase/verify/production_catalog.sql` for read-only catalog assertions.

### Database acceptance checks

Run in the Supabase SQL Editor after the migration:

```sql
select relrowsecurity
from pg_class
where oid = 'public.early_access_requests'::regclass;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'early_access_requests'
  and grantee in ('anon', 'authenticated');

select has_function_privilege(
  'anon',
  'public.request_early_access(text, text)',
  'execute'
) as anon_can_request;
```

Expected results:

- `relrowsecurity` is `true`;
- the table privilege query returns no rows;
- `anon_can_request` is `true`.

## 3. Abuse prevention and data operations

- [ ] Put Cloudflare Turnstile in front of the public form and validate it server-side.
- [ ] Route submissions through a server endpoint with basic per-IP rate limiting.
- [ ] Revoke direct anonymous RPC execution after the server endpoint is live, so Turnstile cannot be bypassed by calling Supabase directly.
- [ ] Keep duplicate and new-email responses indistinguishable.
- [x] Normalize email addresses and enforce a case-insensitive unique index.
- [x] Validate email and reason again in Postgres.
- [x] Retain requests for 24 months and remove expired rows opportunistically.
- [x] Index the retention sweep and reject null/invalid input uniformly.
- [ ] Document the weekly review/export process for new requests.
- [ ] Add a non-PII submission-failure signal or alert.

No confirmation or marketing email is sent in version one. "Email capture works" means the request is stored in Supabase and can be reviewed there.

## 4. Domain, security, SEO, and privacy

- [x] Apex domain redirects to HTTPS.
- [x] `finditviral.pages.dev` redirects to the apex domain.
- [x] Hashed assets use immutable caching.
- [x] Missing assets and unknown routes return real 404 responses.
- [x] CSP, HSTS, referrer policy, permissions policy, frame protection, and MIME sniffing protection are deployed.
- [x] Canonical, Open Graph, and Twitter metadata are present.
- [x] `robots.txt`, `sitemap.xml`, web manifest, and PNG icons are present.
- [~] Add `www.finditviral.com` and redirect it to `https://finditviral.com`; the worker redirect is implemented locally and domain association is pending.
- [ ] Add a public contact email to the privacy notice.
- [~] Deploy and verify the nonce-based CSP for Cloudflare Web Analytics and JavaScript Detection.
- [x] Disable Cloudflare branch previews until an isolated preview Supabase project exists.
- [~] Deploy and verify distinct Privacy metadata plus `noindex` on private routes.

Evidence:

- `public/_worker.js`
- `public/_headers`
- `public/404.html`
- `public/robots.txt`
- `public/sitemap.xml`
- `index.html`

## 5. Quality and release verification

- [x] TypeScript check is available through `npm run lint`.
- [x] Unit tests cover successful submission, missing configuration, backend errors, and network failures.
- [x] Production builds reject missing Supabase environment variables.
- [x] GitHub CI runs install, lint, tests, and build on pushes to `main` and pull requests.
- [~] CI now resets, lints, and pgTAP-tests the public database migration twice; the new job awaits its first remote run.
- [x] Deployment configuration, Node version, and deploy command are versioned in the repository.
- [x] Public and private bundles are split so the landing page does not ship the whole prototype.
- [x] The 2026-07-12 local gate passed from a clean install: `npm ci` followed by `npm run check`.
- [x] The 2026-07-12 production dependency audit reports zero known vulnerabilities: `npm audit --omit=dev`.
- [ ] Perform final desktop and narrow-mobile checks in the chosen browser.
- [ ] Verify keyboard-only form completion, visible focus, zoom/reflow, and reduced-motion behavior.
- [ ] Verify production routes, response MIME types, caching, redirects, and security headers.
- [x] A repeatable `npm run smoke:web` / `npm run smoke` production verifier is versioned in the repository.
- [ ] Complete the real production submission test described in section 2.

## 6. Launch runbook

1. Apply and verify the Supabase launch migration.
2. Confirm owner access, then disable public Supabase Auth signup.
3. Add and validate Turnstile plus server-side rate limiting.
4. Add the public contact email and `www` redirect.
5. Run `npm ci`, `npm run check`, and `npm audit --omit=dev`.
6. Deploy with `npm run deploy`.
7. Run production route/header checks and the real waitlist submission test.
8. Delete the test submission.
9. Record the deployment URL and launch timestamp.
10. Begin public promotion only after every release gate below is checked.

## Release gates

- [ ] A production submission is visibly successful and exists exactly once in Supabase.
- [ ] The waitlist table is unreadable and unwritable directly by anonymous users.
- [ ] Owner login works and public Auth signup is disabled.
- [ ] Turnstile and server-side rate limiting are active and cannot be bypassed through the public RPC.
- [ ] A public privacy contact address is published.
- [ ] Apex, Pages, and `www` domain behavior is correct.
- [ ] CI/local checks, dependency audit, browser accessibility checks, and production smoke tests pass on the release build.

## Rollback and incident response

- Keep the previous successful Cloudflare Pages deployment available for immediate rollback.
- If form persistence fails, stop promotion and replace the form with a clear temporary-unavailable state; never show success without storage confirmation.
- If spam begins, disable RPC execution for `anon` until the protected server endpoint is restored.
- If applicant data is exposed, revoke affected keys, disable the endpoint, preserve logs, identify impacted rows, and follow the privacy-notice commitments.
- Never place a Supabase secret or `service_role` key in a `VITE_` variable, source control, browser bundle, or client log.

## Definition of done

The public launch is ready only when all release gates are checked using production evidence. A successful build or a visually correct landing page alone is not sufficient; email persistence, database permissions, owner-only access, abuse controls, and production behavior must all be verified.
