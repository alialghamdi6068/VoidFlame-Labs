# VoidFlame Labs

A modern Minecraft content platform for discovering and publishing mods, plugins, modpacks, shaders, resource packs, and tools.

## Features in the repository

- Responsive discovery UI with categories, search, sorting, and project details.
- Account registration and sign-in with email/password, Google, or GitHub via Supabase Auth.
- Permission-gated project publishing: users cannot upload unless the owner or a manager grants publishing access.
- Separate staff role management, security review queue, and content review queue.
- Owner-only manager appointment/removal; manager-assigned Developer, Security Reviewer, and Content Moderator roles.
- Project and release moderation with private file storage and signed downloads for approved releases.
- Supabase database policies and server-side RPCs in `supabase/`.

## Required setup before live authentication/uploads work

This repository intentionally does not include backend credentials. The frontend needs a Supabase project before OAuth or uploads can work.

1. Create a Supabase project.
2. In the Supabase SQL Editor, run these files in order:
   - `supabase/schema.sql`
   - `supabase/002-security-hardening.sql`
   - `supabase/003-bootstrap-and-moderation.sql`
3. Copy `config.example.js` to `config.js` and set `supabaseUrl` and `supabaseAnonKey` from Supabase Project Settings → API. The example file is safe to commit; **do not commit `config.js`**.
4. In Supabase Authentication settings, enable Google and GitHub providers and add each provider's OAuth client ID/secret. Add the deployed site's URL to the allowed redirect URLs. Configure the correct site URL for local testing too.
5. The SQL bootstrap currently recognizes `alialghamdi6068@gmail.com` as the owner. Confirm this is the correct email before relying on owner permissions. The owner must sign in with that exact verified email.
6. For deployment, add repository **Actions variables** named `SUPABASE_URL` and `SUPABASE_ANON_KEY` under Settings → Secrets and variables → Actions → Variables. These are public browser settings, not service-role credentials. The workflow writes `config.js` only into the deploy artifact; it does not commit it.
7. Open repository Settings → Pages and choose GitHub Actions as the source. A private repository may require a plan that supports GitHub Pages.

## Upload and moderation flow

1. A creator signs in with Google or GitHub.
2. The owner/manager finds the account in the manager workspace and grants publishing permission. The creator must sign in at least once before their profile exists.
3. The creator uploads a .jar or .zip release (up to 100 MB) with project metadata.
4. The submission remains pending until a manager approves or rejects it.
5. Approved projects and approved release files can be discovered and downloaded. Files remain in a private Supabase Storage bucket; the site creates short-lived signed download URLs.

## Security notes

- Never put a Supabase service-role key in browser code. Only the public anon/publishable key belongs in `config.js`; row-level security controls access.
- The schema limits uploads to .jar/.zip and 100 MB. This is not malware scanning. Before opening public uploads at scale, add server-side archive inspection/antivirus scanning, rate limits, abuse reporting, and backups.
- OAuth works only after the provider credentials and callback URLs are configured in Supabase. Creating the files alone cannot activate provider credentials.
- The site uses a static frontend plus Supabase services; no backend credentials have been configured or tested from this repository session.

## Run locally

Serve the repository directory with a local static HTTP server, create an untracked `config.js` from `config.example.js`, and open the local URL in a browser. Opening `index.html` directly with `file://` may not work reliably for OAuth redirects.

## Deployment

Push to `main`; the GitHub Actions workflow runs the GitHub Pages deployment. The repository's Pages settings and Supabase OAuth redirect allowlist must still be configured.
