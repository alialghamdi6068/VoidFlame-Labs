# Ali Labs — Run and deployment setup

Ali Labs now includes a same-origin Node.js server. It serves the frontend and API together and persists application data in local JSON files; uploaded files are kept on the host's disk. It does not require a remote database or object-storage service.

## Requirements

- Node.js 20 or newer.
- A host that runs a persistent Node.js process and provides **persistent writable disk**. Do not use an ephemeral filesystem for production data.
- HTTPS in production.
- Optional GitHub OAuth credentials for account sign-in.

## Run locally

1. Install Node.js 20+.
2. In the repository directory, run \`npm test\`.
3. Run \`npm start\`.
4. Open \`http://localhost:3000\`.

The server creates \`data-local/store.json\` and \`data-local/uploads/\` automatically. \`data-local\` is ignored by Git. Set \`DATA_DIR\` only if you want to put persistent data in a mounted disk path.

## Environment variables

Only three secrets/configuration values are needed for GitHub sign-in:

- \`GITHUB_CLIENT_ID\`
- \`GITHUB_CLIENT_SECRET\`
- \`SESSION_SECRET\` (reserved for deployments that need an additional application signing secret; session tokens are currently random opaque tokens hashed on disk)

The server derives the OAuth callback from the current host: \`https://YOUR_DOMAIN/api/auth/callback\`. Set that exact callback in your GitHub OAuth App. \`PORT\`, \`HOST\`, and \`DATA_DIR\` are optional host/runtime settings, not required secrets. The app can start without OAuth credentials, but sign-in returns a clear 503 until configured.

## Persistent storage model

- \`data-local/store.json\`: users, sessions, projects, versions, comments, reports, audit records, and analytics.
- \`data-local/uploads/quarantine/\`: new uploads awaiting trusted scanning/review.
- \`data-local/uploads/\`: released files after they have passed the release workflow.
- Files are written using a temporary file and atomic rename. Ten local snapshots of `store.json` and uploaded files are rotated every 30 minutes under `DATA_DIR/backups/snapshot-*/`. Uploaded files are hard-linked when supported, so snapshots may share disk blocks with live uploads. Keep a separate backup outside the host account and test restoration before production launch.

### Restore a local snapshot

1. Stop the Node.js process before restoring any files.
2. Choose a valid `DATA_DIR/backups/snapshot-*` directory.
3. Restore its `store.json` to `DATA_DIR/store.json` and its `uploads/` directory to `DATA_DIR/uploads/` (replace the live uploads directory only while the server is stopped).
4. Restart the server and verify `/api/health`, project listings, and a known download. Keep an off-host backup because local snapshots cannot protect against host or disk loss.
- Upload processing is capped at three concurrent uploads per process to reduce memory-exhaustion risk.

## Important security limitations

- New file uploads are quarantined. The built-in signature/extension checks are not malware scanning. Uploaded release files cannot be downloaded while quarantined, and this server refuses to approve quarantined uploads without a trusted scanner/release process.
- GitHub OAuth must be configured on the production host; live OAuth cannot be verified without the actual credentials and callback domain.
- The JSON store is appropriate for a small single-instance deployment. It is not a multi-process database: run exactly one server process per data directory. For larger concurrent workloads, migrate to a transactional database rather than sharing this file between processes.
- The first GitHub account to sign in is assigned admin. Protect the OAuth app and the deployment URL during initial setup; after the first admin is created, review the role in \`data-local/store.json\`.
- Always use HTTPS in production so session cookies are Secure.
- A successful local test is not proof of production backup, scanner, OAuth, or host persistence.

## Checks

\`\`\`sh
npm test
npm start
\`\`\`

Verify \`GET /api/health\` returns \`{"status":"ok","storage":"local-files","schemaVersion":1}\`.
