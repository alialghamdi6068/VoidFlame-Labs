# VoidFlame Labs

A modern discovery platform concept for community-made Minecraft content: mods, plugins, modpacks, shaders, and resource packs.

## Current status

This repository currently contains a responsive, interactive **frontend prototype** in `index.html`. It includes:
- Responsive dark UI with VoidFlame Labs branding
- Project category navigation and filters
- Search across project names, descriptions, creators, and tags
- Sorting by name and downloads
- Sample project cards and detail modals
- Publish and sign-in preview dialogs
- Keyboard shortcut `/` to focus search

## Important limitations

This is a frontend prototype, not a production marketplace yet. The displayed project data is sample content. Authentication, file uploads, virus scanning, real download hosting, creator accounts, ratings, moderation, and database persistence are **not implemented**. The UI labels these actions as previews rather than claiming that they work.

## Run locally

Open `index.html` in a modern browser. No build step is required.

## Publish with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main`; the included workflow deploys the static site.
