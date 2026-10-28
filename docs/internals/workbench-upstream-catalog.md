# Workbench upstream catalog

This catalog records changes to upstream-owned files and Workbench copies of native behavior. Each purpose states the current gap and removal condition. [Upstream first](workbench-fork.md#upstream-first) sets the rules; an existing exception does not authorize another one.

Before adding an exception, record it in the same PR. A copy of native behavior also needs maintainer sign-off. During upstream sync, check the removal conditions against new native capabilities. The goal is to run Workbench as a T3 Code extension.

**Status:** _Recorded_ documents an existing merged exception; it does not certify that the exception is still necessary. _Debt_ means Workbench can retire it without waiting for an upstream capability. The Workbench maintainer owns every row and its follow-up. There are no unassigned baseline entries.

## Baseline and coverage

The baseline is product commit `3c652eba1040b6cf198e6697f52277f8bd20ea31`, compared with integrated upstream `570d4b03eef879bd60be3d74444046858c94dacd`. `node scripts/workbench-isolation.ts --report` reports 203 paths outside the fork boundary: 135 upstream-owned paths, 67 fork-added paths, and one generated lockfile. Deleted workflow paths count separately from their archived destinations.

The purpose rows below explain the exceptions. [Baseline path coverage](#baseline-path-coverage) assigns every report path to one primary purpose, including tests, deleted paths, and fork-added support files. A file can serve several purposes: notably `ChatView.tsx` also carries planning controls and cross-environment PR handling, and `Orchestrator.ts` also carries repository binding. The [isolation policy](../../scripts/workbench-isolation-policy.json) separately records exact runtime import allowances; it does not cover all native patches.

The inventory changes only this fork-owned document. Existing upstream sites receive no new comments. Add a purpose/removal comment when a later implementation changes a site, as required by upstream-first guidance.

## Upstream changes

| ID  | Purpose and evidence                                                                                                                                                                                                                          | Why upstream cannot own it today                                                                                                                                                                                                     | Remove when                                                                                                                                                     | Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| U01 | Host composition: server layers, Workbench RPC scopes and metrics, MCP registration and budget, contract exports, web root/route registration. Exact import sites are in the isolation policy.                                                | Native composition has no external registry for these services, RPC contracts, MCP toolkits, routes, and root providers.                                                                                                             | Native extension registration owns these integrations, including authorization and metrics metadata.                                                            | Recorded |
| U02 | Independent desktop distribution: product selection, profile paths, legacy storage imports, WSL home, protocol/CORS/auth return schemes, update feed and release links, npm-server update restrictions, build packaging.                      | Workbench ships a separate app and cannot use upstream identity, state, or updater. Native mechanics read an immutable product descriptor; web slots select fork release policy.                                                     | Workbench runs inside the upstream app as an extension, or native distribution configuration covers each identity and update hook.                              | Recorded |
| U03 | Archive inherited release, relay, mobile, and preview workflows; redirect the relay-output test to the archived source.                                                                                                                       | Those workflows target upstream products and secrets. GitHub discovers only the active workflow directory; preserving YAML under the archive retains sync ancestry.                                                                  | Workbench no longer forks the repository, or each restored trigger has explicit fork deployment ownership.                                                      | Recorded |
| U04 | Thread repository binding: `ThreadRepositoryBinding.ts`, metadata command schema fields, and dispatch integration.                                                                                                                            | Rebinding a planning Thread must validate expected project/worktree and idle state inside native dispatch serialization, clear stale PR binding, and detach sessions. Adapter prechecks cannot provide that atomic boundary.         | Native metadata/rebind commands support the same checked Project/worktree transition and session invalidation.                                                  | Recorded |
| U05 | Drafting runtime policy and per-turn Ticket context: policy decorator, instructions before provider input (except native goal commands), optional checkpoint scopes, replay-layer injection.                                                  | Native Threads do not expose host-supplied per-turn context or a checkpoint-free planning mode. Checkpoint lifecycle must remain native; Workbench supplies the policy.                                                              | Native policy extensions supply instructions and checkpoint selection across dispatch, restart, release, and finalization.                                      | Recorded |
| U06 | Legacy research/read-only execution: Claude query decorator, Codex sandbox preparation and approval branches, provider tool-access type, MCP read-only credentials and rotation. ACP-registry, FX, and OpenCode drivers reject research mode. | These were introduced for constrained drafting, but current `TicketPlanningRuntime` selects Auto/default and adds no research or read-only override. The residual generic restriction machinery is not a current Ticket requirement. | Follow-up verifies remaining non-Workbench callers and removes unused research/read-only additions; retain any independently required native behavior. See F02. | Debt     |
| U07 | Ticket-owned checkout lifecycle: native Git fetch exposure, cleanup policy, and `preserveWorktree` Thread deletion option.                                                                                                                    | Native cleanup cannot infer that several Threads share a Ticket-owned worktree. Workbench owns preparation/release; native Git and deletion still perform host operations.                                                           | Native workspace ownership/lease extensions preserve an external owner's checkouts and expose the required Git operations.                                      | Recorded |
| U08 | Caller-owned structured generation: shared provider interface/runner, managed Codex wrapper, OpenCode operation names, explicit Muse unsupported result, and native Git test doubles.                                                         | Native generation exposes fixed operations, not arbitrary schema-validated Ticket summary and Thread recap prompts. Workbench already reuses its provider runners.                                                                   | Native text generation accepts caller-owned prompt, schema, model, and operation name with equivalent provider error handling.                                  | Recorded |
| U09 | Embedded native chat: `ChatView` embedding props, header hiding, host-controlled focus, disabled global shortcuts/panels, terminal handoff; composer planning controls and Open-in shortcut labels.                                           | Native chat assumes ownership of the full Thread page. Board/Ticket and draft hosts need the same conversation without taking over the containing page.                                                                              | Native embeddable chat supports host focus, navigation, panel actions, and control visibility. R24's remaining file/diff handoffs are PR 5 work.                | Recorded |
| U10 | Sidebar/Thread/palette composition and presentation: host slots, hidden draft Threads, notification filtering, Thread breadcrumbs and preparation gates, filtered native action menus, exported PR badge presentation.                        | Native navigation is Project/Thread based; it cannot group by Ticket or distinguish hidden preparation Threads from notification-eligible saved planning Threads.                                                                    | Native navigation/notification extensions accept external grouping, visibility, actions, breadcrumbs, and route gates.                                          | Recorded |
| U11 | Ticket context in native composer: attachment slot, hidden duplicate reference chips, title fallback, and assistant message identity forwarding.                                                                                              | Ticket context currently travels as review-comment context; native rendering assumes PR review comments and cannot render an arbitrary domain attachment. Message identity also served the old fenced-block hook (U14).              | Native typed composer-context extensions provide Ticket previews and titles; remove unused message plumbing with F01 where possible.                            | Recorded |
| U12 | PR previews in the owning environment: explicit environment precedence in Markdown/link handling, contextual page opener, cross-environment panel pinning/retarget protection, and repository-wide link availability.                         | Native Thread panels otherwise inherit the Thread environment and navigation destination. Ticket content can refer to another environment or require a preview over the current page.                                                | Native content/link/panel APIs preserve an explicit source environment and a host-selected destination across nested PR navigation.                             | Recorded |
| U13 | Shared UI variants: `accent-soft` button and `inline` popover trigger.                                                                                                                                                                        | Existing variants lack the Ticket attention toggle and inline context-preview appearances; shared components own these generic looks.                                                                                                | Native variants cover both appearances and Workbench callers migrate to them.                                                                                   | Recorded |
| U14 | Fenced-block renderer context in `ChatMarkdown.tsx`, completion metadata, and message-id plumbing.                                                                                                                                            | The former proposal-card integration left an extension with no production provider; a test-only provider remains in `workbench/native/ChatMarkdown.browser.test.tsx`. No current upstream gap requires it.                           | Follow-up removes the unused renderer and any exclusively supporting props. See F01.                                                                            | Debt     |
| U15 | Repository build/quality wiring: package dependencies/scripts, Workbench-only lint/test allowances, effect budgets, Knip entrypoints, Playwright exclusion, build defines and lockfile; ignored test output and vendored Git-link metadata.   | The workspace must discover, build, and check the fork overlay. Existing test/style warning overrides are migration debt, not a native feature gap.                                                                                  | An external extension owns its build/test configuration; retire warning overrides sooner when those tests/styles satisfy native rules.                          | Recorded |
| U16 | Fork guidance, user/release documentation, synthetic media and Workbench eval setup/cases.                                                                                                                                                    | Upstream docs and eval entrypoints cannot describe/register an overlay absent from its tree. The MCP guide also documents a native delegate-worktree capability already present in the integrated baseline; see F04.                 | Extension-owned docs/eval registration replaces shared entrypoints; remove stale fork-only guidance as its behavior is retired.                                 | Recorded |
| U17 | Demo executable lookup: `T3CODE_PATH_PREPEND` survives login-shell PATH hydration in `os-jank.ts`.                                                                                                                                            | Synthetic attention fixtures need their credential-free CLI adapter to precede installed executables after native PATH hydration.                                                                                                    | Native launch configuration supports a preserved explicit executable search prefix, or demo injection no longer needs PATH precedence.                          | Recorded |
| U18 | Effect return-type compatibility in `HostPowerMonitor.ts` and `NativeTelemetryClient.ts`: append `Effect.asVoid` to PubSub/Deferred branches.                                                                                                 | These are retained core typing adjustments, not Workbench behavior. They do not justify further fork core fixes.                                                                                                                     | A compatible upstream source change makes these residuals disappear; compare upstream before cherry-picking or reverting.                                       | Recorded |
| U19 | Obsolete Jira/1Password development examples in `.env.example`.                                                                                                                                                                               | No current gap: Workbench uses References and agents' own connectors; no tracked runtime consumes these keys.                                                                                                                        | Remove the obsolete examples in a scoped documentation follow-up. See F03.                                                                                      | Debt     |
| U20 | Query-result identity in `state/query.ts` for attention refresh and `WorkbenchQueryError`.                                                                                                                                                    | Native query views expose data/error but not the result object needed to distinguish a completed refresh from stale cached data.                                                                                                     | Native query views expose a refresh/result identity or completion marker usable by these consumers.                                                             | Recorded |

## Workbench copies and workarounds of native behavior

This sweep covers production files in `apps/web/src/workbench`, `apps/server/src/workbench`, and `packages/workbench`. These rows include partial behavioral copies and workarounds, not only identical source. Tests under `workbench/native/` exercise native integrations; they are not alternate production implementations.

| ID  | Exception and native equivalent                                                                                                                                                                                                                                                                           | Current gap or debt                                                                                                                                                                                                  | Remove when                                                                                                                                                                     | Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C01 | `WorkbenchReferenceFileSheet.tsx` reads text/Markdown and uses native `PreviewImage` for images with an owner Thread. Equivalent: native `FilePreviewPanel` and file browser in `RightPanelTabs`.                                                                                                         | No panel-hosting gap: native `PullRequestsPage` already uses `PULL_REQUESTS_PANEL_REF`. The sheet still lacks folder/HTML handling and Thread-free images.                                                           | PR 5 mounts the native panel/viewer, verifies Reference roots and assets without a Thread, then removes the sheet.                                                              | Debt     |
| C02 | `WorkbenchPullRequestSheet.tsx` wraps native `PullRequestDetailPanel`; `workbenchPullRequestSheet.css` disables the desktop drag region. Equivalent: native right panel title-bar ownership.                                                                                                              | No upstream gap for hosting the details. The workaround exists because the sheet crosses the desktop drag strip.                                                                                                     | PR 5 mounts the native right panel and removes the sheet/CSS after desktop verification.                                                                                        | Debt     |
| C03 | `WorkbenchSidebarThreadRow.tsx`, `.logic.ts`, and `WorkbenchSidebarRows.css` reproduce native `sidebar/SidebarThreadRow.tsx` presentation/rename/row interaction.                                                                                                                                         | Native row composition assumes the Project hierarchy. Workbench adds Ticket nesting, attention, and floating-chat navigation. Lifecycle/menu actions and PR badge resolution already reuse native helpers.           | Native row slots accept Ticket hierarchy, attention content, and host-selected navigation without copying the row; migrate the remaining presentation.                          | Recorded |
| C04 | `WorkbenchThreadExecutionStatus.tsx` and `.logic.ts` duplicate native sidebar status icons/labels and the private `WorkingDuration` renderer. `workbenchThreadStatus.logic.ts` reuses native status resolution and working-start time.                                                                    | Native duration component is private; Workbench needs labeled/compact status on Board and Ticket rows. Ticket priority aggregation is domain logic, not a native copy.                                               | Native status/duration presentation is reusable across surfaces, or existing `ThreadStatusIndicators` exports can satisfy each caller. Check presentation reuse first; see F05. | Recorded |
| C05 | `WorkbenchComposerPendingReviewComments.tsx` and `WorkbenchTicketContextPreview.tsx` parallel native `composerContextPresentation.tsx` review-comment chips/details.                                                                                                                                      | Workbench overloads review comments with Ticket context and splits a Ticket preamble from its brief. Native PR review details do not know that format.                                                               | Native extensible context records render Ticket payloads; then retire the review-comment disguise and duplicate chip/details.                                                   | Recorded |
| C06 | `WorkbenchDescription.tsx` and `workbenchDescription.logic.ts` render brief Markdown and adapt Jira wiki text. Equivalent: native `ChatMarkdown`.                                                                                                                                                         | Jira conversion is legacy compatibility; the brief renderer also uses ordinary external links rather than Thread file/asset handling. It duplicates Markdown styling/render setup.                                   | Remove obsolete Jira conversion with tracker cleanup; use a native document renderer when it can retain brief link semantics without requiring Thread context.                  | Recorded |
| C07 | `WorkbenchPullRequestPicker.tsx` browses/searches PRs and resolves numbers across environment repositories. Equivalent: native `pullRequest/LinkPullRequestDialog.tsx`.                                                                                                                                   | Native dialog accepts a URL or a number in the Thread repository; Workbench adds environment-wide browsing/number lookup. Mutation, URL parsing, project resolution, and queries already reuse native code.          | Native picker supports environment-wide search/number lookup and is callable for an assigned Thread.                                                                            | Recorded |
| C08 | `WorkbenchStartThreadDialog.tsx`, `usePlanningModelSelection.ts`, and `workbenchTicketDraft.logic.ts` repeat new-Thread model candidate/fallback ordering around native selectors. Equivalent: `useHandleNewThread.ts`.                                                                                   | Workbench has no current Thread to carry forward and reviews several repositories before creating/starting a Thread. Project/environment default resolution already uses native `resolveProjectSettings` after #208. | Native model-selection helper supports an explicit target Project and no current Thread; migrate ordering while retaining draft-provider support checks.                        | Recorded |
| C09 | `packages/workbench/src/TicketWorkspaceService.ts` owns branch selection, checkout preparation/rollback/release around native Git. Server `TicketWorkspaceService.ts` and `TicketWorkspacePullRequestResolver.ts` adapt native services. Equivalent: native workspace preparation for Thread launch/fork. | Native preparation owns one Thread checkout; Tickets share and retain coordinated checkouts across repositories and Threads. Native Git commands and branch formatter are reused.                                    | Native externally owned multi-repository checkout lifecycle supplies preparation, retry/rollback, and retention independently of a Thread.                                      | Recorded |
| C10 | `TicketPlanningRuntime.ts` builds planning policy/instructions; `providers/ClaudeResearchPolicy.ts` reproduces restricted tool/permission selection. Equivalent: native runtime policy and Claude query construction.                                                                                     | Ticket context and checkpoint selection need U05. The older research/read-only decoration is no longer selected by current drafting policy (U06).                                                                    | Retain context through a native policy extension; separately remove unselected restrictions after F02's caller check.                                                           | Debt     |
| C11 | `WorkbenchFloatingChat.tsx` and its size/state/picker helpers recreate a window around native `ChatView`. Equivalent: native Thread page/panel host.                                                                                                                                                      | Native conversation is reused, including provider execution and composer. The additional shell owns Ticket-local selection, resizing, and focus; native has no movable embedded conversation host.                   | Native embedded conversation host supports these controls and R24's in-page panels, so Workbench keeps only Ticket selection.                                                   | Recorded |

`packages/workbench` stores Workbench records, not copies of native Projects or Threads. `WorkbenchNativeAccess` supplies native reads, including the caller's SQL transaction. Draft creation/start/discard uses native orchestration through the server `TicketDraftService` adapter. Summary/recap services call native `TextGeneration.generateStructured`; no provider runner is copied. Settlement and Thread deletion use native commands/actions; Ticket aggregation and Assignment history remain domain rules. These are composition, not additional copy exceptions.

## Follow-up candidates

These are evidence-backed removal candidates, not removals or authorization to widen this PR. Recheck callers at the follow-up head.

| ID  | Evidence at baseline                                                                                                                                                                                                                                                                                                           | Smallest follow-up and limit                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | `rg -n 'ChatMarkdownCodeBlockRendererContext' apps packages` finds its declaration/read in `ChatMarkdown.tsx` and a test-only provider in `workbench/native/ChatMarkdown.browser.test.tsx`. No production provider supplies it after proposal-card removal. `messageId` is forwarded by `TimelineAssistantRows` for this hook. | Remove U14 and exclusively supporting code; assess the obsolete proposal-hook test with that removal. Preserve the native code-fence renderer and other Markdown behavior.                           |
| F02 | `TicketPlanningRuntime.resolveTicketPolicy` spreads native policy and sets Auto/default, checkpoint suppression, and instructions. No production Workbench file assigns research tool access or read-only sandbox policy. Claude's decorator returns an empty override for normal native policy.                               | Audit U06's remaining native callers and tests, then remove only unreachable legacy additions. Do not remove native read-only-client authorization or assume all generic sandbox support is unused.  |
| F03 | `rg -n 'T3_WORKBENCH_JIRA' --glob '!pnpm-lock.yaml'` finds the obsolete `.env.example` examples, with no runtime consumer.                                                                                                                                                                                                     | Delete stale Jira setup guidance. No credential lookup, migration, or connector change is needed.                                                                                                    |
| F04 | The fork's MCP guide adds `isolation: "worktree"` documentation, but integrated upstream `mcp/toolkits/orchestrator/tools.ts` already advertises worktree isolation; `packages/contracts/src/orchestratorMcp.ts` defines it and `ThreadLaunchService.ts` prepares child worktrees.                                             | Compare the native guide at the follow-up upstream ref. Revert the residual if redundant, or contribute the missing documentation upstream. This capability is native, not a Workbench gap.          |
| F05 | `WorkbenchThreadExecutionStatus` repeats status presentation while native `ThreadStatusIndicators.tsx` exports `ThreadStatusLabel`; `workbenchThreadStatus.logic.ts` already calls `resolveSidebarThreadStatus`. Native `WorkingDuration` remains private.                                                                     | Compare each Board/sidebar compact variant with native exports. Reuse what fits; request a native duration extension only for the remaining gap. No claim of a drop-in replacement for every caller. |
| F06 | C01/C02 use sheets, while `PullRequestsPage.tsx` already hosts `RightPanelTabs` without a Thread. The Reference sheet now handles images, so its earlier text-only catalog description was stale.                                                                                                                              | Keep the already planned PR 5 migration. Native hosting fits now; Thread-free assets and desktop hit-testing still require proof before deleting the wrappers.                                       |

## Baseline path coverage

The groups below are a fixed snapshot for review, not a second ownership policy. Regenerate the isolation report after upstream sync and assign new residual paths to their purpose. Paths are repository-relative; archived/deleted paths are intentional and are not links.

### U01

- `apps/server/src/auth/RpcAuthorization.ts`
- `apps/server/src/mcp/McpHttpServer.ts`
- `apps/server/src/observability/RpcInstrumentation.ts`
- `apps/server/src/provider/agentContextBudget.json`
- `apps/server/src/provider/AgentContextBudget.test.ts`
- `apps/server/src/server.ts`
- `apps/server/src/ws.ts`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routeTree.gen.ts`
- `packages/contracts/src/clientRpcPermissions.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/rpc.ts`

### U02

- `apps/desktop/src/app/DesktopClerk.ts`
- `apps/desktop/src/app/DesktopEarlyElectronStartup.ts`
- `apps/desktop/src/app/DesktopEnvironment.ts`
- `apps/desktop/src/app/DesktopLegacyLocalStorage.ts`
- `apps/desktop/src/app/DesktopProduct.ts`
- `apps/desktop/src/app/DesktopStatePaths.ts`
- `apps/desktop/src/app/DesktopUserData.ts`
- `apps/desktop/src/backend/DesktopBackendConfiguration.ts`
- `apps/desktop/src/electron/ElectronProtocol.ts`
- `apps/desktop/src/updates/DesktopUpdates.ts`
- `apps/desktop/vite.config.ts`
- `apps/server/src/httpCors.ts`
- `apps/server/src/provider/providerCompatibility.ts`
- `apps/web/src/components/desktopUpdate.logic.ts`
- `apps/web/src/components/desktopUpdate.toast.tsx`
- `apps/web/src/components/ServerUpdateAction.tsx`
- `apps/web/src/components/settings/CodexSetupSection.tsx`
- `apps/web/src/components/settings/SavedEnvironmentRows.tsx`
- `apps/web/src/components/sidebar/SidebarUpdatePill.tsx`
- `apps/web/src/components/sidebar/SidebarUpdateReleaseNotes.tsx`
- `apps/web/src/components/sidebar/useUpdateEverything.ts`
- `packages/shared/src/codexAuthHandoff.ts`
- `packages/shared/src/codexAuthHandoff.workbench.test.ts`
- `packages/shared/src/providerAuthReturnUrl.ts`
- `packages/shared/src/providerAuthReturnUrl.workbench.test.ts`
- `scripts/build-desktop-artifact.ts`
- `scripts/build-desktop-artifact.workbench.test.ts`
- `scripts/lib/desktop-build-product.ts`
- `scripts/release-smoke.ts`
- `scripts/resolve-workbench-daily-release.test.ts`
- `scripts/resolve-workbench-daily-release.ts`
- `scripts/update-release-package-versions.workbench.test.ts`

### U03

- `.github/scripts/relay-state-output.test.cjs`
- `.github/upstream-workflows/agent-context-budget.yml`
- `.github/upstream-workflows/deploy-relay.yml`
- `.github/upstream-workflows/desktop-macos-preview-publish.yml`
- `.github/upstream-workflows/desktop-macos-preview.yml`
- `.github/upstream-workflows/mobile-android-apk.yml`
- `.github/upstream-workflows/mobile-eas-preview.yml`
- `.github/upstream-workflows/mobile-eas-production.yml`
- `.github/upstream-workflows/mobile-fingerprint-check.yml`
- `.github/upstream-workflows/README.md`
- `.github/upstream-workflows/relay-preview-cleanup.yml`
- `.github/upstream-workflows/relay-preview.yml`
- `.github/upstream-workflows/release.yml`
- `.github/upstream-workflows/stale-needs-more-info.yml`
- `.github/workflows/agent-context-budget.yml`
- `.github/workflows/deploy-relay.yml`
- `.github/workflows/desktop-macos-preview-publish.yml`
- `.github/workflows/desktop-macos-preview.yml`
- `.github/workflows/mobile-android-apk.yml`
- `.github/workflows/mobile-eas-preview.yml`
- `.github/workflows/mobile-eas-production.yml`
- `.github/workflows/mobile-fingerprint-check.yml`
- `.github/workflows/relay-preview-cleanup.yml`
- `.github/workflows/relay-preview.yml`
- `.github/workflows/release.yml`
- `.github/workflows/stale-needs-more-info.yml`

### U04

- `apps/server/src/orchestration-v2/ThreadRepositoryBinding.ts`
- `packages/contracts/src/orchestrationV2.ts`

### U05

- `apps/server/src/orchestration-v2/Orchestrator.ts`
- `apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts`
- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`
- `apps/server/src/orchestration-v2/RunExecutionService.ts`
- `apps/server/src/orchestration-v2/RuntimePolicy.ts`
- `apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts`

### U06

- `apps/server/src/mcp/McpInvocationContext.ts`
- `apps/server/src/mcp/McpSessionRegistry.ts`
- `apps/server/src/mcp/McpToolAccess.ts`
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`
- `apps/server/src/orchestration-v2/Adapters/CodexSandboxPolicy.test.ts`
- `apps/server/src/orchestration-v2/Adapters/CodexSandboxPolicy.ts`
- `apps/server/src/orchestration-v2/ProviderSessionManager.ts`
- `packages/provider-acp-registry/src/server/driver.ts`
- `packages/provider-core/src/server/ProviderAdapter.ts`
- `packages/provider-fx/src/server/driver.ts`
- `packages/provider-opencode/src/server/driver.ts`

### U07

- `apps/server/src/git/GitWorkflowService.ts`
- `apps/server/src/storageCleanup.ts`
- `apps/server/src/workspace/WorkspaceCleanupPolicy.ts`
- `apps/web/src/hooks/useThreadActions.ts`

### U08

- `apps/server/src/git/GitManager.test.ts`
- `apps/server/src/provider/Drivers/CodexManagedProvider.ts`
- `apps/server/src/textGeneration/TextGeneration.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/settingsSearch.ts`
- `packages/provider-core/src/server/textGeneration.ts`
- `packages/provider-core/src/server/textGenerationOperations.test.ts`
- `packages/provider-core/src/server/textGenerationOperations.ts`
- `packages/provider-muse/src/server/textGeneration.ts`
- `packages/provider-muse/src/server/textGeneration.workbench.test.ts`
- `packages/provider-opencode/src/server/textGeneration.ts`
- `packages/provider-opencode/src/server/textGeneration.workbench.test.ts`

### U09

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/ComposerControlsBar.tsx`
- `apps/web/src/components/chat/ComposerFooterControls.tsx`
- `apps/web/src/components/chat/OpenInPicker.tsx`
- `apps/web/src/components/ChatView.tsx`

### U10

- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/appInit.tsx`
- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/CommandPaletteLookups.ts`
- `apps/web/src/components/CommandPaletteThreadItems.tsx`
- `apps/web/src/components/LegacySidebar.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/sidebar/SidebarChrome.tsx`
- `apps/web/src/components/ThreadNotificationCoordinator.tsx`
- `apps/web/src/components/ThreadRouteView.tsx`
- `apps/web/src/components/ThreadStatusIndicators.tsx`
- `apps/web/src/hooks/useThreadActionMenu.ts`
- `apps/web/src/hostIntegrations.test.tsx`
- `apps/web/src/hostIntegrations.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`

### U11

- `apps/web/src/components/chat/TimelineAssistantRows.tsx`
- `apps/web/src/components/chat/useComposerSend.ts`
- `apps/web/src/components/composerContextPresentation.tsx`

### U12

- `apps/web/src/components/chat/RightPanelSurfaceContent.tsx`
- `apps/web/src/components/ChatMarkdown.pull-request-environment.test.tsx`
- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/components/ChatView.logic.ts`
- `apps/web/src/components/pullRequest/PullRequestThreadLinks.tsx`
- `apps/web/src/hooks/useProactivePanels.ts`
- `apps/web/src/hooks/usePullRequestLinking.test.tsx`
- `apps/web/src/hooks/usePullRequestLinking.ts`
- `apps/web/src/lib/openPullRequestLink.ts`
- `apps/web/src/rightPanelStore.ts`

### U13

- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/popover.tsx`

### U15

- `.fallowrc.jsonc`
- `.gitignore`
- `.gitmodules`
- `apps/server/package.json`
- `apps/web/package.json`
- `apps/web/src/vite-env.d.ts`
- `apps/web/vite.config.ts`
- `knip.jsonc`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `scripts/effect-budget.json`
- `scripts/package.json`
- `scripts/setup-worktree.test.ts`
- `scripts/tsconfig.json`
- `vite.config.ts`

### U16

- `.agents/skills/workbench-demo/SKILL.md`
- `.agents/skills/workbench-isolation-review/SKILL.md`
- `.agents/skills/workbench-isolation/SKILL.md`
- `.agents/skills/workbench-regression-checklist/references/checklist.md`
- `.agents/skills/workbench-regression-checklist/SKILL.md`
- `.agents/skills/workbench-visual-spot-check/references/checklist.md`
- `.agents/skills/workbench-visual-spot-check/SKILL.md`
- `AGENTS.md`
- `docs/operations/release.md`
- `docs/operations/workbench-release.md`
- `docs/operations/workbench-verification.md`
- `docs/orchestration-v2/orchestrator-mcp-server.md`
- `docs/README.md`
- `docs/user/agent-workbench.md`
- `docs/user/media/workbench/board-chat-light.png`
- `docs/user/media/workbench/board-chat.png`
- `docs/user/media/workbench/board-draft-light.png`
- `docs/user/media/workbench/board-draft.png`
- `docs/user/media/workbench/board-light.png`
- `docs/user/media/workbench/board.png`
- `docs/user/media/workbench/notifications-light.png`
- `docs/user/media/workbench/notifications.png`
- `docs/user/media/workbench/planning-light.png`
- `docs/user/media/workbench/planning.png`
- `docs/user/media/workbench/pull-request-light.png`
- `docs/user/media/workbench/pull-request.png`
- `docs/user/media/workbench/thread-light.png`
- `docs/user/media/workbench/thread.png`
- `docs/user/media/workbench/ticket-chat-light.png`
- `docs/user/media/workbench/ticket-chat.png`
- `docs/user/media/workbench/ticket-light.png`
- `docs/user/media/workbench/ticket.png`
- `docs/user/media/workbench/workspace-light.png`
- `docs/user/media/workbench/workspace.png`
- `evals/mcp-tool-use/cases/workbench.ndjson`
- `evals/mcp-tool-use/README.md`
- `evals/mcp-tool-use/run.ts`
- `infra/relay/README.md`
- `PRIVACY.md`
- `README.md`

### U17

- `apps/server/src/os-jank.ts`

### U18

- `apps/server/src/background/HostPowerMonitor.ts`
- `apps/server/src/resourceTelemetry/NativeTelemetryClient.ts`

### U19

- `.env.example`

### U20

- `apps/web/src/state/query.ts`

## Adding or retiring an entry

Add a purpose row in the PR that introduces the exception. Name the native capability that would remove it. Add the short purpose/removal comment at each new or changed upstream site; do not bulk-annotate untouched baseline sites. A Workbench copy also names its native equivalent and needs sign-off before implementation.

When an exception is removed, delete its purpose/copy row if no sites remain, and update its baseline path coverage. Keep the exhaustive current list in the isolation report rather than treating this snapshot as a gate.
