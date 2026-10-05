# Workbench site

Static product page for the Workbench fork, published at
<https://filipgutica.github.io/t3code/> after Pages is enabled and the workflow
reaches `main`.

From the repository root, with the repository's Node version and dependencies:

```sh
vp run --filter @t3tools/workbench-site dev
vp run --filter @t3tools/workbench-site typecheck
vp run --filter @t3tools/workbench-site build
vp run --filter @t3tools/workbench-site preview
```

Open the printed origin at `/t3code/`. The site imports PNG screenshots from
`src/assets/screenshots`; Astro produces responsive WebP images during the build,
and the full-size link opens the original PNG. Capture at twice the intended
display width so text stays clear on Retina displays. Keep source screenshots
free of pairing URLs and private data.

For T3 Browser captures, maximize the panel so the viewport fits without scaling,
then use the toolbar's **Capture screenshot** action to save the native-resolution
PNG. Automation snapshots are capped at 1280 pixels. Check the saved dimensions
and text at 1:1 before replacing both the site and user-guide images; keep the
pointer outside the page and close popovers that expose local paths.

The walkthrough shows a Ticket, its prepared workspace and native Thread, then
a second demo Ticket with a linked pull request and notifications. Jira is an
optional final step.
Readers select each screenshot with tabs; arrow keys, Home, and End move between
them. Without JavaScript, all steps remain visible. Each screenshot opens in the
existing lightbox. The captured Thread has not started an agent turn; demo PR
feedback and outcomes are illustrative.

The theme switch shares its `tool-site-theme` setting with the annoterm, wtree, and devps sites, which are served from the same origin.

## Publish

In the fork's **Settings → Pages → Build and deployment**, select **GitHub
Actions** as the source. Merge the site change into `main`. The **Workbench
Pages** workflow checks, builds, and deploys the site; pull requests only build
the artifact. A manual run on `main` can publish the current version again.

Check the deployment URL and the guide, download, and full-size screenshot links
before adding the homepage to the repository's About field or announcement.

If the repository name or host changes, update `site` and `base` in
`astro.config.mjs`. The page derives its canonical URL and local asset URLs from
that configuration. The site has no backend or runtime account connection.
