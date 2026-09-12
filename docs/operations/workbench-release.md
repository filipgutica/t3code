# Workbench desktop releases

This is the maintainer procedure for the fork's desktop release workflow. The
workflow is [.github/workflows/workbench-release.yml](../../.github/workflows/workbench-release.yml)
and is started manually from **Actions → Workbench desktop release → Run
workflow**.

Workbench starts at version **0.0.1**, independently of the bundled upstream
version. Enter the next Workbench version explicitly for later previews.

The workflow resolves the current fork `main` commit once. Every quality check
and desktop matrix job checks out that exact SHA. It builds macOS arm64 and x64,
Linux x64, and Windows x64 packages, validates the expected installer, and
creates SHA-256 manifests. GitHub Release notes are generated from pull
requests, using the supplied `previous_tag` (or the newest `workbench-v*` tag
when that input is empty). The selected commit, the notes tag, and the upstream
`pingdotgg/t3code` SHA and merge base are recorded when the upstream lookup is
available.

## Run modes

`unsigned-preview` is the default for the first shared release. It produces
explicitly labelled `UNSIGNED PREVIEW` packages and creates a **draft,
prerelease** GitHub Release with the installers, build
provenance, and `SHA256SUMS.txt`. A maintainer must review and publish that
draft manually. The tag is named `workbench-vX.Y.Z`, so it does not trigger the
upstream-compatible `v*` release workflow in this fork.

`build-only` produces explicitly labelled `UNSIGNED BUILD VALIDATION` packages
as workflow artifacts and does not create a GitHub Release. Use it to prove the
native packaging and Workbench build before creating a shareable preview.

Signing is intentionally not part of this first preview workflow. A future
signed mode must require every Apple and Windows credential below in a
preflight before any platform build starts; it must never silently turn a
requested signed release into an unsigned one.

The release is not operational until a run succeeds on GitHub and the resulting
draft has been reviewed. In particular, an unsigned build artifact or a passing
local command does not prove that the public release, update feed, or Jira
experience is ready.

## Required build configuration

The workflow exports these values into every desktop build:

- `T3CODE_WORKBENCH_BUILD=1`
- `T3_WORKBENCH_JIRA_BROKER_URL=https://workbench-auth.fgutica.workers.dev`
- `T3CODE_DESKTOP_UPDATE_REPOSITORY=${{ github.repository }}`

The repository value reserves this fork's release source for future updater support.
Automatic updates are disabled for the unsigned preview; users install later
versions from this fork's GitHub Releases page.

The preview installs as **T3 Code Workbench**, using app identifier
`com.filipgutica.t3code.workbench`, URL scheme `t3code-workbench`, and its own
`.t3-workbench` data directory. It does not migrate existing T3 Code data.
Before signed distribution, confirm the fork's app protocol and Clerk callback
configuration, including any macOS passkey or associated-domain requirements.
Those external allowlists are a release prerequisite and are not proven by a
successful unsigned package build.

Windows packages include the Linux `node-pty` prebuild used by the WSL backend.
The workflow builds it on Ubuntu with `build-essential` and Python 3, then
passes it to the Windows packaging job. Linux packaging installs
`build-essential`, `libsecret-1-dev`, `pkg-config`, and ImageMagick. Windows
uses the hosted Visual Studio installation, Rust's MSVC target, Python 3, tar,
and the Spectre-mitigated MSVC runtime component.

## Configure signing for a future signed mode

Add secrets and variables at **Repository → Settings → Secrets and variables →
Actions**. Keep private keys and passwords as Actions secrets; the
future signing setup can keep `APPLE_TEAM_ID` as a repository variable.

For macOS, the signing setup requires a paid Apple Developer membership and
the following values:

| Name                         | Kind     | Value                                                      |
| ---------------------------- | -------- | ---------------------------------------------------------- |
| `CSC_LINK`                   | secret   | Base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD`           | secret   | Password for that `.p12` file                              |
| `APPLE_API_KEY`              | secret   | Contents of the App Store Connect API `.p8` key            |
| `APPLE_API_KEY_ID`           | secret   | App Store Connect API key ID                               |
| `APPLE_API_ISSUER`           | secret   | App Store Connect issuer UUID                              |
| `APPLE_TEAM_ID`              | variable | Apple Developer Team ID                                    |
| `MACOS_PROVISIONING_PROFILE` | secret   | Base64-encoded macOS provisioning profile                  |

The existing Windows packager supports Azure Artifact Signing (formerly Trusted
Signing). A future signed workflow can use it. Configure the Azure
tenant, application, Trusted Signing account, certificate profile, and
publisher values below:

| Name                                             | Kind   |
| ------------------------------------------------ | ------ |
| `AZURE_TENANT_ID`                                | secret |
| `AZURE_CLIENT_ID`                                | secret |
| `AZURE_CLIENT_SECRET`                            | secret |
| `AZURE_TRUSTED_SIGNING_ENDPOINT`                 | secret |
| `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`             | secret |
| `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME` | secret |
| `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`           | secret |

Confirm the Azure service's current pricing and eligibility in its account
before relying on it for distribution. These values are documentation for the
future signed workflow; the current unsigned preview workflow does not read
them.

## Jira production app prerequisite

The personal Jira site proves the OAuth callback and token exchange for the
owner's account. Before other users can authorize the integration, open the
[Atlassian OAuth app management guide](https://developer.atlassian.com/cloud/oauth/getting-started/managing-oauth-apps/)
and enable **Sharing** for the production OAuth app in its Distribution
settings. This is an Atlassian app setting; it is separate from the Workbench
release workflow and the Cloudflare Worker deployment.

## Installing the unsigned preview

Download the installer matching your operating system and processor from the
fork's GitHub Releases page. The preview is not signed by a verified publisher.

- macOS may block the first launch. For a download you trust, use **System
  Settings → Privacy & Security → Open Anyway** as described in
  [Apple's instructions](https://support.apple.com/en-ca/guide/mac-help/mh40616/mac).
- Windows may show an unknown-publisher or SmartScreen warning. Managed-device
  policies and Smart App Control can block unsigned software; see
  [Microsoft's guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
- On Linux, make the AppImage executable before launching it.

Signing and installation have not been tested on each platform until the
corresponding release build and installation checks complete.
