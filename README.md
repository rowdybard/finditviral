# FindItViral

FindItViral is an open beta for Greater Lansing shoppers to find and report viral, limited, and hard-to-find retail products. Members can post bounties, report sightings, and browse a verified store directory. The public landing page accepts early-access waitlist submissions.

## Stack

- React 18, Vite, TypeScript, and Tailwind CSS
- Supabase Postgres and Auth
- Cloudflare Pages (frontend) + Cloudflare Worker (interest digest)

## Local setup

Install dependencies and create a local environment file:

```bash
npm install
copy .env.example .env
```

Set the public Supabase project values in `.env`:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
VITE_TURNSTILE_SITE_KEY=your-cloudflare-turnstile-site-key
```

The publishable/anon key is intentionally used in the browser. Never put a Supabase secret or `service_role` key in a `VITE_` variable.

Run the app:

```bash
npm run dev
```

## Database

The canonical migration directory is `supabase/migrations/`. Migrations are applied in timestamp order. The preferred production workflow is:

```bash
npx supabase login
npx supabase link --project-ref hsrfyiazliydrpgtwwul
npx supabase db push --dry-run
npx supabase db push
```

The CLI prompts for database credentials when needed; do not put the database password in source control or a command committed to shell history.

The migrations create the protected `early_access_requests` table and a service-role-only `request_early_access` RPC. Anonymous visitors submit through `/api/early-access`; the Cloudflare Worker verifies Turnstile, enforces KV-backed rate limits, and calls Supabase with a server-side secret. Browsers cannot read or write the waitlist table or invoke its RPC directly. New and duplicate submissions return the same response.

If the SQL Editor must be used instead, run the migration files in `supabase/migrations/` in timestamp order, then run `supabase/verify/production_catalog.sql`. Record manual changes in migration history with `npx supabase migration repair <timestamp> --status applied` after linking the project.

Waitlist submissions can be reviewed in the Supabase Table Editor. They are marked to expire after 24 months; the indexed RPC cleanup removes expired rows when new requests arrive. The app captures submissions only - it does not send confirmation or campaign emails yet.

The database is exercised from an empty database by pgTAP in CI. With Docker installed, run the same checks locally:

```bash
npx supabase start
npx supabase db reset
npx supabase db lint --local --schema public --level warning --fail-on error
npx supabase test db
```

## Interest digest Worker

The `workers/interest-digest/` directory contains a Cloudflare Worker that sends a daily digest email of new member interest submissions to the owner.

### Secrets

Set `DIGEST_TO_EMAIL` and `SUPABASE_SECRET_KEY` as Worker secrets (not vars):

```bash
cd workers/interest-digest
npx wrangler secret put DIGEST_TO_EMAIL
npx wrangler secret put SUPABASE_SECRET_KEY
```

`SUPABASE_URL`, `DIGEST_FROM_EMAIL`, and `DIGEST_FROM_NAME` are non-secret vars already in `wrangler.jsonc`.

### Deploy

```bash
cd workers/interest-digest
npx wrangler deploy
```

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs three jobs:

1. **verify** — `npm run lint`, `npm test`, `npm run build`
2. **database** — `supabase start`, `supabase db reset`, `supabase db lint`, `supabase test db`
3. **worker** — `npm run check:worker`, `npm run test:worker`

Run all checks locally:

```bash
npm run check:all
```

## Verification

```bash
npm run lint
npm test
npm run build
npm run check:worker
npm run test:worker
npm run smoke:web
```

Production builds fail when either required Supabase environment variable is missing. The public submission client also fails closed rather than falling back to in-memory demo data.

After the production database and owner Auth setup are complete, run `npm run smoke`. It adds database, table-permission, Auth-signup, and owner-RPC checks without writing a test applicant row. A controlled form submission remains the final manual acceptance test.

## Cloudflare Pages

The repository includes `wrangler.jsonc`; the production settings are:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22
- Production variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`

Deploy manually when needed:

```bash
npm run deploy
```

Hashed assets receive immutable caching. Security headers, a real 404 page, `robots.txt`, and `sitemap.xml` are shipped from `public/`. Branch previews are disabled until an isolated preview Supabase project exists, preventing preview builds from failing or writing to production data.

## Features

- Product bounty board and local sighting feed
- Private bounty claims with controlled contact exchange
- ZIP-code distance filtering
- Member onboarding with username selection
- Admin console for contribution moderation and catalog management
- Interest digest email for owner
- No in-app payments or messaging
