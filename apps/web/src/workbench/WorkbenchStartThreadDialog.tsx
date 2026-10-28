import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ServerProvider,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useState, type FormEvent } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { TraitsPicker } from "../components/chat/TraitsPicker";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import type { Project } from "../types";
import { WorkbenchRepositoryScopeFields } from "./WorkbenchRepositoryScopeFields";
import {
  getWorkbenchRepositoryScope,
  isWorkbenchRepositoryScopeEqual,
  isWorkbenchRepositoryScopeValid,
  isWorkbenchTicketWorkspaceReady,
  type WorkbenchRepositoryScope,
} from "./workbenchRepositoryScope";

function resolveWorkbenchStartThreadSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ModelSelection | null {
  const entry = entries.find(
    (candidate) =>
      isProviderInstancePickerReady(candidate) &&
      candidate.models.some((model) => model.slug.length > 0),
  );
  const model =
    entry?.models.find((candidate) => candidate.isDefault && !candidate.isCustom)?.slug ??
    entry?.models.find((candidate) => !candidate.isCustom)?.slug ??
    entry?.models[0]?.slug;
  return entry && model ? createModelSelection(entry.instanceId, model) : null;
}

type WorkbenchModelOption = {
  readonly slug: string;
  readonly isUnavailable?: boolean | undefined;
};

function isWorkbenchStartThreadSelectionAvailable(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  selection: ModelSelection | null | undefined,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<WorkbenchModelOption>>,
): boolean {
  if (!selection || selection.model.length === 0) return false;
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!entry || !isProviderInstancePickerReady(entry)) return false;
  return (modelOptionsByInstance.get(selection.instanceId) ?? []).some(
    (option) => option.slug === selection.model && option.isUnavailable !== true,
  );
}

export function resolveWorkbenchStartThreadSelectionWithFallback({
  entries,
  explicitSelection,
  projectSelection,
  stickySelection,
  modelOptionsByInstance,
}: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly explicitSelection: ModelSelection | null | undefined;
  readonly projectSelection: ModelSelection | null | undefined;
  readonly stickySelection: ModelSelection | null | undefined;
  readonly modelOptionsByInstance: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<WorkbenchModelOption>
  >;
}): ModelSelection | null {
  for (const candidate of [explicitSelection, projectSelection, stickySelection]) {
    if (isWorkbenchStartThreadSelectionAvailable(entries, candidate, modelOptionsByInstance)) {
      return candidate ?? null;
    }
  }
  return resolveWorkbenchStartThreadSelection(entries);
}

const useWorkbenchStartThreadSelection = ({
  projectId,
  providers,
  settings,
  defaultModelSelection,
  stickyModelSelection,
}: {
  readonly projectId: ProjectId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: Parameters<typeof getCustomModelOptionsByInstance>[0];
  readonly defaultModelSelection: ModelSelection | null;
  readonly stickyModelSelection: ModelSelection | null;
}) => {
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, projectId),
  );
  const availableModelOptionsByInstance = getCustomModelOptionsByInstance(settings, providers);
  const [explicitSelection, setExplicitSelection] = useState<ModelSelection | null>(null);
  const resolvedSelection = resolveWorkbenchStartThreadSelectionWithFallback({
    entries: instanceEntries,
    explicitSelection,
    projectSelection: defaultModelSelection,
    stickySelection: stickyModelSelection,
    modelOptionsByInstance: availableModelOptionsByInstance,
  });
  const setStickyModelSelection = useComposerDraftStore((store) => store.setStickyModelSelection);
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    resolvedSelection?.instanceId,
    resolvedSelection?.model,
  );
  const activeEntry = instanceEntries.find(
    (entry) => entry.instanceId === resolvedSelection?.instanceId,
  );
  const selectionAvailable = isWorkbenchStartThreadSelectionAvailable(
    instanceEntries,
    resolvedSelection,
    modelOptionsByInstance,
  );

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    const nextSelection = createModelSelection(
      instanceId,
      model,
      resolvedSelection?.instanceId === instanceId && resolvedSelection.model === model
        ? resolvedSelection.options
        : undefined,
    );
    setExplicitSelection(nextSelection);
    // Match the native composer: picker changes update the sticky preference
    // immediately, so canceling this dialog does not discard the last choice.
    setStickyModelSelection(nextSelection);
  };
  const handleModelOptionsChange = (options: ModelSelection["options"]) => {
    if (resolvedSelection === null) return;
    const nextSelection = createModelSelection(
      resolvedSelection.instanceId,
      resolvedSelection.model,
      options,
    );
    setExplicitSelection(nextSelection);
    setStickyModelSelection(nextSelection);
  };

  return {
    instanceEntries,
    resolvedSelection,
    activeEntry,
    modelOptionsByInstance,
    selectionAvailable,
    handleInstanceModelChange,
    handleModelOptionsChange,
  };
};

