# Workbench desktop releases

Use [Workbench daily desktop release](../../.github/workflows/workbench-daily-release.yml)
on main to publish a nightly or stable. Choose the channel and Workbench version bump;
leave upstream_tag blank for an own release. Both release the main HEAD captured for
that run, even if it has already shipped or an upstream sync has conflicts.

The only release gate is successful Workbench feature CI and Workbench quality on
that exact commit. The shared build workflow waits for those results. It does not
select an older checkpoint or require an upstream baseline, ancestry, or tag recheck.

The upstream sync workflow fetches the latest published pingdotgg/t3code tag. Once
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
leaves an already published release unchanged.

The explicit build workflow retains unsigned-preview drafts and build-only artifacts
for build validation. These are separate from the normal nightly and stable release action.

The daily schedule remains every six hours at 02:17, 08:17, 14:17 and 20:17
America/Vancouver. GitHub can delay scheduled runs. Manual runs are available at any
time; automatic sync requests and manual releases share the same build workflow.

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
