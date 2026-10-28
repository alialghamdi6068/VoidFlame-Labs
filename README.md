# Ali Labs

Ali Labs is a Minecraft project discovery and publishing platform for mods, plugins, modpacks, shaders, resource packs, and tools.

## Architecture

- **Frontend:** static HTML/CSS/JavaScript hosted on GitHub Pages.
- **Public catalogue:** `data/projects.json` is the reviewed fallback catalogue; the homepage can display it without a backend.
- **Dynamic features:** project detail, profiles, developer studio, moderation, sign-in, comments, favorites, follows, releases, and media use the Cloudflare Worker API.
- **Database:** Cloudflare D1, with versioned SQL migrations under `worker/migrations/`.
- **Files:** Cloudflare R2. Uploaded releases and media are not stored in Git.
- **Authentication:** GitHub OAuth with signed, server-side sessions. Secrets belong only in Worker secrets, never in frontend files.
- **CI:** GitHub Actions validates catalogue data, database migrations, JavaScript syntax, security contracts, and deploys GitHub Pages. CodeQL analyzes JavaScript/TypeScript; Dependabot checks GitHub Actions dependencies.

## Deployment

Follow [SETUP.md](SETUP.md) for first-time setup and [worker/SECURITY-OPERATIONS.md](worker/SECURITY-OPERATIONS.md) for privacy, backup, recovery, and security operations.

Before the Worker is deployed and configured, the homepage's static catalogue remains available but account-dependent pages and actions are unavailable. Set the public `apiBaseUrl` in `config.js` only after the deployed API passes its health check.

## Data and privacy

- Authenticated users can export their account data at `GET /api/me/export`.
- Users can review their active sessions at `GET /api/me/sessions` and revoke other sessions with `DELETE /api/me/sessions`.
- Scheduled cleanup removes expired sessions, stale rate-limit records, and analytics older than 180 days; it does not remove user content or audit history.
- Release/media uploads check allowed extensions, size, and file signatures. This rejects obvious mismatches but **is not malware scanning**. Do not accept public uploads at scale until a scanner/quarantine workflow is integrated with this Worker backend.
- D1 and R2 provisioning, secrets, OAuth registration, automatic off-account backups, and restore drills require real account setup; a successful CI run does not prove those operations work.

## Legacy components

The `supabase/` SQL files and `scanner/` service describe an earlier/alternate Supabase-based backend. They are **not connected to the active Cloudflare Worker frontend flow**. Do not run the Supabase scanner against production or place its service-role key in browser code. Migration/integration must be a deliberate project change, not a second parallel source of truth.

## Project review

Creators submit projects through the developer studio after the API is configured. New projects and versions remain pending until reviewed. Only approved projects and approved versions should be visible to public browsing/download endpoints.
