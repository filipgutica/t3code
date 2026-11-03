# Workbench desktop releases

Use [Workbench daily desktop release](../../.github/workflows/workbench-daily-release.yml)
on main to publish a nightly or stable. Choose the channel and Workbench version bump;
leave upstream_tag blank for an own release. Both release the main HEAD captured for
that run, even if it has already shipped or an upstream sync has conflicts.

The only release gate is successful Workbench feature CI and Workbench quality on
that exact commit. The shared build workflow waits for those results. It does not
select an older checkpoint or require an upstream baseline, ancestry, or tag recheck.

The upstream sync workflow fetches the requested published pingdotgg/t3code tag (or
the latest publication when no tag is supplied). Once
integrated, it requests the matching Workbench channel and bump type. Workbench
version numbers remain independent. Release metadata records the upstream event so
scheduled retries do not publish it twice; an own release remains available.

Conflicting syncs fail with their published pin and conflict paths in the job summary
and preview artifact. The standing sync agent resolves them in a PR, lists the
resolutions, and tells the maintainer. Low-risk repairs use independent sol-loop
review before merging; substantial or high-risk conflicts go to the maintainer.
A conflicted sync does not block an own nightly or stable release.

## Build and publication

[Workbench desktop release](../../.github/workflows/workbench-release.yml) contains
the shared four-platform build and can also be run with an explicit Workbench version.
It checks out the exact source once, builds macOS arm64 and x64, Linux x64, and
Windows x64, and generates release notes and checksums. Normal releases sign and
notarize both macOS builds. Signing failures fail the build; they do not fall back
to unsigned Mac updates. Windows and Linux builds remain unsigned.

A complete nightly publishes as a prerelease using workbench-daily-vX.Y.Z-nightly.DATE.RUN.
A stable publishes as latest using workbench-vX.Y.Z. All platform artifacts and updater
feeds are uploaded and checksummed before publication. No separate Stable approval
or promotion workflow is required. Rerunning a publication retains its version and
leaves an already published release unchanged. An unpublished draft and its tag are
replaced before uploading, so the new source, notes and complete asset set agree.
An interrupted upstream event retains its allocated version across workflow runs.

The explicit build workflow retains unsigned-preview drafts and build-only artifacts
for build validation. These are separate from the normal nightly and stable release action.

## Maintenance task

The native T3 task **Workbench upstream sync and releases** polls every six hours.
Each trigger creates a fresh top-level Codex GPT-6.1-Sol thread in Auto mode and a
worktree from fork `origin/main`. The GitHub hourly sync and daily-release cron
triggers are removed; those workflows remain dispatchable helpers. The old dot
schedule and archived cloud maintenance tasks stay retired. Keep the Codex GitHub
reviewer enabled.

The task is stored in this machine's T3 userdata database and dispatched by the T3
server's scheduler, including when no conversation turn is active. This is local
execution: the computer must be awake and the server running. It does not wake a
sleeping or powered-off computer. Overdue interval work is picked up when the
server resumes; interrupted dispatches are recorded as failed. Scheduled-task
success proves a thread was launched, not that its release completed.

The [maintenance state issue](https://github.com/filipgutica/t3code/issues/236) is the
durable queue, ownership and handled-release record. Each run reads its live body,
checks active owners and in-flight Actions, and queues every new published release
after the recorded bootstrap in publication order. Do not collapse the queue to
the latest tag. Store the tag/SHA, PR and review head, workflow run, allocated
version and release ID before advancing. Reconcile uncertain dispatches before
retrying; mark an event handled only after actual publication, successful signing,
and the expected installers, update manifests, build metadata and checksums.

Read and apply Engineering, Workbench isolation, the release procedure, and relevant
smoke/visual skills before acting; naming a skill does not activate it. Conflicted
syncs require a PR listing resolutions, affected integration/smoke checks and an
independent filip-stack sol-loop review on the exact final head. Merge with a merge
commit after applicable CI and enforced requirements pass, with no unresolved
findings, then verify main CI. An independent review is not a formal GitHub approval.
For substantial or high-risk conflicts, leave a PR and a self-contained continuation
prompt for the maintainer. Preserve prepared work and other agents' branches.

Report completed releases, resolved-conflict PRs, meaningful failures and high-risk
handoffs. Stay quiet on unchanged checks. Pause or delete the task in T3 Settings
under Scheduled tasks to stop future triggers; already launched threads and GitHub
runs must be stopped separately when needed. No additional service is installed.

Manual releases remain available independently of sync progress:

```sh
gh workflow run workbench-daily-release.yml --repo filipgutica/t3code --ref main -f channel=nightly -f bump=patch
gh workflow run workbench-daily-release.yml --repo filipgutica/t3code --ref main -f channel=stable -f bump=patch
```

For an upstream event, supply its exact `upstream_tag` to
`workbench-upstream-sync.yml`. The helper requests the corresponding release after
integration. Repeated upstream numeric bases use `none` to avoid a second bump.

workbench-release.json and the release body record the source, version, channel,
run identity, and upstream event when applicable. Workflow changes take effect after
review and merge into main.

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
