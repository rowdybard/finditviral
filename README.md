# FindItViral

FindItViral is currently a public early-access landing page with an owner-only product prototype behind it. Visitors can submit an email address and explain what they are trying to find; the private bounty and sighting application remains unavailable to non-owners.

## Stack

- React 18, Vite, TypeScript, and Tailwind CSS
- Supabase Postgres and Auth
- Cloudflare Pages

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
```

The publishable/anon key is intentionally used in the browser. Never put a Supabase secret or `service_role` key in a `VITE_` variable.

Run the app:

```bash
npm run dev
```

## Public waitlist database

The canonical migration directory contains only the public-launch database. The preferred production workflow is:

```bash
npx supabase login
npx supabase link --project-ref hsrfyiazliydrpgtwwul
npx supabase db push --dry-run
npx supabase db push
```

The CLI prompts for database credentials when needed; do not put the database password in source control or a command committed to shell history. The migration creates the protected `early_access_requests` table and a public `request_early_access` RPC. Anonymous visitors can execute the validated RPC, but they cannot read, update, delete, or insert directly into the table. New and duplicate submissions return the same response.

If the SQL Editor must be used instead, run `supabase/migrations/20260711000000_launch_waitlist.sql`, then run `supabase/verify/production_catalog.sql`. Record the manual change in migration history with `npx supabase migration repair 20260711000000 --status applied` after linking the project.

Waitlist submissions can be reviewed in the Supabase Table Editor. They are marked to expire after 24 months; the indexed RPC cleanup removes expired rows when new requests arrive. The app captures submissions only - it does not send confirmation or campaign emails yet.

The public migration is exercised from an empty database by pgTAP in CI. With Docker installed, run the same checks locally:

```bash
npx supabase start
npx supabase db reset
npx supabase db lint --local --schema public --level warning --fail-on error
npx supabase test db
```

## Optional private prototype database

The private prototype is separate from the public launch. For a fresh project:

1. Create your owner account in Supabase Auth first.
2. Run `supabase/schema.sql`.
3. Run `supabase/seed.sql` if demo catalog data is wanted.
4. Run `supabase/rls.sql` once.
5. Run `supabase/legacy-migrations/20260710000000_private_app_and_early_access.sql`.
6. Run `supabase/migrations/20260711000000_launch_waitlist.sql` last.
7. Add your owner user to the allow-list:

```sql
insert into private.app_owners (user_id)
select id from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

Then disable new-user signups in Supabase Auth settings. Do not run `supabase/rls.sql` again after the owner-only migration; the file refuses to run after lockdown. The `supabase/legacy-migrations/20260709230205_harden_security.sql` migration is only for databases created from the original legacy schema. Files under `legacy-migrations` are deliberately excluded from `supabase db push`.

The private app is available at `/home` after owner sign-in.

## Verification

```bash
npm run lint
npm test
npm run build
npm run smoke:web
```

Production builds fail when either required Supabase environment variable is missing. The public submission client also fails closed rather than falling back to in-memory demo data.

After the production database and owner Auth setup are complete, run `npm run smoke`. It adds database, table-permission, Auth-signup, and owner-RPC checks without writing a test applicant row. A controlled form submission remains the final manual acceptance test.

## Cloudflare Pages

The repository includes `wrangler.jsonc`; the production settings are:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22
- Production variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Deploy manually when needed:

```bash
npm run deploy
```

Hashed assets receive immutable caching. Security headers, a real 404 page, `robots.txt`, and `sitemap.xml` are shipped from `public/`. Branch previews are disabled until an isolated preview Supabase project exists, preventing preview builds from failing or writing to production data.

## Prototype features

- Product bounty board and local sighting feed
- Private bounty claims with controlled contact exchange
- ZIP-code distance filtering
- Owner-only access enforced by Supabase RLS and an allow-list
- No in-app payments or messaging
