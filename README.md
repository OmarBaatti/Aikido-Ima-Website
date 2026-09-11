# Channel Review App

A minimal React + TypeScript channel-review UI backed by PostgreSQL.

## What is included

- Left navigation rail for the future 3 pages.
- Channel-selection page with:
  - search
  - subscriber min/max
  - average views minimum
  - engagement-rate minimum
  - filter enable/disable
  - To handle / Validated / Invalidated tabs
  - channel banner + profile image
  - YouTube channel link from the handle
  - subscribers, average views, engagement rate, videos in last 30 days
  - validate action
  - invalidation reason selector
  - invalidation reason shown in the Invalidated tab
  - image lightbox
- API keeps PostgreSQL credentials server-side.

## Setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put the PostgreSQL connection string in `DATABASE_URL`.
4. Make sure the schema in `schema.sql` has already been applied to the database.
5. Install dependencies:

   `npm install`

6. Start both frontend and backend:

   `npm run dev`

Frontend: http://localhost:5173  
API: http://localhost:3001

## Important DB detail

The API intentionally filters to:

`avg_views IS NOT NULL AND avg_engagement_rate IS NOT NULL`

so uncalculated channels never appear in the review UI.

## Engagement rate

The frontend currently treats `avg_engagement_rate` as a ratio:
- `0.034` => `3.4%`

If your database stores `3.4` for 3.4%, change `formatEngagement()` and the minimum-engagement query accordingly.

## Production note

Do not put `DATABASE_URL` in a Vite `VITE_*` variable. Browser code must never receive database credentials. The Express API is the only component that connects to PostgreSQL.
