# VoidFlame Labs setup

## Static website

1. Open repository **Settings → Pages** and select **GitHub Actions**.
2. Check **Actions → Deploy VoidFlame Labs** until the deployment job succeeds.
3. The static catalogue is `data/projects.json`. Only approved entries belong there; the catalogue may stay empty until real projects are approved.

## Enable dynamic API features

1. Create Cloudflare D1 database `voidflame-labs` and R2 bucket `voidflame-labs-files`.
2. Update `worker/wrangler.toml` with the actual D1 database ID, site origin and Worker origin.
3. Create a GitHub OAuth App whose callback is `https://YOUR_WORKER_HOST/api/auth/callback`. Set `GITHUB_CLIENT_ID`, then run `npx wrangler secret put GITHUB_CLIENT_SECRET` and `npx wrangler secret put SESSION_SECRET`.
4. From the `worker` directory run `npx wrangler d1 migrations apply voidflame-labs --remote`, then `npx wrangler deploy`.
5. Set `apiBaseUrl` in the root `config.js` to the deployed Worker origin and commit the public URL.
6. Sign in once, then assign the trusted account its initial role using D1, for example `UPDATE users SET role='admin' WHERE username='YOUR_GITHUB_USERNAME';`. Do not grant moderator/admin roles to untrusted accounts.
7. Test sign-in, project creation, review, release upload, download, comments, favorites, reports, and logout in desktop and mobile browsers.

## Architecture and safety

- GitHub Pages hosts the frontend; Cloudflare Worker serves the API; D1 stores application data; R2 stores release files.
- The Worker currently limits release uploads to 50 MB and an extension allowlist. This does not replace malware scanning.
- GitHub Pages and `workers.dev` can be treated as cross-site by browser cookie policies. Prefer a same-site custom domain/route for reliable session cookies.
- Never put OAuth secrets, D1 credentials, or other private keys in `config.js` or any browser file.
- The D1 migration is the source of schema changes. Keep `worker/schema.sql` aligned when making future schema updates.
