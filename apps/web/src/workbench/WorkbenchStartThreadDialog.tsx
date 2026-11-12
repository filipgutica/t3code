import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ServerProvider,
  WorkbenchProject,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { ProviderInstanceId, workbenchHostRepositoryProjectIds } from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import { createModelSelection } from "@t3tools/shared/model";
import { useState, type FormEvent } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { randomUUID } from "../lib/utils";
import { WorktreeBaseBranchPicker } from "../components/WorktreeBaseBranchPicker";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import type { WorkbenchRemoteThreadStart } from "./startWorkbenchTicket";
import type { WorkbenchStartThreadRemoteRepository } from "./workbenchRemote.logic";
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
  rememberSelection,
}: {
  readonly projectId: ProjectId | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: Parameters<typeof getCustomModelOptionsByInstance>[0];
  readonly defaultModelSelection: ModelSelection | null;
  readonly stickyModelSelection: ModelSelection | null;
  /** False for another machine's providers, which should not become this client's default. */
  readonly rememberSelection: boolean;
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
    if (rememberSelection) setStickyModelSelection(nextSelection);
  };
  const handleModelOptionsChange = (options: ModelSelection["options"]) => {
    if (resolvedSelection === null) return;
    const nextSelection = createModelSelection(
      resolvedSelection.instanceId,
      resolvedSelection.model,
      options,
    );
    setExplicitSelection(nextSelection);
    if (rememberSelection) setStickyModelSelection(nextSelection);
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
  /** The Ticket's Board, whose repositories on other machines get no host worktree. */
  readonly board: Pick<WorkbenchProject, "remoteProjects"> | undefined;
  readonly remoteRepositories?: ReadonlyArray<WorkbenchStartThreadRemoteRepository>;
  /** A Thread on another machine that never started; the dialog relaunches it there. */
  readonly retry?: { readonly projectId: ProjectId };
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
  board,
  projects,
  draft,
  picked,
  preferred,
}: {
  ticket: WorkbenchTicket;
  workspace: WorkbenchTicketWorkspace | undefined;
  board: Pick<WorkbenchProject, "remoteProjects"> | undefined;
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
  // Create saves the whole scope, but the Thread and its worktree stay on the Board host.
  const hostScope = {
    repositoryProjectIds: workbenchHostRepositoryProjectIds(
      board,
      repositoryScope.repositoryProjectIds,
    ),
  };
  const hostTicketRepositoryIds = workbenchHostRepositoryProjectIds(board, ticketRepositoryIds);
  const repositoryProjectId =
    resolveWorkbenchThreadRepository({ ticket: hostScope, preferred: picked ?? preferred }) ?? null;
  return {
    ticketRepositoryIds: hostTicketRepositoryIds,
    repositoryScope,
    repositoryProjectId,
    workspaceReady:
      isWorkbenchTicketWorkspaceReady({ ticket, workspace, board }) &&
      isWorkbenchRepositoryScopeEqual(ticket, repositoryScope),
    workspaceLocked: workspace?.status === "preparing" || workspace?.status === "releasing",
    scopeValid: isWorkbenchRepositoryScopeValid({ scope: hostScope, projects }),
    note: {
      title: getWorkbenchRepositoryTitle(projects, repositoryProjectId),
      adding,
      prepared: repositoryProjectId !== null && isPrepared(repositoryProjectId),
      // "Last used" explains a default only when the Ticket offered a choice.
      lastUsed: hostTicketRepositoryIds.length > 1 && repositoryProjectId === preferred,
      ticketScopeChanged: !isWorkbenchRepositoryScopeEqual(ticket, {
        repositoryProjectIds: ticketRepositoryIds,
      }),
      unavailable: hostScope.repositoryProjectIds.some(
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
    remote?: WorkbenchRemoteThreadStart;
  }) => void;
  readonly error: string | null;
}) {
  const {
    environmentId,
    ticket,
    projects,
    workspace,
    board,
    remoteRepositories = [],
    retry,
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
    board,
    projects,
    draft: initialRepositoryScope ?? getWorkbenchRepositoryScope(ticket),
    picked: pickedRepositoryProjectId,
    preferred: preferredRepositoryProjectId,
  });
  const remoteChoice = resolveRemoteThreadRepository({
    remoteRepositories,
    retry,
    picked: pickedRepositoryProjectId,
    hostRepositoryProjectId: repositoryProjectId,
  });
  const target = getWorkbenchStartThreadTarget({
    remoteChoice,
    host: {
      environmentId,
      projectId: repositoryProjectId,
      providers,
      description: customDescription ?? getWorkbenchStartThreadDescription(additional),
      startLabel,
      workspaceReady,
    },
  });
  const settings = useEnvironmentSettings(target.environmentId);
  const stickyModelSelection = useComposerDraftStore((store) =>
    store.stickyActiveProvider === null
      ? null
      : (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null),
  );
  const remoteForm = useWorkbenchRemoteThreadForm(ticket);
  const selection = useWorkbenchStartThreadSelection({
    projectId: target.projectId,
    providers: target.providers,
    settings,
    defaultModelSelection: resolveWorkbenchDefaultModelSelection({
      settings,
      projectId: target.projectId,
      project: projects.find((project) => project.id === target.projectId),
    }),
    stickyModelSelection,
    rememberSelection: remoteChoice === undefined,
  });

  const startInput = getWorkbenchStartThreadInput({
    selection,
    ticket,
    repositoryScope,
    repositoryProjectId,
    workspaceReady,
    hostStartable: !workspaceLocked && scopeValid,
    remoteChoice,
    remoteForm,
  });
  const cannotStart = disabled === true || pending || startInput === null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cannotStart && startInput) onStart(startInput);
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
          <DialogDescription>{target.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="workbench-start-thread" className="space-y-2" onSubmit={submit}>
            <div className="flex flex-wrap items-center gap-2">
              <WorkbenchThreadRepositoryPicker
                ticketRepositoryIds={ticketRepositoryIds}
                projects={projects}
                remoteRepositories={remoteRepositories}
                workspace={workspace}
                value={target.projectId}
                // A relaunch keeps the repository its Assignment names.
                disabled={pending || workspaceLocked || retry !== undefined}
                onChange={setPickedRepositoryProjectId}
              />
              <WorkbenchStartThreadModelPickers
                environmentId={target.environmentId}
                selection={selection}
                planModeEnabled={settings.planModeEnabled}
              />
            </div>
            <WorkbenchStartThreadRepositoryDetails
              remoteChoice={remoteChoice}
              remoteForm={remoteForm}
              note={note}
              locked={workspaceLocked}
              pending={pending}
            />
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
          workspaceReady={target.workspaceReady}
          startLabel={target.startLabel}
          onCancel={() => onOpenChange(false)}
        />
      </DialogPopup>
    </Dialog>
  );
}

