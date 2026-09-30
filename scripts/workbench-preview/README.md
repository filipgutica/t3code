# Private Workbench PR demos on Vercel

See [Workbench verification](../../docs/operations/workbench-verification.md)
for the relationship between local regressions, preview smoke, and hosted checks.

Open a PR's demo link, sign in to Vercel, and choose **Open demo**. The launcher starts an environment with synthetic Tickets, repositories and native Threads. Native pairing happens automatically. Reopening the same link in the same browser resumes that environment while it is running; **Start new demo** makes a fresh one. The environment stops after 20 minutes; return to the launcher to start another session.

Each fresh demo has its own filesystem and Jira connections. Jira starts disconnected. Local demo state is discarded at expiry; writes to Jira or other connected services remain.

## One-time setup

Use a dedicated Vercel Hobby project for this launcher, separate from the existing hosted-web preview project. Hobby is for personal, non-commercial use. Keep the project on Hobby: exceeding Sandbox quotas pauses creation without charging overages. Current allowances are 5 active CPU-hours, 420 GB-hours of allocated memory, 20 GB transfer and 10 concurrent sandboxes. See [Sandbox pricing](https://vercel.com/docs/sandbox/pricing) and [Hobby terms](https://vercel.com/docs/plans/hobby).

1. Create a free [Vercel account](https://vercel.com/signup) and a project named `workbench-pr-previews`. Use the Other framework, Node.js 24, and no root directory. Deployments are sent by the workflow; disable automatic Git deployments for this project.
2. Under Security → Deployment Protection, enable **Vercel Authentication** for **All Deployments**. Keep protection bypasses disabled. A trusted reviewer is a person whose Vercel account you explicitly grant deployment access to. They can sign in and request access from the protected preview; GitHub collaborator status does not grant access. Hobby currently permits one external granted-access user; see [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).
3. Create a Vercel access token scoped to your account/team. Save these repository Actions secrets without putting their values in source, chat, screenshots or logs:
   - `WORKBENCH_PREVIEW_VERCEL_TOKEN`: the access token.
   - `WORKBENCH_PREVIEW_VERCEL_TEAM_ID`: Vercel's team/account ID.
   - `WORKBENCH_PREVIEW_VERCEL_PROJECT_ID`: the dedicated project's ID.
4. Set repository Actions variable `WORKBENCH_PREVIEWS_ENABLED` to `true` after configuring protection and secrets.
5. Run **Workbench PR preview** from the Actions page with a PR number. After the infrastructure PR merges, dispatch it for each existing feature PR. Later owner-authored, same-repository PRs run automatically when opened or updated.

The deployment job refuses projects without All Deployments protection and checks anonymous access before posting the launcher URL. The launcher also refuses production deployments and cross-origin launch requests. Neither its Origin check nor its deployment environment is a substitute for Vercel Authentication.

## Build and lifecycle

The workflow builds application code and demo fixtures from the selected PR head. It uses `Dockerfile`, `Dockerfile.dockerignore`, and `config.mts` from the selected `main` controller commit. Runtime `start.mts` and native `smoke.mjs` come from the PR; bundle export, publication, and the protected launcher come from that controller commit. The PR code runs in a build job without integration credentials. Both the image and exported Linux bundle exercise the native service. A separate job publishes a revision- and checksum-addressed bundle to the repository's `workbench-preview-builds` prerelease and deploys the launcher from `main`. Only the repository owner's PRs from this repository are eligible.

Code bundles are public downloads in this already-public repository. They contain compiled code and open-source dependencies, not integration grants or runtime state. This distribution avoids Vercel Container Registry's separate storage charge. Launcher access and native environment operations remain private. Treat PR code as executable code you trust before using it with a connected service.

The launcher binds the PR number, revision, bundle URL and SHA-256 checksum at deployment. It refuses a closed PR or a changed head, verifies the checksum before extracting the bundle in a fresh Sandbox, and never passes its Vercel credentials to the runtime. It uses the existing native CLI to mint a one-use pairing credential and returns it privately to the browser. Never put a pairing URL or code in a PR comment or screenshot.

Sessions use `persistent: false`, no snapshots or drives, one vCPU and a 20-minute timeout. Failed startup stops its Sandbox. Closing a PR deletes its published bundles; already-running sessions expire within their original 20-minute limit. Old launcher links cannot start a fresh demo after the PR head changes or closes. A browser can still resume its already-running demo until expiry. The workflow retains one code bundle per open PR.

Standard Sandbox images provide the host runtime; no custom image is stored on Vercel. GitHub Actions builds consume GitHub's own allowances. Build artifacts expire after one day, and the workflow uses standard GitHub-hosted runners. This is quota-limited hosting, not unlimited free capacity.

## Synthetic attention inspections

Fresh previews include the labelled [attention fixture guide](../workbench-demo/README.md#private-preview-attention-fixtures).
The native GitHub reader uses a disposable executable adapter for fictional PRs
901–905, so inspection needs no credentials. The adapter reports no real login,
never forwards commands, and refuses writes including failed-check reruns with a
synthetic notice. The pinned real GitHub CLI remains installed, but the preview's
private PATH selects the adapter. Use a separate expendable environment with real
credentials and Actions write permission to verify an actual GitHub rerun.

## Optional Jira and OpenCode

Connect a test Jira site through Workbench's existing **Connect Jira** flow. A connection belongs to the whole demo environment and is available to its agents. Expiring the demo removes locally stored grants but does not revoke Atlassian app authorization or undo Jira writes. No maintainer Jira account is preloaded.

The preview pins OpenCode and selects `opencode/big-pickle` for turns and small model tasks. Other providers are disabled initially and no paid fallback is configured. [OpenCode lists Big Pickle as free and says submitted data may be used for model improvement](https://opencode.ai/docs/zen/#privacy). Use synthetic content; configure an approved provider before sending confidential data. Model availability and terms can change.

Hosted verification succeeded for a native Thread turn, but the free model rejected automatic Ticket summaries. Summaries may be unavailable in these demos; choose an approved provider if you need them.

## Local verification

From the repository root:

```sh
docker build -f scripts/workbench-preview/Dockerfile -t workbench-preview:local .
node scripts/workbench-preview/bundle.mjs workbench-preview:local /tmp/workbench-preview.tar.gz
node scripts/workbench-preview/smoke.mjs workbench-preview:local /tmp/workbench-preview.tar.gz
```

The smoke uses only a captured container name and removes that container afterwards. It boots the exported bundle from a different directory, checks seeded native state and authentication, and verifies that crash recovery removes prior credential files and invalidates sessions. Do not mount a developer home or live T3 state.

Install and check the isolated launcher without resolving the main workspace lockfile:

```sh
cd infra/workbench-preview/launcher
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts
```

A local smoke does not prove Vercel routing, managed-image compatibility, deployment protection or Sandbox expiry. Before enabling the feature stack, verify the hosted flow: anonymous launch denial, seeded Board at the selected revision, automatic pairing, a free OpenCode turn, isolated state between launches, and a fresh session after expiry.

## Hosted browser smoke

Use a browser with access to the protected Vercel deployment. Confirm that the PR
head matches the application revision in the preview comment. Open the launcher
and choose **Open demo**. The browser should reach a native T3 page without
typing a pairing code. Open **Agent Workbench** and confirm that Orbit and Beacon
contain their seeded Tickets.

On Beacon, move **Write the five-minute quickstart** from Todo to In Progress.
Wait for the saving state to finish, reload, and confirm that the Ticket remains
in In Progress. Restore it to Todo. Record the PR revision, controller revision,
browser, and observed result; capture only a Board screenshot without a pairing
URL or code. This checks protected launch, pairing, rendered seed data, and one
persisted Workbench write in one Sandbox. It does not check expiry, separate
launch isolation, Jira, or provider execution.

The Actions jobs cannot run this browser path with the current All Deployments
Vercel Authentication policy: they have no reviewer login session, and the
publisher rejects protection bypasses. Keep the hosted pass explicit instead of
counting the local Docker smoke as browser coverage.
