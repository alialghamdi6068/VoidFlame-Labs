# VoidFlame Labs

VoidFlame Labs is a static Minecraft creator marketplace. **GitHub is the source of truth for the public project catalogue and release files; Supabase is not required to publish or display listings.**

## Where data lives

- `data/projects.json` — public catalogue. Only reviewed/approved projects belong here.
- GitHub Releases in each project's own repository — release binaries and version tags.
- GitHub Issues — project submission requests and moderation discussion.
- `.github/ISSUE_TEMPLATE/project-submission.yml` — structured submission form.
- GitHub Actions + GitHub Pages — validates the catalogue and deploys the site on pushes to `main`.

## Add or update a project

1. The creator publishes downloadable files as a GitHub Release in their own repository.
2. Submit a project using **Issues → Submit a project**, providing the source repository and release URL.
3. A maintainer reviews the issue, confirms the links and compatibility, and adds the approved listing to `data/projects.json`.
4. Commit the catalogue update to `main`. GitHub Actions validates the JSON and deploys the site.

Example catalogue entry:

```json
{
  "slug": "example-plugin",
  "name": "Example Plugin",
  "author": "Creator",
  "category": "Plugins",
  "summary": "A short description of the plugin.",
  "description": "Full description, setup instructions, and known limitations.",
  "version": "1.0.0",
  "supportedVersions": ["1.21.4"],
  "sourceUrl": "https://github.com/creator/example-plugin",
  "releaseUrl": "https://github.com/creator/example-plugin/releases/tag/1.0.0",
  "downloads": 0,
  "icon": "✦",
  "color": "#a8e6bd"
}
```

## Deploy

1. Open **Settings → Pages** and set the source to **GitHub Actions**.
2. Push changes to `main`, or run **Deploy VoidFlame Labs** manually from the Actions tab.
3. No Supabase URL, API key, database project, or frontend secret is required.

## Security and limitations

The website is a static GitHub Pages site. It does not expose a GitHub write token in browser code. Project catalogue edits are made through reviewed repository commits; release binaries stay in GitHub Releases. This design does not provide a separate website password database, private user profiles, or in-site upload of arbitrary files. GitHub account authentication and repository permissions govern submissions and maintainer changes.

Legacy Supabase migration files, if present in this repository, are not used by the current website.
