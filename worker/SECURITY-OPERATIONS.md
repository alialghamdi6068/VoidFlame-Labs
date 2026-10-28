# Privacy, Backups, and Recovery

## Current Worker controls

- Signed server-side sessions; cookies are HttpOnly and Secure.
- Mutating requests must match the configured site Origin.
- `GET /api/me/export` exports only the signed-in user's profile and related projects, favorites, follows, comments, and reports.
- `GET /api/me/sessions` lists the signed-in user's active sessions without returning tokens.
- `DELETE /api/me/sessions` revokes the signed-in user's other sessions.
- Release and gallery uploads validate size, extension, and file signature. This is not malware scanning.
- A daily scheduled task removes expired sessions, stale rate-limit rows, and analytics older than 180 days. It does not delete user content or audit history.
- API errors do not return internal exception details.

## Cloudflare deployment checklist

1. Create the D1 database and R2 bucket named in `wrangler.toml`; replace placeholder IDs and URLs.
2. Set `GITHUB_CLIENT_ID` as a Worker variable. Store `GITHUB_CLIENT_SECRET` and a high-entropy `SESSION_SECRET` with Wrangler secrets. Never put secrets in frontend files or Git.
3. Configure the GitHub OAuth callback to the deployed API's `/api/auth/callback` endpoint.
4. Apply D1 migrations remotely and deploy the Worker. Confirm D1, R2, rate-limit bindings, and the scheduled trigger exist in the deployed Worker.
5. Set the site's API URL only after the API is deployed and verified.
6. Test sign-in, callback, logout, session revocation, and API use in browsers with strict privacy settings. Consider a custom domain arrangement that avoids third-party-cookie restrictions.
7. Enable account MFA and use least-privilege Cloudflare API tokens. Rotate credentials if exposure is suspected.
8. Do not log OAuth tokens, cookie values, session signatures, or secrets.

## D1 backup and restore

- Verify Cloudflare D1 Time Travel is available and record the recovery window for the account/plan.
- Before migrations or destructive changes, export the database with Wrangler:
  `npx wrangler d1 export ali-labs --remote --output ./backups/ali-labs-YYYYMMDD-HHMM.sql`
- Encrypt exports at rest, restrict access, keep a copy outside the Cloudflare account, and never commit backups to Git.
- Suggested starting retention: daily copies for 7 days and weekly copies for 4 weeks, adjusted for privacy and storage requirements.
- At least quarterly, restore an export to a separate test database and verify record counts, project/version relationships, and migrations. Never test restore over production.

## R2 file recovery

- Configure object versioning or an equivalent recovery control where available.
- Keep a separate copy of release/gallery objects using a least-privilege backup credential. A D1 export does not back up R2 objects.
- Track object keys and their database references; test restoring sample objects and checking metadata.
- Do not configure automatic object deletion until retention requirements and database references have been checked.

## File safety limitation

File signatures help reject obvious extension mismatches, but they do not detect malware, archive bombs, or malicious files with valid headers. Before accepting untrusted uploads at scale, add a maintained scanner and quarantine workflow. Do not execute or unpack uploaded files in the Worker.

## Before launch

- Test that one account cannot read or modify another account's resources.
- Test 401/403 responses for unauthenticated and wrong-role requests.
- Test logout and session revocation.
- Test invalid OAuth state, malformed/oversized uploads, and mismatched file signatures.
- Confirm R2 is not publicly exposed and download/media routes enforce project status.
- Restore D1 and R2 in a non-production environment.
- Record recovery point and recovery time objectives and verify them in a restore drill.

This document cannot configure the user's Cloudflare account by itself. Provisioning, secrets, OAuth registration, backup storage, retention, and restore testing still require setup and verification in the actual account.
