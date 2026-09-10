# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Try it out (install-free)

The easiest way to test T3 Code is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx t3@latest
```

This will launch T3 Code's backend on your machine as well as the local web app to control your agents.

Tip: Use `npx t3@latest --help` for the full CLI reference.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

### Run locally

Use Node 24 and run `pnpm dev` for server and web, or `pnpm dev:desktop` for Electron.
For web, open the one-time pairing URL printed by the runner.
See the [development guide](./docs/operations/development.md) for state directories, ports, and remote access.

### Set up Jira for local development

Jira is optional. A fresh clone runs without Jira credentials or 1Password.
To test Workbench's Jira integration, configure an Atlassian OAuth app for your development environment:

1. Create or select an OAuth 2.0 integration in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/).
2. Add the Jira API permissions requested by [JIRA_OAUTH_SCOPES](./packages/workbench/src/jira/JiraOAuthClient.ts):
   `read:project:jira`, `read:jira-work`, `write:jira-work`, `read:board-scope:jira-software`,
   `read:board-scope.admin:jira-software`, `read:sprint:jira-software`, `read:issue-details:jira`, and `read:jql:jira`.
   The authorization request also includes `offline_access` to refresh the connection.
3. Under **Authorization → OAuth 2.0 (3LO)**, register the callback for your running client:

   | Client  | Callback URL                                                                                                            |
   | ------- | ----------------------------------------------------------------------------------------------------------------------- |
   | Web     | Browser origin plus `/workbench`, for example `http://localhost:5733/workbench`                                         |
   | Desktop | Server origin plus `/oauth/workbench/jira/callback`, for example `http://127.0.0.1:13773/oauth/workbench/jira/callback` |

   Use the actual origin and port printed by your dev runner. Worktree ports can differ.
   Atlassian requires an exact callback match; update it when switching origins or ports.
   See [Atlassian's OAuth setup guide](https://developer.atlassian.com/cloud/jira/software/oauth-2-3lo-apps/).

4. Copy the app's client ID and secret from **Settings** into an ignored `.env.local` at the repository root:

   ```dotenv
   T3_WORKBENCH_JIRA_CLIENT_ID="your-client-id"
   T3_WORKBENCH_JIRA_CLIENT_SECRET="your-client-secret"
   ```

   You can export these variables instead. Keep the secret on the server; never use a `VITE_` or `EXPO_PUBLIC_` prefix.

5. Restart `pnpm dev` or `pnpm dev:desktop`. Open a Workbench Workspace and select **Connect Jira**.
   Authorize access, then choose the site, board, sprints, status mappings, and repository scope.

#### Optional: load credentials from 1Password in each new worktree

Install and authorize the [1Password CLI](https://developer.1password.com/docs/cli/get-started/).
Create an item named `t3code-workbench-dev-jira-credentials` with fields named
`T3_WORKBENCH_JIRA_CLIENT_ID` and `T3_WORKBENCH_JIRA_CLIENT_SECRET`.
Export its vault ID once in your shell configuration, then open a new terminal:

```sh
export T3_WORKBENCH_JIRA_VAULT="your-vault-id"
# Optional, if you used a different item name:
export T3_WORKBENCH_JIRA_ITEM="your-item-name"
```

Run `pnpm dev`, `pnpm dev:server`, or `pnpm dev:desktop` normally.
The first run creates `.env.local` from the two references in `.env.example`; no per-worktree configuration copy is required.
The runner detects the vault's account. You can override it with `OP_ACCOUNT` without changing the CLI's global default.
1Password may ask you to authorize access. The callback URL still needs to match the current client's origin and port.

Existing `.env.local` files are never overwritten. If one already exists, add any missing credentials there.
Explicit environment values take precedence. Without the vault setting, no 1Password commands run.
Failed injection prints a setup warning and lets development continue. Frontend-only runs, help, and dry runs skip injection.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

## Workbench fork

This fork adds **Workbench** for planning work across repositories and connecting it to the agents doing the implementation. It is available in the web and desktop clients and uses native T3 Code Threads for agent conversations.

- **Organize work:** group repositories into Workbench Workspaces, break work into Epics and Tickets, and track status and blocked work.
- **Start agent work from a Ticket:** use the Ticket's description as context and keep its repository assignments and Threads together.
- **Keep implementation connected:** create or reuse Ticket worktrees and navigate between Tickets, checkouts, Threads, and associated pull requests.

To use Workbench, [run this fork from source](#run-locally). Jira is optional; you can create and manage Tickets entirely in Workbench.

### Jira integration

The Jira integration connects your sprint work to your coding sessions. Connect a Workbench Workspace to a Jira board and selected sprints. Workbench imports issues assigned to you as Tickets, ready to provide context for agent work.

For imported Tickets, sync keeps issue details, Epic relationships, sprint membership, and progress aligned with Jira. You can map Jira statuses to Workbench's workflow or mirror the board's columns. From Workbench, you can edit issue descriptions and transition Jira statuses while keeping their Threads and checkout history together.

See [Jira setup](#set-up-jira-for-local-development) to configure the optional connection.
