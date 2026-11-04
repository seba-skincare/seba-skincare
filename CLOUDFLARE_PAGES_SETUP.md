# Cloudflare Pages migration (staged)

This branch prepares a Cloudflare Pages deployment without changing the current Netlify production site.

## Repository and deployment

- GitHub repository: `seba-skincare/seba-skincare`
- Test branch: `cloudflare-pages-migration`
- Pages Functions entry point: `functions/api/save.js`
- Admin save endpoint: `/api/save`
- Admin page: `/admin.html`

Create the Pages project with **Connect to Git** (not Direct Upload), select this repository, and keep `main` as the production branch. The `cloudflare-pages-migration` branch should deploy as a preview.

Build settings for this plain HTML/CSS/JS site:
- Framework preset: None
- Build command: leave blank
- Build output directory: `. ` (enter a single dot: `.`)
- Root directory: leave blank (repository root)

## Required encrypted secrets

In the Pages project, open **Settings → Variables and Secrets**. Add these as encrypted secrets in the **Preview** environment first, then add them to **Production** before promoting this branch:

1. `ADMIN_PASSWORD` — the admin password to use on `/admin.html`. Set it privately in Cloudflare; never commit it or send it in chat.
2. `GITHUB_TOKEN` — a GitHub fine-grained personal access token restricted to this repository, with **Contents: Read and write** permission. Store it as an encrypted secret; never commit it or send it in chat.

After adding or changing secrets, trigger a new deployment so the Pages Function receives them.

## Safe test order

1. Deploy the preview branch.
2. Open the preview URL and verify the homepage, service detail pages, and `/admin.html`.
3. Confirm the admin can load the catalogue.
4. Test a harmless edit to a service description and verify the commit appears in GitHub `main`; then revert the test edit if needed.
5. Test image upload only after text saving is confirmed.
6. Only after the preview is verified should the migration PR be merged and the production branch deployed.

Do not delete or disable Netlify during this migration. Keep the existing Netlify deployment available until Cloudflare production and saving are both verified.

## SEO follow-up

The existing canonical URL, structured-data URL, robots.txt sitemap URL, and sitemap.xml still point to GitHub Pages. Do not change them to a guessed Pages hostname. After Cloudflare gives the project its actual `pages.dev` hostname (or a custom domain is connected), update all four references together and verify the resulting pages.
