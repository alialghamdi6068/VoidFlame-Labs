# VoidFlame Labs API

Cloudflare Workers + D1 + R2 backend for the VoidFlame Labs static frontend.

## Deployment checklist

1. Create a Cloudflare D1 database named `voidflame-labs` and an R2 bucket named `voidflame-labs-files`.
2. Replace `database_id` in `wrangler.toml` with the real D1 database ID.
3. Set `SITE_URL` to the deployed site origin. Set `API_URL` to the deployed Worker origin.
4. Create a GitHub OAuth App with callback `https://YOUR_WORKER_HOST/api/auth/callback`; set `GITHUB_CLIENT_ID` as a Worker variable and secrets with:
   - `npx wrangler secret put GITHUB_CLIENT_SECRET`
   - `npx wrangler secret put SESSION_SECRET` (long random secret)
5. Apply the checked-in migration: `npx wrangler d1 migrations apply voidflame-labs --remote`.
6. Deploy: `npx wrangler deploy`.
7. Update the public `config.js` file in the repository with the Worker origin. It contains public URLs only, never secrets.
8. Run OAuth, upload, download, moderation, and mobile-browser tests before public launch.

## Current functionality

- GitHub OAuth with signed, HttpOnly session cookies and D1 sessions.
- Per-account data export (`GET /api/me/export`) and own-session listing/revocation (`GET`/`DELETE /api/me/sessions`).
- Scheduled cleanup for expired sessions, stale rate-limit entries, and analytics older than 180 days.
- Approved project discovery and project detail API.
- Developer project submissions/edits, R2 release uploads (50 MB cap), and image/video gallery uploads (8 MB images, 30 MB videos), with extension and file-signature validation.
- Version metadata, dependencies, download proxy, project gallery media proxy, and view/download analytics.
- Favorites, follows, comments, reports, and admin/moderator project/report endpoints.
- Static JSON catalogue remains a fallback when the API is not configured.

## Important limitations before production

- Configure a same-site custom domain or test cross-origin cookies in the browsers you support; third-party cookie restrictions can block a GitHub Pages-to-workers.dev session.
- Assign initial `admin` or `moderator` roles manually in D1 to trusted accounts only.
- Add a production rate-limit binding or apply the included D1 rate-limit migration before high-traffic launch.
- File-signature checks are not antivirus scanning. Integrate a maintained malware scanner/quarantine workflow before accepting untrusted public uploads at scale.
- Follow [SECURITY-OPERATIONS.md](./SECURITY-OPERATIONS.md) for D1/R2 backup, restore, privacy, and deployment requirements; backups and restore drills must be configured and verified in Cloudflare.
- GitHub Pages and the Worker must both be deployed. A passing static-site workflow alone does not prove the API is configured.


## Security and DDoS protection

See [SECURITY.md](./SECURITY.md) for the implemented Worker limits and the required Cloudflare dashboard/WAF setup. The Worker bindings must be deployed, and edge DDoS/WAF controls must be enabled on the production hostname; code changes alone do not activate account-level Cloudflare rules.

## Privacy and operational security

Read [SECURITY-OPERATIONS.md](./SECURITY-OPERATIONS.md) for account data export, session controls, retention, backup/recovery, and production readiness checks. CI includes source-level security contract checks; these complement but do not replace end-to-end authorization tests or a security review.
