# VoidFlame Labs

A modern, dark-first Minecraft creator marketplace for discovering and publishing mods, plugins, modpacks, shaders, resource packs, and tools. The interface takes cues from contemporary community marketplaces such as Modrinth while keeping VoidFlame's own branding and design.

## Product experience

- Responsive discovery page with project search, category filters, sorting, and release details.
- Live marketplace cards are populated from approved Supabase projects; hardcoded sample projects are not presented as real community uploads.
- Account registration and sign-in with email/password, Google, or GitHub through Supabase Auth.
- Permission-gated publishing: users need explicit publishing access or an authorized staff role.
- Separate staff tools for role assignment, security review, and content moderation.
- Private file storage with short-lived signed downloads for approved releases.
- Automated server-side file scanning service using ClamAV, archive/path checks, SHA-256 integrity checks, static indicators, optional YARA rules, and optional AI-assisted triage.
- SQL migrations for database policies, staff roles, moderation, and scan report metadata.

## Required Supabase setup

Create a Supabase project, then run the SQL files in this exact order in **Supabase → SQL Editor**:

1. `supabase/schema.sql`
2. `supabase/002-security-hardening.sql`
3. `supabase/003-bootstrap-and-moderation.sql`
4. `supabase/004-manager-demotion.sql`
5. `supabase/005-specialist-permissions.sql`
6. `supabase/006-automated-security-scanning.sql`

The bootstrap recognizes `alialghamdi6068@gmail.com` as the owner. The account must sign in with that exact verified email. The database migration does not run automatically just because the repository was updated.

### Frontend configuration

1. Copy `config.example.js` to `config.js` for local testing and enter the Supabase project URL and public anon/publishable key.
2. Set GitHub Pages to use **GitHub Actions** as its deployment source. The site can deploy in preview mode before Supabase is configured.
3. To enable accounts and live backend features, add Actions variables named `SUPABASE_URL` and `SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions → Variables**.
4. Enable Email, Google, and GitHub providers in Supabase Auth as needed. Configure OAuth callback URLs and allowed redirect URLs using the values Supabase displays.

Only the public anon/publishable key belongs in frontend code. **Never place the Supabase service-role/secret key in `config.js`, browser JavaScript, or frontend build variables.**

See [SETUP.md](SETUP.md) for detailed provider, deployment, owner access, and scanner activation instructions.

## Publishing and review flow

1. A creator signs in at least once.
2. The owner or manager grants publishing access or assigns an eligible publisher role.
3. The creator submits project metadata and a `.jar` or `.zip` release up to 100 MB.
4. The release starts with `security_status = 'pending_scan'`.
5. The separate scanner service checks the uploaded file and stores a report. Incomplete required scans stay pending.
6. Flagged files require security review. Content moderators cannot approve a project unless every release has a `clean` security status.
7. Approved projects appear in discovery; approved release files are delivered through short-lived signed URLs.

## Automated security scanning

The scanner is a separate Docker service in `scanner/`; GitHub Pages does not run it. Follow the scanner section in [SETUP.md](SETUP.md):

- Start with `scanner/.env.example` and keep real credentials out of Git.
- Run the scanner using Docker Compose on a trusted host that can connect to Supabase.
- ClamAV provides signature scanning; additional checks inspect archive paths, compression ratios, suspicious indicators, and SHA-256.
- Reviewed YARA rules can be added to `scanner/rules/`.
- Optional AI triage is advisory. It receives bounded extracted text and scan indicators rather than the complete binary; it can raise a flag but cannot independently mark a file clean.
- No scanner can guarantee that a file is safe. Keep signatures and images updated, restrict access to scanner credentials, and review flagged submissions.

## Roles

- **Owner:** full platform authority.
- **Manager:** publishing permissions, staff assignments within allowed roles, and moderation workflows; only the owner can appoint or remove managers.
- **Security Reviewer:** investigates scan results and records security verdicts.
- **Content Moderator:** reviews project metadata and publication decisions.
- **Developer / Publisher:** submits projects when authorized.
- **Member:** browses the marketplace without publishing permission by default.
- **Suspended:** publishing disabled.

## Local development

Serve the repository with a local static HTTP server rather than opening `index.html` using `file://`. Create an untracked `config.js` from `config.example.js` and configure Supabase first. OAuth, live discovery, upload, and signed downloads require a working Supabase project.

## Current validation status

JavaScript syntax and migration ordering have been checked in the repository workflow. A live Supabase project, OAuth end-to-end flow, browser visual QA, Docker image build, and real-file malware scanning still need to be run in the configured deployment environment.
