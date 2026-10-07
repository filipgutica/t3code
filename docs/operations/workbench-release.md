# Workbench desktop releases

This is the maintainer procedure for the fork's desktop release workflow. The
workflow is [.github/workflows/workbench-release.yml](../../.github/workflows/workbench-release.yml)
and is started manually from **Actions → Workbench desktop release → Run
workflow**.

Workbench starts at version **0.0.1**, independently of the bundled upstream
version. Enter the next Workbench version explicitly for later previews.

Merging a pull request updates `main` without immediately creating a release. Verified
upstream syncs update `main` automatically after their focused gates and
conflict-checked base update; a stale or protected update remains an open PR
for manual review.
The inherited upstream release workflow is archived outside GitHub's active workflow directory.

Enter a commit SHA from `main` in **commit_sha** to release that checkpoint. For
a merged PR, use its merge commit, not a commit from its feature branch. Leave
it empty to use the current fork `main`. The release includes all changes
through that commit; later merges stay out. Commits outside the first-parent
history of `main` are rejected.

The workflow resolves the selected commit once. Every quality check
and desktop matrix job checks out that exact SHA. It builds macOS arm64 and x64,
Linux x64, and Windows x64 packages, validates the expected installer, and
creates SHA-256 manifests. GitHub Release notes are generated from pull
requests, using the supplied `previous_tag` (or the newest `workbench-v*` tag
reachable from the selected commit when that input is empty). A supplied tag
must also be an ancestor of the selected commit. The selected commit, the notes tag, and the upstream
`pingdotgg/t3code` SHA and merge base are recorded when the upstream lookup is
available.

## Run modes

`release` creates a draft release and requires **sign_macos**.
`unsigned-preview` creates a draft prerelease. `build-only` uploads workflow
artifacts without creating a release. The preview and build-only modes default to unsigned builds. Set
**sign_macos** to sign and notarize the Mac builds in those modes; Windows and
Linux remain unsigned. Missing Apple credentials stop the run before builds
start. A signing or notarization failure fails the release rather than falling
back to unsigned output.

Review the stable draft and publish it manually. Only published releases become
update candidates. Stable Workbench releases use the independent `workbench-vX.Y.Z` tag namespace.

## Daily prereleases

[Workbench daily desktop release](../../.github/workflows/workbench-daily-release.yml)
reuses the same quality checks, WSL runtime, four-platform build matrix, and Apple signing requirements.
Its proposed schedule is nightly at **02:00 America/Vancouver**, using GitHub's
[IANA timezone support](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule).
Timezone rules determine the UTC offset. If a clock change skips 02:00, GitHub advances the run to the next valid time.
GitHub may delay or drop scheduled runs, so this is a target time rather than a guaranteed start.
The scheduler requires successful main feature CI and Workbench quality runs for its exact captured SHA.
Missing, pending, or failed verification skips that day's build.

The scheduler captures its main SHA and original run date. It builds only when that
checkpoint differs from the last successful daily release or the current stable release.
Drafts and failed builds do not advance the checkpoint. The SHA must remain in main's first-parent history.
Each daily version increments the highest published `workbench-v*` version, including previews accepted by the Stable feed.
For example, `0.0.22-nightly.20261007.9` follows stable `0.0.21`.
An unsigned preview raises that version floor without advancing the successful signed-build checkpoint.
The tag is `workbench-daily-v0.0.22-nightly.20261007.9`; the final number is the workflow run number.
The original UTC date and run number remain fixed on reruns.

Daily releases publish automatically as prereleases after every platform, signature,
manifest, and checksum check succeeds. They do not become GitHub's latest stable release.
The publisher never changes a published daily release. A rerun can recover a matching
draft, but it skips a successful publication or a checkpoint superseded by a successful release.
This policy does not enable GitHub's repository-wide immutable-release setting.

`workbench-release.json` records the source SHA, original package versions, provider compatibility pin,
integrated upstream baseline, date, and run identifier. The same record appears in the release body.
The integrated baseline is distinct from the observed upstream tip in the release notes.
Missing signing credentials or incomplete daily publication stops the run; it does not create unsigned daily updates.

The scheduler becomes active only after its workflow is merged into main.
Review the draft implementation before enabling it. The implementation PR does not publish installer releases.

## Updates

The first preview, 0.0.1, has no update feed. Install the first updater-enabled
release manually. Subsequent updater-enabled Windows installations, Linux
AppImages, and signed macOS builds check GitHub releases automatically. Users
choose when to download and restart; updates do not install silently.

