# FindItViral

A mobile-first web app where anyone posts a bounty for a hard-to-find viral product, finders report sightings and claim bounties, and the app connects the two parties — without ever touching money.

## Tech Stack

- **Frontend**: React + Vite + TypeScript + TailwindCSS (mobile-first, PWA)
- **Backend**: Supabase (Postgres + Auth + Realtime)
- **Hosting**: Cloudflare Pages (static SPA)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Run `supabase/rls.sql` in the SQL Editor
4. Run `supabase/seed.sql` in the SQL Editor (seeds 5 trends, 97 products, and sample zip codes)
5. Run `supabase/migrations/20260709230205_harden_security.sql`, then `supabase/migrations/20260710000000_private_app_and_early_access.sql`.

The final migration makes the prototype owner-only and creates the public early-access list. Before running it, make sure your owner account already exists in Supabase Auth. Then run this once in the SQL Editor, with your actual sign-in email:

```sql
insert into private.app_owners (user_id)
select id from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

Only that account can access the prototype at any non-root route. The root route is intentionally public and only accepts early-access submissions.

### 4. Run dev server

```bash
npm run dev
```

### 5. Build for production

```bash
npm run build
```

The output goes to `dist/`. Deploy to Cloudflare Pages with:
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Features

- **Bounty board**: Post a bounty with reward amount, ZIP code, radius, and notes
- **Sighting feed**: Report stock spotted in stores (text-only, no photos)
- **Bounty claims**: Finders submit private sightings to bounty posters; poster accepts/rejects; contact info is exchanged only after acceptance
- **Real distance filtering**: ZIP code → lat/long lookup + Haversine formula
- **Reputation system**: Karma points for accepted claims
- **Trend-agnostic**: Add new viral trends without rebuilding
- **5 seeded trends**: NeeDoh (49 products), Mystery Squishy Dumpling (20), Sunny Days Squeezy (13), Taba Squishy (12), Magic Jellykins (3)
- **Demo mode**: Runs without Supabase credentials using in-memory mock data with demo login buttons
- **Hardened Supabase access**: Private contact info is separated from public profiles, claim decisions run through database RPCs, and Data API grants are explicit

## What's NOT included (by design)

- No in-app payments (reward settled off-platform)
- No in-app messaging (contact info shown after accepted claim)
- No photo uploads yet
- No moderation tools (text-only, nothing to moderate)
- US only

## Zip Code Data

The seed includes ~100 major US zip codes. For full coverage, import the complete USPS zip code dataset with lat/long into the `zip_codes` table. A free dataset is available from [simplemaps](https://simplemaps.com/data/us-zips) or the USPS.