function WorkbenchStartThreadRepositoryDetails({
  remoteChoice,
  remoteForm,
  note,
  locked,
  pending,
}: {
  remoteChoice: WorkbenchStartThreadRemoteRepository | undefined;
  remoteForm: ReturnType<typeof useWorkbenchRemoteThreadForm>;
  note: ReturnType<typeof resolveThreadRepositoryChoice>["note"];
  locked: boolean;
  pending: boolean;
}) {
  return remoteChoice ? (
    <WorkbenchRemoteThreadFields repository={remoteChoice} form={remoteForm} disabled={pending} />
  ) : (
    <WorkbenchStartThreadRepositoryNote {...note} locked={locked} />
  );
}

interface WorkbenchStartThreadTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly description: string;
  readonly startLabel: string;
  readonly workspaceReady: boolean;
}

/** Where the Thread starts: the Board host, or the machine that holds the chosen repository. */
const getWorkbenchStartThreadTarget = ({
  remoteChoice,
  host,
}: {
  remoteChoice: WorkbenchStartThreadRemoteRepository | undefined;
  host: WorkbenchStartThreadTarget;
}): WorkbenchStartThreadTarget =>
  remoteChoice
    ? {
        environmentId: remoteChoice.project?.environmentId ?? host.environmentId,
        projectId: remoteChoice.id,
        providers: remoteChoice.providers,
        description:
          "The Thread gets this ticket’s brief in its first message, but cannot read or update the ticket.",
        startLabel: "Start Thread",
        // Another machine prepares its own worktree as the Thread starts.
        workspaceReady: true,
      }
    : host;

const getWorkbenchStartThreadDescription = (additional: boolean) =>
  additional
    ? "Start another Thread for this ticket. It can read and update the ticket."
    : "The Thread can read and update this ticket. Add a message and send when you’re ready.";

/** What Start sends for the chosen repository, or null while that choice cannot start. */
const getWorkbenchStartThreadInput = ({
  selection,
  ticket,
  repositoryScope,
  repositoryProjectId,
  workspaceReady,
  hostStartable,
  remoteChoice,
  remoteForm,
}: {
  selection: Pick<
    ReturnType<typeof useWorkbenchStartThreadSelection>,
    "selectionAvailable" | "resolvedSelection"
  >;
  ticket: WorkbenchTicket;
  repositoryScope: WorkbenchRepositoryScope;
  repositoryProjectId: ProjectId | null;
  workspaceReady: boolean;
  /** The host workspace is not busy and every host repository resolves. */
  hostStartable: boolean;
  remoteChoice: WorkbenchStartThreadRemoteRepository | undefined;
  remoteForm: Pick<ReturnType<typeof useWorkbenchRemoteThreadForm>, "complete" | "value">;
}) => {
  const modelSelection = selection.resolvedSelection;
  if (!selection.selectionAvailable || modelSelection === null) return null;
  if (remoteChoice) {
    if (!remoteChoice.project || !remoteForm.complete) return null;
    return {
      modelSelection,
      ...(isWorkbenchRepositoryScopeEqual(ticket, repositoryScope) ? {} : { repositoryScope }),
      remote: { project: remoteChoice.project, ...remoteForm.value },
    };
  }
  if (!hostStartable) return null;
  return {
    modelSelection,
    ...(!workspaceReady ? { repositoryScope } : {}),
    ...(repositoryProjectId ? { repositoryProjectId } : {}),
  };
};