Older clients that force the stable preference, including `0.0.21`, first need a stable release
containing channel support. Alternatively, install the first daily build manually to opt in.

The default **Stable** preference considers only published `workbench-vX.Y.Z` releases in
`filipgutica/t3code`, including preview releases. In Settings, choose **Nightly** to opt into daily Workbench prereleases.
The nightly preference also accepts a newer stable promotion. Stable `0.0.22` sorts after every `0.0.22-nightly.*` build.
Publishing it does not renumber the upstream packages or provider compatibility pin.
Switch back to Stable to return to the stable feed, including an explicit downgrade when necessary.
Ordinary polling does not select older daily builds.
Both preferences ignore drafts and unrelated tags. Keep Workbench version numbers increasing. Unsigned macOS builds require
manual downloads because the native Mac updater requires code signing.

Each build emits update metadata. Unsigned Mac releases omit their Mac update
manifest so signed clients cannot select them. For signed builds, the release job merges both Mac manifests
into `latest-mac.yml`, retains `latest.yml` for Windows and `latest-linux.yml`
for Linux, and recomputes the final checksums after merging. Daily builds use the corresponding `nightly*.yml` manifests.
The provider selects the manifest for the candidate's channel and operating system.
Publish only after every platform and metadata check passes. Keep updater
metadata attached while installed clients can still select that release.

## Required build configuration

The workflow exports these values into every desktop build:

- `T3CODE_WORKBENCH_BUILD=1`
- `T3_WORKBENCH_JIRA_BROKER_URL=https://workbench-auth.fgutica.workers.dev`
- `T3CODE_DESKTOP_UPDATE_REPOSITORY=${{ github.repository }}`

The updater is restricted to this fork even if another updater repository is
present in the build environment. The preview installs as **T3 Code Workbench**,
using app identifier `com.filipgutica.t3code.workbench`, URL scheme
`t3code-workbench`, and its own `.t3-workbench` data directory. It does not
migrate existing T3 Code data.

Windows packages embed the complete Linux CLI archive used by the upstream
WSL backend. The workflow builds and smoke-tests it on Ubuntu with upstream
`build-cli-archive.ts` and `smoke-cli-archive.ts`, then passes it to the Windows
packager through `--wsl-runtime`. Linux packaging installs
`build-essential`, `libsecret-1-dev`, `pkg-config`, and ImageMagick. Windows
uses the hosted Visual Studio installation, Rust's MSVC target, Python 3, tar,
and the Spectre-mitigated MSVC runtime component.

## Set up Apple signing

After your paid [Apple Developer enrollment](https://developer.apple.com/programs/enroll/)
is active:

1. Create a **Developer ID Application** certificate using
   [Apple's certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates).
   This is for distribution outside the Mac App Store. In Keychain Access,
   export the certificate **with its private key** as a password-protected
   `.p12`. A `.cer` file alone cannot sign the application.
2. Create a team App Store Connect API key for notarization through
   **Users and Access → Integrations → App Store Connect API**. Record its Key
   ID and Issuer ID, and download the `.p8` private key. Follow
   [Apple's API key instructions](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).
3. Add the following repository Actions secrets at
   [Workbench Actions secrets](https://github.com/filipgutica/t3code/settings/secrets/actions).
   Keep private keys and passwords out of chat and Git.

| Actions secret                   | Value                                                  |
| -------------------------------- | ------------------------------------------------------ |
| `WORKBENCH_MAC_CSC_LINK`         | Base64 contents of the Developer ID Application `.p12` |
| `WORKBENCH_MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12`                |
| `WORKBENCH_APPLE_API_KEY`        | Full text of the downloaded `.p8` private key          |
| `WORKBENCH_APPLE_API_KEY_ID`     | API key's Key ID                                       |
| `WORKBENCH_APPLE_API_ISSUER`     | API key's Issuer ID                                    |

The workflow writes the notarization key to a private temporary file and passes
its path to electron-builder's `APPLE_API_KEY`. It removes that file after the
build. These Workbench-only secret names do not configure the upstream release
or mobile workflows.

Run **build-only** with **sign_macos** enabled first. Both Mac architectures
must pass signature verification, Gatekeeper assessment, and notarization
ticket validation. Then create a preview release with the same signing option.
Use the same Apple signing identity for future updates. A valid signing and
update cycle cannot be verified until credentials and two signed versions are
available.

Workbench does not require the upstream Clerk passkey provisioning profile or
associated domains for its current distribution. Configuring those features
later requires a separate identity and entitlement review.

## Future Windows signing

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
future signed workflow; the current preview workflow does not read
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
