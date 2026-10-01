import type {
  EnvironmentId,
  ModelSelection,
  ServerProvider,
  WorkbenchTicket,
  WorkbenchTicketWorkspace,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useMemo, useState, type FormEvent } from "react";

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
  providers,
  settings,
  defaultModelSelection,
  stickyModelSelection,
}: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: Parameters<typeof getCustomModelOptionsByInstance>[0];
  readonly defaultModelSelection: ModelSelection | null;
  readonly stickyModelSelection: ModelSelection | null;
}) => {
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const availableModelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers),
    [providers, settings],
  );
  const [explicitSelection, setExplicitSelection] = useState<ModelSelection | null>(null);
  const resolvedSelection = useMemo(
    () =>
      resolveWorkbenchStartThreadSelectionWithFallback({
        entries: instanceEntries,
        explicitSelection,
        projectSelection: defaultModelSelection,
        stickySelection: stickyModelSelection,
        modelOptionsByInstance: availableModelOptionsByInstance,
      }),
    [
      availableModelOptionsByInstance,
      defaultModelSelection,
      explicitSelection,
      instanceEntries,
      stickyModelSelection,
    ],
  );
  const setStickyModelSelection = useComposerDraftStore((store) => store.setStickyModelSelection);
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        settings,
        providers,
        resolvedSelection?.instanceId,
        resolvedSelection?.model,
      ),
    [providers, resolvedSelection?.instanceId, resolvedSelection?.model, settings],
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

export function WorkbenchStartThreadDialog({
  open,
  onOpenChange,
  environmentId,
  providers,
  defaultModelSelection,
  pending,
  onStart,
  additional = false,
  title: customTitle,
  description: customDescription,
  startLabel = "Create Thread",
  ticket,
  projects,
  workspace,
  initialRepositoryScope,
  onEditRepositories,
  error,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly defaultModelSelection: ModelSelection | null;
  readonly pending: boolean;
  readonly onStart: (input: {
    modelSelection: ModelSelection;
    repositoryScope?: WorkbenchRepositoryScope;
  }) => void;
  readonly ticket: WorkbenchTicket;
  readonly projects: ReadonlyArray<Project>;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly initialRepositoryScope: WorkbenchRepositoryScope | undefined;
  readonly onEditRepositories: () => void;
  readonly error: string | null;
  readonly additional?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly startLabel?: string;
}) {
  const [repositoryScope, setRepositoryScope] = useState(
    initialRepositoryScope ?? getWorkbenchRepositoryScope(ticket),
  );
  const workspaceReady = isWorkbenchTicketWorkspaceReady({ ticket, workspace });
  const workspaceLocked = workspace?.status === "preparing" || workspace?.status === "releasing";
  const scopeValid = isWorkbenchRepositoryScopeValid({ scope: repositoryScope, projects });
  const settings = useEnvironmentSettings(environmentId);
  const stickyModelSelection = useComposerDraftStore((store) =>
    store.stickyActiveProvider === null
      ? null
      : (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null),
  );
  const dialogTitle =
    customTitle ?? (additional ? "Create Additional Agent Thread" : "Create Agent Thread");
  const dialogDescription =
    customDescription ??
    "Choose the provider and model. The new Thread opens with ticket context attached; add an optional message and send it when you’re ready.";
  const selection = useWorkbenchStartThreadSelection({
    providers,
    settings,
    defaultModelSelection:
      projects.find((project) => project.id === repositoryScope.primaryT3ProjectId)
        ?.defaultModelSelection ?? (workspaceReady ? defaultModelSelection : null),
    stickyModelSelection,
  });

  const { resolvedSelection, selectionAvailable } = selection;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      pending ||
      workspaceLocked ||
      !scopeValid ||
      !selectionAvailable ||
      resolvedSelection === null
    )
      return;
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
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Ticket workspace</p>
                {workspaceReady ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={onEditRepositories}
                  >
                    Edit repositories
                  </Button>
                ) : null}
              </div>
              {workspaceReady ? (
                <div className="space-y-2">
                  {[
                    ticket.primaryT3ProjectId,
                    ...ticket.repositoryProjectIds.filter((id) => id !== ticket.primaryT3ProjectId),
                  ].map((id) => (
                    <div key={id} className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="min-w-0 break-words">
                        {projects.find((project) => project.id === id)?.title ??
                          "Repository unavailable"}
                      </span>
                      {id === ticket.primaryT3ProjectId ? (
                        <Badge size="sm" variant="outline">
                          Primary
                        </Badge>
                      ) : null}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    This thread reuses the ticket’s prepared worktrees.
                  </p>
                </div>
              ) : (
                <WorkbenchRepositoryScopeFields
                  projects={projects}
                  value={repositoryScope}
                  onChange={setRepositoryScope}
                  disabled={pending || workspaceLocked}
                  idPrefix={`start-thread-${ticket.id}`}
                />
              )}
              {workspaceLocked ? (
                <p role="status" className="text-xs text-muted-foreground">
                  Wait for workspace preparation or release to finish.
                </p>
              ) : null}
            </section>
            {error ? (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <WorkbenchStartThreadModelFields
              selection={selection}
              planModeEnabled={settings.planModeEnabled}
            />
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending || workspaceLocked || !scopeValid || !selectionAvailable}
            form="workbench-start-thread"
            type="submit"
          >
            {pending
              ? "Preparing thread…"
              : workspaceReady
                ? startLabel
                : "Create workspace and thread"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function WorkbenchStartThreadModelFields({
  selection,
  planModeEnabled,
}: {
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
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Provider and model</p>
        <p className="text-xs text-muted-foreground">
          This choice is saved on the Thread when it starts.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ProviderModelPicker
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
          prompt=""
          onPromptChange={() => {}}
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
