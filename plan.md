# FindItViral Greater Lansing Beta Plan

Last updated: 2026-07-13

## Goal

Run `https://finditviral.com` as an open Greater Lansing beta where:

- visitors can understand the product, create an account, or request beta updates;
- permanent authenticated members can complete local onboarding, browse the catalog, post bounties, and report sightings;
- anonymous visitors cannot read application records or private member data;
- ZIP preferences, contact information, waitlist submissions, and ownership-sensitive actions remain protected.

## Current launch decision

The public beta is live. Public email/password signup is enabled, the owner-only frontend gates have been removed, and the production database now uses authenticated-user RLS instead of the former owner-only policy.

The beta is suitable for controlled Greater Lansing use. Before a broad promotional push, configure custom SMTP and email confirmation, add CAPTCHA protection to Supabase Auth signup, and complete a final hands-on mobile and accessibility pass.

## Completed and verified

- [x] Apex and `www` use HTTPS and resolve to the canonical production site.
- [x] The landing page explains FindItViral and links directly to account creation.
- [x] The protected beta-update form still collects email and reason for interest through Turnstile, rate limiting, and the Worker-only write path.
- [x] Public email/password signup is enabled; anonymous Auth identities remain disabled.
- [x] Signed-in non-owner accounts retain sessions and can access member routes.
- [x] New Auth users receive a non-promotional placeholder profile.
- [x] Onboarding requires a supported Greater Lansing ZIP, at least one configured city, and a unique username.
- [x] ZIP storage is private and onboarding can succeed only once per account.
- [x] Authenticated members can read the catalog and community listings.
- [x] Bounties and public sightings derive `user_id` from the caller; ownership spoofing is blocked.
- [x] Private sightings and bounty claims are visible only to their participants.
- [x] Contact information is visible only to its owner or the opposite party after an accepted claim.
- [x] Public profile reads expose only member-card fields; private preferences use a caller-only RPC.
- [x] Anonymous roles cannot read application tables or invoke account RPCs.
- [x] Early-access records remain unreadable and unwritable directly by anonymous or authenticated clients.
- [x] Public, privacy, and signed-in routes have accurate metadata and robots directives.
- [x] The privacy notice covers account, location, contact, listing, waitlist, hosting, Turnstile, and GA4 data.
- [x] TypeScript, 57 unit tests, production build, and the complete production smoke suite pass.
- [x] A disposable production account verified signup, provisioning, ZIP enforcement, onboarding, relogin, bounty creation, sighting creation, and spoof rejection; all QA data was deleted afterward.

## Remaining promotion hardening

- [ ] Configure a production SMTP provider in Supabase.
- [ ] Enable email confirmation after SMTP delivery is proven with a real inbox.
- [ ] Configure Supabase Auth CAPTCHA with the existing Turnstile widget or a dedicated Auth widget.
- [ ] Enable leaked-password protection if the Supabase plan supports it.
- [ ] Confirm password-reset delivery after SMTP is configured.
- [ ] Complete desktop and narrow-mobile browser checks, keyboard navigation, zoom/reflow, and reduced-motion checks.
- [ ] Add operational alerting for repeated Auth, onboarding, and early-access failures.

## Release verification

Run before and after each production deployment:

```text
npm run check
npm run deploy
npm run smoke
```

For database changes, apply only new forward migrations, verify anonymous and cross-user denial cases, and run Supabase security and performance advisors afterward.

## Rollback and incident response

- Keep the previous successful Cloudflare Pages deployment available for rollback.
- Disable Auth signup if automated account abuse begins before Auth CAPTCHA is configured.
- Disable the early-access endpoint if Turnstile or persistence fails; never report success without storage confirmation.
- Revoke affected credentials immediately if a secret is exposed.
- Never place a Supabase secret or `service_role` key in a `VITE_` variable, source control, browser bundle, or client log.
