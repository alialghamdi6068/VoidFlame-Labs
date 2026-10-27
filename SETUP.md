# VoidFlame Labs — Deployment Setup

This repository has a static GitHub Pages frontend and a separate Cloudflare Worker API. The homepage's reviewed JSON catalogue works without the API; sign-in, profiles, publishing, moderation, comments, favorites, follows, releases, and media require the API.

## 1. Deploy the frontend

1. Open GitHub repository **Settings → Pages** and select **GitHub Actions** as the source.
2. Open **Actions → Deploy VoidFlame Labs** and confirm the workflow succeeds.
3. Public site: `https://alialghamdi6068.github.io/VoidFlame-Labs/`.

## 2. Provision Cloudflare

From the repository root on a machine with Node.js installed:

1. Run `npx wrangler login`.
2. Create a D1 database: `npx wrangler d1 create voidflame-labs`.
3. Copy the returned database ID into `worker/wrangler.toml`, replacing `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.
4. Create the R2 bucket: `npx wrangler r2 bucket create voidflame-labs-files`.
5. Replace `API_URL` in `worker/wrangler.toml` with the actual HTTPS Worker origin (for example, `https://voidflame-labs-api.<account>.workers.dev`). Do not leave the placeholder in a deployed configuration.
6. From the `worker/` directory, apply migrations and deploy:
   ```sh
   npx wrangler d1 migrations apply voidflame-labs --remote
   npx wrangler deploy
   ```
7. Verify `https://YOUR_WORKER_HOST/api/health` returns `{"status":"ok"}`. A 503 means the API/database is not ready; do not connect the frontend yet.

## 3. Configure GitHub OAuth and secrets

1. Create a GitHub OAuth App. Set its authorization callback URL to `https://YOUR_WORKER_HOST/api/auth/callback`.
2. Set `GITHUB_CLIENT_ID` as a Worker variable using the Cloudflare dashboard or Wrangler configuration.
3. From `worker/`, set secrets interactively (do not paste secret values into chat, Git, or frontend files):
   ```sh
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   ```
   Use a high-entropy random `SESSION_SECRET`.
4. Deploy again after changing Worker variables/secrets.
5. Confirm OAuth's callback URL exactly matches the deployed Worker origin and callback path.

## 4. Connect the frontend

After the health check succeeds, set `apiBaseUrl` in the root `config.js` to the deployed Worker origin, with no trailing slash. This is a public URL, not a secret. Never put OAuth secrets, database credentials, or service-role keys in `config.js`.

If browser cookie restrictions block sign-in between GitHub Pages and `workers.dev`, use a custom domain arrangement that makes the frontend and API same-site, then update `SITE_URL`, `API_URL`, OAuth callback settings, and `config.js` consistently.

## 5. Create the first administrator

1. Sign in once using the GitHub OAuth flow.
2. In Cloudflare D1, promote only your trusted account:
   ```sql
   UPDATE users SET role='admin' WHERE username='YOUR_GITHUB_USERNAME';
   ```
3. Verify the update affected exactly one row. Never grant admin/moderator access to an untrusted account.

## 6. Production security checklist

- Keep Worker secrets out of Git and frontend code; rotate any secret suspected of exposure.
- Use least-privilege Cloudflare credentials and MFA on the Cloudflare/GitHub accounts.
- Verify D1 migrations, R2 bindings, rate-limit bindings, and the scheduled trigger in the deployed Worker.
- Test sign-in, logout, session listing/revocation, account export, project ownership checks, moderation roles, upload type/size limits, approved-version visibility, and downloads.
- Configure encrypted D1 exports and a separate R2 backup, retain backups outside the primary account, and run a restore drill before launch. The repository documents the process but does not yet provision fully automated off-account backups.
- The current upload signature checks are not malware scanning. Keep untrusted uploads restricted until a maintained scanner and quarantine workflow is integrated with the Worker API.
- Do not treat a passing GitHub Actions run as proof of production deployment, live OAuth, backups, or restore readiness.

## Architecture note

`supabase/` and `scanner/` contain an earlier/alternate Supabase implementation. They are not integrated with the active Cloudflare Worker frontend. Do not configure both backends as simultaneous sources of truth.
