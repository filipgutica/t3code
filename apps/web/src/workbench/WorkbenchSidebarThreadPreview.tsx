import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { resolveEnvironmentMachineKind, type ThreadPullRequestLink } from "@t3tools/contracts";
import { BotIcon, FolderGit2Icon, GitBranchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ThreadPullRequestsMiniList } from "../components/ThreadStatusIndicators";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { getTriggerDisplayModelLabel } from "../components/chat/providerIconUtils";
import type { ProviderInstanceEntry } from "../providerInstances";
import type { EnvironmentPresentation } from "../state/environments";
import type { WorkbenchSidebarThread } from "./workbenchSidebar.logic";
import { resolveWorkbenchSidebarRepositoryLabel } from "./workbenchSidebarThread.logic";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

function PreviewMetaRow({
  children,
  icon,
  wrap = false,
}: {
  readonly children: ReactNode;
  readonly icon: ReactNode;
  readonly wrap?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {icon}
      <div className={`min-w-0 ${wrap ? "wrap-break-word" : "truncate"} text-foreground/75`}>
        {children}
      </div>
    </div>
  );
}

export function WorkbenchSidebarThreadPreview({
  thread,
  shell,
  project,
  environment,
  providerEntry,
  pullRequests,
}: {
  readonly thread: WorkbenchSidebarThread;
  readonly shell: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly environment: EnvironmentPresentation | null;
  readonly providerEntry: ProviderInstanceEntry | null;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
}) {
  const visiblePullRequests = visibleThreadPullRequests(pullRequests);

  return (
    <div className="flex min-w-0 max-w-80 flex-col gap-2 p-[var(--floating-content-inset)] text-left">
      <div className="min-w-0 wrap-break-word text-xs font-medium leading-tight text-foreground">
        {thread.title}
      </div>
      <WorkbenchSidebarThreadPreviewDetails
        environment={environment}
        project={project}
        providerEntry={providerEntry}
        shell={shell}
      />
      <WorkbenchSidebarThreadPreviewPullRequests
        pullRequests={pullRequests}
        visiblePullRequests={visiblePullRequests}
      />
    </div>
  );
}

function WorkbenchSidebarThreadPreviewDetails({
  shell,
  project,
  environment,
  providerEntry,
}: {
  readonly shell: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly environment: EnvironmentPresentation | null;
  readonly providerEntry: ProviderInstanceEntry | null;
}) {
  const repositoryLabel = resolveWorkbenchSidebarRepositoryLabel(
    project ? { title: project.title, repositoryIdentity: project.repositoryIdentity } : null,
  );
  const machine = resolveEnvironmentMachineKind(environment?.serverConfig ?? null);
  const selectedModel = shell
    ? providerEntry?.models.find((model) => model.slug === shell.modelSelection.model)
    : undefined;
  const providerLabel =
    providerEntry?.displayName ?? shell?.session?.providerName ?? shell?.modelSelection.instanceId;
  const modelLabel = shell
    ? selectedModel
      ? getTriggerDisplayModelLabel(selectedModel)
      : shell.modelSelection.model
    : null;

  return (
    <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
      {repositoryLabel ? (
        <PreviewMetaRow
          icon={<FolderGit2Icon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />}
        >
          {repositoryLabel}
        </PreviewMetaRow>
      ) : null}
      <PreviewMetaRow
        icon={
          <EnvironmentMachineIcon
            kind={machine}
            className="size-3 shrink-0 stroke-muted-foreground"
          />
        }
      >
        {environment?.label ?? "Environment"}
      </PreviewMetaRow>
      {shell?.branch ? (
        <PreviewMetaRow
          icon={<GitBranchIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />}
          wrap
        >
          {shell.branch}
        </PreviewMetaRow>
      ) : null}
      {shell && modelLabel ? (
        <PreviewMetaRow
          icon={
            providerEntry ? (
              <ProviderInstanceIcon
                driverKind={providerEntry.driverKind}
                displayName={providerEntry.displayName}
                iconClassName="size-3 shrink-0 grayscale opacity-70"
              />
            ) : (
              <BotIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />
            )
          }
        >
          {providerLabel} · {modelLabel}
        </PreviewMetaRow>
      ) : null}
    </div>
  );
}

function WorkbenchSidebarThreadPreviewPullRequests({
  pullRequests,
  visiblePullRequests,
}: {
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly visiblePullRequests: ReadonlyArray<ThreadPullRequestLink>;
}) {
  if (visiblePullRequests.length === 0) return null;
  return (
    <div className="border-border/60 border-t pt-2 pl-0.5 text-xs text-muted-foreground">
      <ThreadPullRequestsMiniList pullRequests={pullRequests} />
    </div>
  );
}