type WorkbenchStartThreadDialogRequest = {
  readonly environmentId: EnvironmentId;
  readonly defaultModelSelection: ModelSelection | null;
  readonly ticket: WorkbenchTicket;
  readonly projects: ReadonlyArray<Project>;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly initialRepositoryScope: WorkbenchRepositoryScope | undefined;
  readonly additional?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly startLabel?: string;
};

const getWorkbenchStartThreadDefaultSelection = ({
  projects,
  scope,
  workspaceReady,
  defaultModelSelection,
}: {
  projects: readonly Project[];
  scope: WorkbenchRepositoryScope;
  workspaceReady: boolean;
  defaultModelSelection: ModelSelection | null;
}) =>
  projects.find((project) => project.id === scope.primaryT3ProjectId)?.defaultModelSelection ??
  (workspaceReady ? defaultModelSelection : null);

const resolveThreadRepositoryScope = ({
  ticket,
  workspace,
  draft,
}: {
  ticket: WorkbenchTicket;
  workspace: WorkbenchTicketWorkspace | undefined;
  draft: WorkbenchRepositoryScope;
}) => {
  const preparedRepositoryIds = new Set(
    workspace?.repositories
      .filter((repository) => repository.status === "ready")
      .map((repository) => repository.projectId),
  );
  if (preparedRepositoryIds.size === 0) return { scope: draft, lockedScope: undefined };
  const lockedScope = {
    primaryT3ProjectId: ticket.primaryT3ProjectId,
    repositoryProjectIds: ticket.repositoryProjectIds.filter(
      (id) => id === ticket.primaryT3ProjectId || preparedRepositoryIds.has(id),
    ),
  };
  return {
    lockedScope,
    scope: {
      primaryT3ProjectId: lockedScope.primaryT3ProjectId,
      repositoryProjectIds: [
        ...new Set([...lockedScope.repositoryProjectIds, ...draft.repositoryProjectIds]),
      ],
    },
  };
};

