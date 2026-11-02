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
  isProviderInstancePickerReady,
  providerInstanceEntriesFor,
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
import {
  getWorkbenchRepositoryTitle,
  WorkbenchThreadRepositoryPicker,
} from "./WorkbenchThreadRepositoryPicker";
import {
  getWorkbenchRepositoryScope,
  isWorkbenchRepositoryScopeEqual,
  isWorkbenchRepositoryScopeValid,
  resolveWorkbenchThreadRepository,
  isWorkbenchTicketWorkspaceReady,
  type WorkbenchRepositoryScope,
} from "./workbenchRepositoryScope";
import { resolveWorkbenchDefaultModelSelection } from "./workbenchTicketDraft.logic";

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
  readonly projectId: ProjectId | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: Parameters<typeof getCustomModelOptionsByInstance>[0];
  readonly defaultModelSelection: ModelSelection | null;
  readonly stickyModelSelection: ModelSelection | null;
}) => {
  const instanceEntries = providerInstanceEntriesFor(providers, settings, projectId);
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
  readonly ticket: WorkbenchTicket;
  readonly projects: ReadonlyArray<Project>;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly initialRepositoryScope: WorkbenchRepositoryScope | undefined;
  /** Preferred repository for the new Thread; see `resolveWorkbenchThreadRepository`. */
  readonly repositoryProjectId: ProjectId | undefined;
  readonly additional?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly startLabel?: string;
};

/**
 * The repository the new Thread works in and the scope Create saves. Prepared repositories stay
 * on the Ticket even when an unsaved Ticket-page draft dropped them; a picked Workspace repository
 * the Ticket does not link yet is appended. Draft order is kept so an unchanged scope is not saved.
 */
const resolveThreadRepositoryChoice = ({
  ticket,
  workspace,
  projects,
  draft,
  picked,
  preferred,
}: {
  ticket: WorkbenchTicket;
  workspace: WorkbenchTicketWorkspace | undefined;
  projects: readonly Project[];
  draft: WorkbenchRepositoryScope;
  picked: ProjectId | undefined;
  preferred: ProjectId | undefined;
}) => {
  const isPrepared = (id: ProjectId) =>
    workspace?.repositories.some(
      (repository) => repository.projectId === id && repository.status === "ready",
    ) ?? false;
  const ticketRepositoryIds = [
    ...new Set([...draft.repositoryProjectIds, ...ticket.repositoryProjectIds.filter(isPrepared)]),
  ];
  const adding = picked !== undefined && !ticketRepositoryIds.includes(picked);
  const repositoryScope = {
    repositoryProjectIds: adding ? [...ticketRepositoryIds, picked] : ticketRepositoryIds,
  };
  const repositoryProjectId =
    resolveWorkbenchThreadRepository({ ticket: repositoryScope, preferred: picked ?? preferred }) ??
    null;
  return {
    ticketRepositoryIds,
    repositoryScope,
    repositoryProjectId,
    workspaceReady:
      isWorkbenchTicketWorkspaceReady({ ticket, workspace }) &&
      isWorkbenchRepositoryScopeEqual(ticket, repositoryScope),
    workspaceLocked: workspace?.status === "preparing" || workspace?.status === "releasing",
    scopeValid: isWorkbenchRepositoryScopeValid({ scope: repositoryScope, projects }),
    note: {
      title: getWorkbenchRepositoryTitle(projects, repositoryProjectId),
      adding,
      prepared: repositoryProjectId !== null && isPrepared(repositoryProjectId),
      // "Last used" explains a default only when the Ticket offered a choice.
      lastUsed: ticketRepositoryIds.length > 1 && repositoryProjectId === preferred,
      ticketScopeChanged: !isWorkbenchRepositoryScopeEqual(ticket, {
        repositoryProjectIds: ticketRepositoryIds,
      }),
      unavailable: repositoryScope.repositoryProjectIds.some(
        (id) => !projects.some((project) => project.id === id),
      ),
      // Create re-prepares every repository, so any failed checkout can block the Thread.
      preparationErrors: (workspace?.repositories ?? []).flatMap((repository) =>
        repository.errorMessage &&
        repositoryScope.repositoryProjectIds.includes(repository.projectId)
          ? [
              `${getWorkbenchRepositoryTitle(projects, repository.projectId)}: ${repository.errorMessage}`,
            ]
          : [],
      ),
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
    repositoryProjectId?: ProjectId;
  }) => void;
  readonly error: string | null;
}) {
  const {
    environmentId,
    ticket,
    projects,
    workspace,
    initialRepositoryScope,
    repositoryProjectId: preferredRepositoryProjectId,
    additional = false,
    title: dialogTitle = "Create Thread",
    description: customDescription,
    startLabel = "Create Thread",
  } = request;
  const [pickedRepositoryProjectId, setPickedRepositoryProjectId] = useState<ProjectId>();
  const {
    ticketRepositoryIds,
    repositoryScope,
    repositoryProjectId,
    workspaceReady,
    workspaceLocked,
    scopeValid,
    note,
  } = resolveThreadRepositoryChoice({
    ticket,
    workspace,
    projects,
    draft: initialRepositoryScope ?? getWorkbenchRepositoryScope(ticket),
    picked: pickedRepositoryProjectId,
    preferred: preferredRepositoryProjectId,
  });
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
    projectId: repositoryProjectId,
    providers,
    settings,
    defaultModelSelection: resolveWorkbenchDefaultModelSelection({
      settings,
      projectId: repositoryProjectId,
      project: projects.find((project) => project.id === repositoryProjectId),
    }),
    stickyModelSelection,
  });

  const { resolvedSelection, selectionAvailable } = selection;

  const cannotStart = disabled || pending || workspaceLocked || !scopeValid || !selectionAvailable;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cannotStart || resolvedSelection === null) return;
    onStart({
      modelSelection: resolvedSelection,
      ...(!workspaceReady ? { repositoryScope } : {}),
      ...(repositoryProjectId ? { repositoryProjectId } : {}),
    });
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
          <form id="workbench-start-thread" className="space-y-2" onSubmit={submit}>
            <div className="flex flex-wrap items-center gap-2">
              <WorkbenchThreadRepositoryPicker
                ticketRepositoryIds={ticketRepositoryIds}
                projects={projects}
                workspace={workspace}
                value={repositoryProjectId}
                disabled={pending || workspaceLocked}
                onChange={setPickedRepositoryProjectId}
              />
              <WorkbenchStartThreadModelPickers
                environmentId={environmentId}
                selection={selection}
                planModeEnabled={settings.planModeEnabled}
              />
            </div>
            <WorkbenchStartThreadRepositoryNote {...note} locked={workspaceLocked} />
            <WorkbenchStartThreadSelectionStatus selection={selection} />
            {error ? (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            ) : null}
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

