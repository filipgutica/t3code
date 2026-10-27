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

Open the printed origin at `/t3code/`. The site imports matched dark (`name.png`)
and light (`name-light.png`) screenshots from `src/assets/screenshots`. Both captures
must have the same dimensions and framing. Astro produces responsive WebP images;
the preview and full-size lightbox follow the shared System/Light/Dark choice. Capture at twice the intended
display width so text stays clear on Retina displays. Keep source screenshots
free of pairing URLs and private data.

Capture from a Workbench demo in a browser context with a 1280 × 900 viewport and a
device scale factor of 2, which gives 2560 × 1800 PNGs. Switch light and dark by
emulating the color scheme; the app follows the system theme. Check the saved dimensions
and text at 1:1 before replacing both the site and user-guide images; keep the
pointer outside the page, clear focus rings, and close popovers that expose local paths.

The walkthrough starts with a native planning conversation and editable draft.
It then shows the saved Ticket, prepared work area, continuation of the same
Thread, and the ticket chat with a recap and a Thread waiting for approval. A second
demo Ticket demonstrates linked PRs and attention.
Readers select each screenshot with tabs; arrow keys, Home, and End move between
them. Without JavaScript, all steps remain visible. Each screenshot opens in the
existing lightbox. The planning conversation is real; it does not show completed implementation work.
Demo PR feedback and implementation outcomes are illustrative.

The palette in `src/styles/t3-theme.css` mirrors T3 Code's default light and dark theme
so the page matches the screenshots. Update it when that theme changes.

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