export function WorkbenchStartThreadDialog({
  open,
  onOpenChange,
  providers,
  request,
  pending,
  disabled,
  onStart,
  error,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly request: WorkbenchStartThreadDialogRequest;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly onStart: (input: {
    modelSelection: ModelSelection;
    repositoryScope?: WorkbenchRepositoryScope;
  }) => void;
  readonly error: string | null;
}) {
  const {
    environmentId,
    defaultModelSelection,
    ticket,
    projects,
    workspace,
    initialRepositoryScope,
    additional = false,
    title: dialogTitle = "Create Thread",
    description: customDescription,
    startLabel = "Create Thread",
  } = request;
  const [repositoryScopeDraft, setRepositoryScope] = useState(
    initialRepositoryScope ?? getWorkbenchRepositoryScope(ticket),
  );
  const { scope: repositoryScope, lockedScope: lockedRepositoryScope } =
    resolveThreadRepositoryScope({
      ticket,
      workspace,
      draft: repositoryScopeDraft,
    });
  const workspaceReady =
    isWorkbenchTicketWorkspaceReady({ ticket, workspace }) &&
    isWorkbenchRepositoryScopeEqual(ticket, repositoryScope);
  const workspaceLocked = workspace?.status === "preparing" || workspace?.status === "releasing";
  const scopeValid = isWorkbenchRepositoryScopeValid({ scope: repositoryScope, projects });
  const settings = useEnvironmentSettings(environmentId);
  const stickyModelSelection = useComposerDraftStore((store) =>
    store.stickyActiveProvider === null
      ? null
      : (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null),
  );
  const dialogDescription =
    customDescription ??
    (additional
      ? "Start another Thread for this ticket. It can read and update the ticket."
      : "The Thread can read and update this ticket. Add a message and send when you’re ready.");
  const selection = useWorkbenchStartThreadSelection({
    projectId: repositoryScope.primaryT3ProjectId,
    providers,
    settings,
    defaultModelSelection: getWorkbenchStartThreadDefaultSelection({
      projects,
      scope: repositoryScope,
      workspaceReady,
      defaultModelSelection,
    }),
    stickyModelSelection,
  });

  const { resolvedSelection, selectionAvailable } = selection;

  const cannotStart = disabled || pending || workspaceLocked || !scopeValid || !selectionAvailable;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cannotStart || resolvedSelection === null) return;
    onStart({ modelSelection: resolvedSelection, ...(!workspaceReady ? { repositoryScope } : {}) });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="workbench-start-thread" className="space-y-5" onSubmit={submit}>
            <WorkbenchStartThreadWorkspaceReview
              ticket={ticket}
              workspace={workspace}
              projects={projects}
              repositorySelection={{
                value: repositoryScope,
                onChange: setRepositoryScope,
                lockedScope: lockedRepositoryScope,
              }}
              ready={workspaceReady}
              locked={workspaceLocked}
              pending={pending}
            />
            {error ? (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <WorkbenchStartThreadModelFields
              environmentId={environmentId}
              selection={selection}
              planModeEnabled={settings.planModeEnabled}
            />
          </form>
        </DialogPanel>
        <WorkbenchStartThreadFooter
          pending={pending}
          disabled={cannotStart}
          workspaceReady={workspaceReady}
          startLabel={startLabel}
          onCancel={() => onOpenChange(false)}
        />
      </DialogPopup>
    </Dialog>
  );
}

function WorkbenchStartThreadFooter({
  pending,
  disabled,
  workspaceReady,
  startLabel,
  onCancel,
}: {
  pending: boolean;
  disabled: boolean;
  workspaceReady: boolean;
  startLabel: string;
  onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button disabled={pending} onClick={onCancel} type="button" variant="outline">
        Cancel
      </Button>
      <Button disabled={disabled} form="workbench-start-thread" type="submit">
        {pending
          ? "Preparing thread…"
          : workspaceReady
            ? startLabel
            : "Create work area and Thread"}
      </Button>
    </DialogFooter>
  );
}

const repositoryListFormat = new Intl.ListFormat("en", { type: "conjunction" });

const getWorkAreaStatus = ({
  ready,
  workspace,
}: {
  ready: boolean;
  workspace: WorkbenchTicketWorkspace | undefined;
}): { label: string; variant: "success" | "info" | "warning" | "error" | "secondary" } => {
  if (ready) return { label: "Ready", variant: "success" };
  switch (workspace?.status) {
    case "preparing":
      return { label: "Preparing", variant: "info" };
    case "releasing":
      return { label: "Releasing", variant: "warning" };
    case "failed":
      return { label: "Failed", variant: "error" };
    case "ready":
      return { label: "Needs preparation", variant: "warning" };
    default:
      return { label: "Not prepared", variant: "secondary" };
  }
};

