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

The page follows one Ticket as a commit graph: plan, brief and Progress,
References, a Thread per PR across repositories (the fork), PRs and attention,
recap previews, Done (the merge), and install. The two lanes represent Orbit API
and Orbit Web. `src/components/CommitGraph.vue` draws each section's slice. Lines
draw and nodes fill with CSS scroll-driven animations, so they need no JavaScript
and nothing runs while the page is idle. Under reduced motion, or in browsers
without scroll timelines, the graph is drawn in full. Below 900px it collapses
to one lane. Each screenshot opens in the lightbox.

The demo Ticket's history, PR outcomes, and recaps are synthetic. Its planning
conversation and prepared Git worktrees are real. The site and guide disclose
this at the first screenshot.

## Capture replacement pending

The source now follows the Orbit story, but the retained PNGs still show the
previous walkthrough. Their captions and alt text describe the intended captures;
image/caption agreement is incomplete until both themes are recaptured from the
native demo. Do not publish this intermediate source on its own. Keep all nine
slots and use actual captures rather than drawing product frames.

| Story slot       | Retained PNG basename | Section    |
| ---------------- | --------------------- | ---------- |
| `ticket`         | `ticket`              | Overview   |
| `planning`       | `planning`            | Plan       |
| `board`          | `board`               | Plan       |
| `agent-edit`     | `board-chat`          | Ticket     |
| `reference`      | `thread`              | References |
| `thread-context` | `workspace`           | Threads    |
| `terminal`       | `notifications`       | Threads    |
| `pull-requests`  | `pull-request`        | Review     |
| `recaps`         | `ticket-chat`         | Recaps     |

Replace these pairs in `src/assets/screenshots` and `docs/user/media/workbench`
together. When using the story's new basenames, update the imports in
`src/pages/index.astro` and the guide image paths too. The `ticket` image is also
the README hero and social share image. The current shared header, Graphite
Indigo theme, IBM Plex fonts, and T3 accent stay unchanged. Final chrome checks
and captures follow the separate shared UI dependency update.

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
