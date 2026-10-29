# Ali Labs

Ali Labs is a Minecraft project discovery and publishing platform for mods, plugins, modpacks, shaders, resource packs, and tools.

## Run

Requires Node.js 20+ and a host with a persistent writable disk.

\`\`\`sh
npm test
npm start
\`\`\`

Open \`http://localhost:3000\`. The server serves the website and API on the same origin. GitHub OAuth is optional for local preview and must be configured for sign-in.

## Local persistence

Application data is stored in \`data-local/store.json\`; uploads are stored in \`data-local/uploads/\`. These paths are excluded from Git. Set \`DATA_DIR\` if the host mounts a persistent disk elsewhere. Run one server process per data directory and maintain off-host backups.

## Security and readiness

- API routes use same-origin checks for cookie-authenticated mutations, HTTP-only session cookies, bounded rate-limit state, role checks, restrictive response headers, and request timeouts.
- Session token hashes use HMAC-SHA-256; production requires a strong `SESSION_SECRET` and a canonical HTTPS `PUBLIC_BASE_URL`.
- Project submissions and release versions require moderation.
- Upload concurrency is bounded; download analytics are capped to prevent unbounded memory growth.
- Local JSON snapshots are copied to a rotating set of ten backups every 30 minutes.
- Uploaded files are quarantined; extension/signature checks are not malware scanning.
- Live OAuth, production HTTPS, persistent-disk behavior, backups/restore, and a trusted malware-scanning workflow must be verified on the target host before public launch.

Set `ADMIN_GITHUB_ID` to the numeric GitHub account ID that should receive the initial administrator role. New users never become administrators merely because they sign in first.

See [SETUP.md](SETUP.md) for configuration and deployment notes.
