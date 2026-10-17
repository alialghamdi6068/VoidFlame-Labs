# VoidFlame Labs API

This directory contains the initial Cloudflare Workers API scaffold. It is not production-ready until deployment bindings, OAuth secrets, migrations, rate limiting, and end-to-end tests are configured.

## Architecture

- GitHub Pages serves the public static frontend.
- `data/projects.json` remains the canonical public catalogue for published projects.
- Cloudflare Workers provides authenticated APIs.
- Cloudflare D1 stores accounts, sessions, drafts, comments, favorites, follows, reports, and analytics.
- Cloudflare R2 is reserved for project/version files; uploads must be implemented with strict size/type limits before enabling public uploads.
- Public project catalogue changes still require maintainer review and a GitHub commit. Never auto-merge untrusted submissions into `data/projects.json`.

## Required configuration

1. Create a Cloudflare D1 database and an R2 bucket.
2. Replace the D1 `database_id` in `wrangler.toml` with the actual database ID.
3. Set `SITE_URL` to the deployed GitHub Pages URL or custom domain.
4. Create a GitHub OAuth App. Set its callback URL to `https://YOUR_API_HOST/api/auth/callback` after choosing the Worker API hostname; the current initial scaffold expects the callback on the same origin as `SITE_URL`, so configure a same-origin Worker route or update the callback implementation before use.
5. Configure secrets with Wrangler:
   - `wrangler secret put GITHUB_CLIENT_SECRET`
   - `wrangler secret put SESSION_SECRET` (use a long random secret)
6. Apply `schema.sql` to D1 using Wrangler's D1 execute command.
7. Deploy the Worker and configure a same-origin route or update frontend API base URL/CORS and OAuth callback handling.
8. Do not use this API in production until OAuth cookie handling, CSRF protection, rate limiting, moderation authorization, file upload validation, and integration tests are reviewed.

## API routes in the current scaffold

- `GET /api/auth/github`, `GET /api/auth/callback`, `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/projects`, `GET /api/projects/:slug`
- `GET /api/projects/:slug/versions`
- `POST /api/projects/:slug/favorite`, `POST /api/projects/:slug/follow`
- `POST /api/projects/:slug/comments`, `POST /api/projects/:slug/report`
- `GET/POST /api/developer/projects`
- `GET /api/admin/reports`

This is an early scaffold, not a claim that every feature is complete or production-secure. The public website must continue to work without this API until deployment and integration are verified.
