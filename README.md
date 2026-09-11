# Channel Review App

A minimal React + TypeScript channel-review UI backed by PostgreSQL.

## Included

- Left navigation rail for the future 3 pages.
- Channel-selection page with search, filters, status tabs, validation/invalidation, and image lightbox.
- Only channels with calculated averages are shown.
- YouTube links are generated from the channel handle; channel IDs remain the backend identifier.
- Secure login with an HttpOnly session cookie.
- Protected channel API endpoints.

## Authentication

The browser never receives the PostgreSQL credentials. The app uses a separate review-account username/password configured server-side in `.env`, then stores only a random session ID in an HttpOnly cookie. Sessions expire after 7 days and are held server-side in memory.

For production, use HTTPS. The cookie is automatically marked `Secure` when `Set NODE_ENV=production in the production process environment (not the .env file used by Vite dev).`.

## Setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL`, `APP_USERNAME`, and `APP_PASSWORD`.
4. Make sure the existing `schema.sql` has already been applied to the database.
5. Install dependencies:

   `npm install`

6. Start development:

   `npm run dev`

Frontend: http://localhost:5173
API: http://localhost:3001

## Production / external access

Do not expose PostgreSQL to the public Internet. Keep PostgreSQL listening locally and put Nginx (or another HTTPS reverse proxy) in front of the Node API/frontend.

The Express API supports cross-origin credentials and listens on all interfaces when deployed behind the proxy. Set `CORS_ORIGIN` to the exact HTTPS origin of the website.

A typical deployment is:

`Internet -> Nginx :443 -> Vite/static frontend + Express :3001 -> PostgreSQL :5432`

## Important DB detail

The API intentionally filters to:

`avg_views IS NOT NULL AND avg_engagement_rate IS NOT NULL`

so uncalculated channels never appear in the review UI.

## Engagement rate

The frontend currently treats `avg_engagement_rate` as a ratio:
- `0.034` => `3.4%`

If your database stores `3.4` for 3.4%, change `formatEngagement()` and the minimum-engagement query accordingly.