const getWorkAreaDescription = ({
  ready,
  workspace,
  projects,
  savedScope,
  scope,
}: {
  ready: boolean;
  workspace: WorkbenchTicketWorkspace | undefined;
  projects: readonly Project[];
  savedScope: WorkbenchRepositoryScope;
  scope: WorkbenchRepositoryScope;
}) => {
  if (ready) return "This Thread reuses the prepared worktrees.";
  if (workspace?.status === "ready") {
    const unprepared = scope.repositoryProjectIds
      .filter(
        (id) =>
          !workspace.repositories.some(
            (repository) => repository.projectId === id && repository.status === "ready",
          ),
      )
      .map((id) => projects.find((project) => project.id === id)?.title ?? id);
    if (unprepared.length > 0) {
      return `Creating the Thread prepares ${unprepared.length === 1 ? "a worktree" : "worktrees"} for ${repositoryListFormat.format(unprepared)}. Prepared worktrees are reused.`;
    }
  }
  return isWorkbenchRepositoryScopeEqual(savedScope, scope)
    ? null
    : "Repository changes apply to this ticket’s work area when you create the Thread.";
};

function WorkbenchStartThreadWorkspaceReview({
  ticket,
  workspace,
  projects,
  repositorySelection,
  ready,
  locked,
  pending,
}: {
  ticket: WorkbenchTicket;
  workspace: WorkbenchTicketWorkspace | undefined;
  projects: readonly Project[];
  repositorySelection: {
    value: WorkbenchRepositoryScope;
    onChange: (scope: WorkbenchRepositoryScope) => void;
    lockedScope: WorkbenchRepositoryScope | undefined;
  };
  ready: boolean;
  locked: boolean;
  pending: boolean;
}) {
  const status = getWorkAreaStatus({ ready, workspace });
  const savedScope = getWorkbenchRepositoryScope(ticket);
  const description = getWorkAreaDescription({
    ready,
    workspace,
    projects,
    savedScope,
    scope: repositorySelection.value,
  });
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Work area</p>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <WorkbenchRepositoryScopeFields
        projects={projects}
        {...repositorySelection}
        savedScope={savedScope}
        workspace={workspace}
        disabled={pending || locked}
      />
      {locked ? (
        <p role="status" className="text-xs text-muted-foreground">
          Wait for work area preparation or release to finish.
        </p>
      ) : null}
    </section>
  );
}

function WorkbenchStartThreadModelFields({
  environmentId,
  selection,
  planModeEnabled,
}: {
  environmentId: EnvironmentId;
  selection: ReturnType<typeof useWorkbenchStartThreadSelection>;
  planModeEnabled: boolean;
}) {
  const {
    resolvedSelection,
    activeEntry,
    instanceEntries,
    modelOptionsByInstance,
    handleInstanceModelChange,
    handleModelOptionsChange,
    selectionAvailable,
  } = selection;
  return resolvedSelection && activeEntry ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderModelPicker
          environmentId={environmentId}
          activeInstanceId={resolvedSelection.instanceId}
          model={resolvedSelection.model}
          lockedProvider={null}
          instanceEntries={instanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          triggerAriaLabel="Thread provider and model"
          onInstanceModelChange={handleInstanceModelChange}
        />
        <TraitsPicker
          provider={activeEntry.driverKind}
          instanceId={resolvedSelection.instanceId}
          models={activeEntry.models}
          model={resolvedSelection.model}
          modelOptions={resolvedSelection.options ?? []}
          allowPromptInjectedEffort={false}
          planModeEnabled={planModeEnabled}
          onModelOptionsChange={handleModelOptionsChange}
        />
      </div>
      {!selectionAvailable ? (
        <p className="text-sm text-warning-foreground" role="status">
          Choose an available provider and model before starting the Thread.
        </p>
      ) : null}
    </div>
  ) : (
    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      No available Agent providers are connected.
    </p>
  );
}