/**
 * The remote repository the Thread starts in, or undefined for the host: a relaunch's own, a
 * picked one, or the first ready one when the Ticket has no repository on the host.
 */
const resolveRemoteThreadRepository = ({
  remoteRepositories,
  retry,
  picked,
  hostRepositoryProjectId,
}: {
  remoteRepositories: ReadonlyArray<WorkbenchStartThreadRemoteRepository>;
  retry: { readonly projectId: ProjectId } | undefined;
  picked: ProjectId | undefined;
  hostRepositoryProjectId: ProjectId | null;
}) => {
  const find = (id: ProjectId | undefined) =>
    remoteRepositories.find((repository) => repository.id === id);
  // A relaunch never falls back to the host, which would start a second Thread.
  if (retry)
    return (
      find(retry.projectId) ?? {
        id: retry.projectId,
        title: "Repository unavailable",
        project: null,
        providers: [],
        unavailableReason: "This repository is no longer on the Ticket's Board.",
      }
    );
  if (picked !== undefined) return find(picked);
  if (hostRepositoryProjectId !== null) return undefined;
  return (
    remoteRepositories.find((repository) => repository.unavailableReason === null) ??
    remoteRepositories[0]
  );
};

/** The launch starts a run at once, so the first instruction and the worktree come up front. */
function useWorkbenchRemoteThreadForm(ticket: Pick<WorkbenchTicket, "title">) {
  const [instruction, setInstruction] = useState("");
  const [baseRef, setBaseRef] = useState("");
  // A suffix keeps a second Thread in the same repository off the first one's branch.
  const [branch, setBranch] = useState(
    () => `${sanitizeBranchFragment(ticket.title)}-${randomUUID().slice(0, 6)}`,
  );
  const [startFromOrigin, setStartFromOrigin] = useState(false);
  const value = {
    baseRef: baseRef.trim(),
    branch: branch.trim(),
    startFromOrigin,
    instruction: instruction.trim(),
  };
  return {
    fields: { instruction, baseRef, branch, startFromOrigin },
    set: { setInstruction, setBaseRef, setBranch, setStartFromOrigin },
    value,
    complete: value.instruction !== "" && value.baseRef !== "" && value.branch !== "",
  };
}

function WorkbenchRemoteThreadFields({
  repository,
  form,
  disabled,
}: {
  repository: WorkbenchStartThreadRemoteRepository;
  form: ReturnType<typeof useWorkbenchRemoteThreadForm>;
  disabled: boolean;
}) {
  const { project } = repository;
  const { fields, set } = form;
  return (
    <div className="space-y-3 pt-1">
      {repository.unavailableReason ? (
        <p role="alert" className="text-sm text-destructive">
          {repository.unavailableReason}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Starts in a new worktree on that machine as soon as you start it.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="workbench-remote-thread-instruction">First instruction</Label>
        <Textarea
          id="workbench-remote-thread-instruction"
          rows={3}
          placeholder="What should the Thread do first?"
          disabled={disabled}
          value={fields.instruction}
          onChange={(event) => set.setInstruction(event.currentTarget.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="workbench-remote-thread-base">Base branch</Label>
          {project ? (
            <WorktreeBaseBranchPicker
              id="workbench-remote-thread-base"
              environmentId={project.environmentId}
              cwd={project.workspaceRoot}
              value={fields.baseRef}
              onValueChange={set.setBaseRef}
              startFromOrigin={fields.startFromOrigin}
              onStartFromOriginChange={set.setStartFromOrigin}
              disabled={disabled}
            />
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workbench-remote-thread-branch">New branch</Label>
          <Input
            id="workbench-remote-thread-branch"
            size="sm"
            disabled={disabled}
            value={fields.branch}
            onChange={(event) => set.setBranch(event.currentTarget.value)}
          />
        </div>
      </div>
    </div>
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
            : "Create worktrees and Thread"}
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
      {ticketScopeChanged ? <p>Repository changes apply when you create the Thread.</p> : null}
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
      {locked ? <p role="status">Wait for worktree preparation or removal to finish.</p> : null}
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
