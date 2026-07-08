# FindItViral

A mobile-first web app where anyone posts a bounty for a hard-to-find viral product (Squishees today, next trend tomorrow), finders report sightings and claim bounties, and the app connects the two parties — without ever touching money or hosting user-generated photos.

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
4. Run `supabase/seed.sql` in the SQL Editor (seeds Squishees trend + products + sample zip codes)

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
- **Bounty claims**: Finders submit private sightings to bounty posters; poster accepts/rejects; contact info exchanged
- **Real distance filtering**: ZIP code → lat/long lookup + Haversine formula
- **Reputation system**: Karma points for accepted claims
- **Trend-agnostic**: Add new viral trends without rebuilding

## What's NOT included (by design)

- No in-app payments (reward settled off-platform)
- No in-app messaging (contact info shown after accepted claim)
- No photo uploads (future pro feature)
- No moderation tools (text-only, nothing to moderate)
- US only

## Zip Code Data

The seed includes ~100 major US zip codes. For full coverage, import the complete USPS zip code dataset with lat/long into the `zip_codes` table. A free dataset is available from [simplemaps](https://simplemaps.com/data/us-zips) or the USPS.