function WorkbenchStartThreadRepositoryNote({
  title,
  adding,
  prepared,
  lastUsed,
  ticketScopeChanged,
  unavailable,
  preparationErrors,
  locked,
}: {
  title: string;
  adding: boolean;
  prepared: boolean;
  lastUsed: boolean;
  ticketScopeChanged: boolean;
  unavailable: boolean;
  preparationErrors: readonly string[];
  locked: boolean;
}) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {adding ? (
        <p className="flex items-center gap-2">
          <Badge size="sm" variant="info">
            Adding
          </Badge>
          <span>{title} will be linked to this ticket and prepared on its branch.</span>
        </p>
      ) : (
        <p>
          {prepared
            ? `Works in the prepared ${title} worktree.`
            : `Creating the Thread prepares a worktree for ${title}.`}
          {lastUsed ? " Last used by this ticket’s Threads." : null}
        </p>
      )}
      {ticketScopeChanged ? (
        <p>Repository changes apply to this ticket’s work area when you create the Thread.</p>
      ) : null}
      {unavailable ? (
        <p role="alert" className="text-destructive">
          A ticket repository is no longer linked to this Workspace. Link it again with Edit
          Workspace.
        </p>
      ) : null}
      {preparationErrors.map((message) => (
        <p key={message} role="alert" className="break-words text-destructive">
          {message}
        </p>
      ))}
      {locked ? <p role="status">Wait for work area preparation or release to finish.</p> : null}
    </div>
  );
}

function WorkbenchStartThreadSelectionStatus({
  selection,
}: {
  selection: ReturnType<typeof useWorkbenchStartThreadSelection>;
}) {
  if (!selection.resolvedSelection || !selection.activeEntry)
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No available Agent providers are connected.
      </p>
    );
  if (!selection.selectionAvailable)
    return (
      <p className="text-sm text-warning-foreground" role="status">
        Choose an available provider and model before starting the Thread.
      </p>
    );
  return null;
}

function WorkbenchStartThreadModelPickers({
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
  } = selection;
  if (!resolvedSelection || !activeEntry) return null;
  return (
    <>
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
    </>
  );
}
