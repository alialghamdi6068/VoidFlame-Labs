# VoidFlame Labs — activation checklist

This guide covers the remaining account-owned setup. The repository code cannot create OAuth provider credentials or a Supabase project on your behalf.

## 1. Create Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor**.
3. Run these repository files in this exact order:
   - `supabase/schema.sql`
   - `supabase/002-security-hardening.sql`
   - `supabase/003-bootstrap-and-moderation.sql`
   - `supabase/004-manager-demotion.sql`
   - `supabase/005-specialist-permissions.sql`
   - `supabase/006-automated-security-scanning.sql`
4. Open **Project Settings → API** and copy the Project URL and public anon/publishable key. Do not copy the service-role/secret key into the site.

## 2. Configure account registration and Google sign-in

Email/password registration uses Supabase Auth. In **Authentication → Providers**, ensure the Email provider is enabled. Configure email confirmation and SMTP according to whether you want new accounts to confirm their email before signing in. The site also supports Google and GitHub OAuth.

### Google OAuth

1. In Google Cloud Console, create/select a project and configure the OAuth consent screen.
2. Create an OAuth client of type **Web application**.
3. In Supabase **Authentication → Providers → Google**, enable Google and paste the Google client ID and client secret.
4. Copy the Supabase callback URL shown on that provider settings page into the Google OAuth client's **Authorized redirect URIs**.

## 3. Configure GitHub sign-in

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set the homepage URL to the deployed VoidFlame Labs URL (or your local development URL while testing).
3. Set **Authorization callback URL** to the callback URL shown in Supabase **Authentication → Providers → GitHub**.
4. Create the app, then paste its client ID and client secret into the Supabase GitHub provider settings and enable the provider.

Never paste provider client secrets into this repository or frontend code.

## 4. Configure site URLs

In Supabase **Authentication → URL Configuration**:
- Set **Site URL** to the real deployed website URL.
- Add the deployed URL and the local development URL you use to **Redirect URLs**.

Use the exact URL shown after GitHub Pages deploys; do not guess it.

## 5. Configure GitHub Pages deployment

1. In the repository, open **Settings → Secrets and variables → Actions → Variables**.
2. Add these repository variables:
   - `SUPABASE_URL` — your Supabase Project URL.
   - `SUPABASE_ANON_KEY` — your public anon/publishable key.
3. In **Settings → Pages**, select **GitHub Actions** as the build/deployment source.
4. Open **Actions** and inspect the latest **Deploy VoidFlame Labs** run. It will now fail clearly if either variable is missing.

These two frontend values are intended to be public. Do not add a Supabase service-role key.

## 6. Activate owner access and test publishing

1. Sign in through Google or GitHub using the verified account `alialghamdi6068@gmail.com`.
2. Confirm that the account profile has the `owner` role. The SQL trigger/backfill assigns this role to that exact email.
3. Sign in with a separate test account. It should not be able to publish until the owner/manager grants permission.
4. From the owner account, open **Manager**, enter the creator's email, and grant publishing access.
5. Upload a test .jar/.zip, confirm it is held as `pending_scan`, then verify the scanner verdict before content approval.

If the owner account signs in before running the SQL bootstrap, run `supabase/003-bootstrap-and-moderation.sql` after the other two files. If the owner email is already in use by a different Supabase auth identity, resolve that account conflict before granting owner access.

## 7. Permission roles and review workflow

The `005-specialist-permissions.sql` migration adds separate roles:
- **Owner** — full platform authority.
- **Manager** — manages staff permissions and coordinates moderation; only the owner can appoint or remove managers.
- **Security Reviewer** — reviews flagged releases and records a clean, flagged, or rejected verdict.
- **Content Moderator** — reviews project descriptions, categories, and metadata.
- **Developer / Publisher** — can submit plugins, mods, modpacks, shaders, resource packs, and other supported project types.
- **Member** — browsing account without publishing rights by default.
- **Suspended** — publishing disabled; enforce any broader sign-in restrictions separately if desired.

A release starts with `security_status = 'pending_scan'`. The scanner processes it, and a project cannot be approved unless every release has `security_status = 'clean'`. Flagged or rejected files cannot be approved through the normal moderation RPC.

## 8. Start the automated malware scanner

The scanner is a separate server-side Docker service. It is **not** hosted by GitHub Pages and must be deployed on a machine/container host that can reach Supabase. It must never run inside a browser.

1. Install Docker Engine and the Docker Compose plugin on a trusted server.
2. In the repository checkout, enter the `scanner/` directory.
3. Copy `.env.example` to `.env`.
4. Fill in `SUPABASE_URL` and the **server-only** Supabase service-role key in `.env`. Get the key from Supabase Project Settings → API. This key bypasses RLS; keep it out of Git, frontend files, screenshots, and chat.
5. Start it with `docker compose up -d --build`.
6. Watch startup and scanning with `docker compose logs -f scanner clamav`. ClamAV may take several minutes on first boot to download signatures.
7. Keep Docker images, ClamAV signatures, and the host patched. Restrict access to the server and its logs.

The worker polls the private `project_versions` table for `pending_scan`, downloads each file from the private `project-files` bucket, scans in memory, and records its verdict/report. It never executes JARs or extracts archive members to disk. If ClamAV is unavailable or a required scan errors, the item remains `pending_scan` (fail closed). It also checks archive paths/size ratios, SHA-256, suspicious static indicators, and optional YARA rules.

### Optional AI triage

AI is **advisory only**. The optional OpenAI-compatible API receives bounded printable strings and scan indicators—not the full binary. It can add a suspicious flag, but it can never mark a file clean. Configure `AI_ENABLED=true`, `AI_API_KEY`, and `AI_MODEL` in `scanner/.env` only if you accept sending those extracted snippets to the configured provider. Keep it disabled otherwise. Do not send uploaded source/binaries to an AI provider without a privacy review.

### Important limitations

- No malware scanner can guarantee a file is safe. False negatives and false positives are possible.
- ClamAV signatures, archive checks, static heuristics, and optional AI triage are layers, not a guarantee. Add reviewed YARA rules to `scanner/rules/` as needed.
- The current scanner is a single worker; production scale requires monitoring, alerting, retention controls, and tested recovery.
- Do not mark files clean manually without evidence. Review flagged results in the Security Queue.
- The scanner service-role key is a highly privileged secret. Never place it in `config.js`, `index.html`, GitHub Pages variables used by frontend builds, or client JavaScript.
- This repository's app/OAuth/Supabase setup still requires account-owner configuration and end-to-end testing.

