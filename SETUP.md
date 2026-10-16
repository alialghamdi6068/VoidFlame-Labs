# VoidFlame Labs — activation checklist

This guide covers the remaining account-owned setup. The repository code cannot create OAuth provider credentials or a Supabase project on your behalf.

## 1. Create Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor**.
3. Run these repository files in this exact order:
   - `supabase/schema.sql`
   - `supabase/002-security-hardening.sql`
   - `supabase/003-bootstrap-and-moderation.sql`
4. Open **Project Settings → API** and copy the Project URL and public anon/publishable key. Do not copy the service-role/secret key into the site.

## 2. Configure Google sign-in

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
5. Upload a test .jar/.zip, approve it from the Manager workspace, then test the approved download with the creator and a signed-out visitor.

If the owner account signs in before running the SQL bootstrap, run `supabase/003-bootstrap-and-moderation.sql` after the other two files. If the owner email is already in use by a different Supabase auth identity, resolve that account conflict before granting owner access.

## Current boundaries

- The frontend restricts uploads to .jar/.zip up to 100 MB. This is not malware scanning; do not treat it as proof that a plugin is safe.
- Before opening public submissions broadly, add server-side archive inspection, abuse reporting, rate limits, and a backup/restore procedure.
- The application code does not provide real OAuth credentials or create the Supabase project. Those steps require access to your provider accounts.
