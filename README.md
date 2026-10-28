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

- API routes use same-origin checks, HTTP-only session cookies, rate limits, and role checks.
- Project submissions and release versions require moderation.
- Uploaded files are quarantined; extension/signature checks are not malware scanning.
- Live OAuth, production HTTPS, persistent-disk behavior, backups/restore, and a trusted malware-scanning workflow must be verified on the target host before public launch.

See [SETUP.md](SETUP.md) for configuration and deployment notes.
