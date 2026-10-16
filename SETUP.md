# VoidFlame Labs — GitHub-backed setup

The current website uses GitHub as its source of truth. **Do not create a Supabase project or add Supabase variables for the current build.**

## 1. Enable GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under Build and deployment, choose **GitHub Actions**.
3. Open **Actions → Deploy VoidFlame Labs** and confirm the workflow passes.

## 2. Catalogue data

- Public project listings live in `data/projects.json`.
- Only reviewed projects should be included.
- The deploy workflow validates the JSON before publishing.
- If the JSON is invalid, the workflow fails instead of deploying a broken catalogue.

## 3. Submissions and release files

1. A creator uploads files to a GitHub Release in their own public project repository.
2. They submit the project through **Issues → Submit a project**.
3. A maintainer reviews the submission, checks the source and release URLs, then commits the approved entry into `data/projects.json`.
4. The push to `main` triggers deployment.

## 4. Add an approved catalogue entry

Edit `data/projects.json` and append an object inside the `projects` array. Required fields: `name`, `category`, and `summary`. Recommended fields include `slug`, `author`, `description`, `version`, `supportedVersions`, `sourceUrl`, `releaseUrl`, `downloads`, `icon`, and `color`.

Use HTTPS GitHub URLs for `sourceUrl` and `releaseUrl`. Do not commit passwords, API tokens, private user data, or other secrets.

## 5. Important architecture limits

GitHub Pages serves static files; it cannot safely write to the repository or upload releases using a secret from browser JavaScript. This setup therefore uses issues for submissions and reviewed commits for publishing. GitHub repository permissions protect catalogue edits, and GitHub Releases host downloadable artifacts.

No additional language runtime or paid database is required for the public site.
