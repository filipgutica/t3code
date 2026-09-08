import type { EnvironmentId, ModelSelection, ServerProvider } from "@t3tools/contracts";
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

export function resolveWorkbenchStartThreadSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  preferred: ModelSelection | null | undefined,
): ModelSelection | null {
  if (preferred) {
    const preferredEntry = entries.find((entry) => entry.instanceId === preferred.instanceId);
    // Keep a project's exact model selection, including custom models that are
    // supplied by settings rather than the provider snapshot. If its instance
    // disappeared or is disabled, let the user choose from a live instance.
    if (preferredEntry && isProviderInstancePickerReady(preferredEntry)) return preferred;
  }

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

export function isWorkbenchStartThreadSelectionAvailable(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  selection: ModelSelection | null | undefined,
  modelOptionsByInstance?: ReadonlyMap<ProviderInstanceId, ReadonlyArray<WorkbenchModelOption>>,
): boolean {
  if (!selection || selection.model.length === 0) return false;
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!entry || !isProviderInstancePickerReady(entry)) return false;
  if (!modelOptionsByInstance) return true;
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
  return resolveWorkbenchStartThreadSelection(entries, null);
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
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly defaultModelSelection: ModelSelection | null;
  readonly pending: boolean;
  readonly onStart: (selection: ModelSelection) => void;
  readonly additional?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly startLabel?: string;
}) {
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
  const {
    instanceEntries,
    resolvedSelection,
    activeEntry,
    modelOptionsByInstance,
    selectionAvailable,
    handleInstanceModelChange,
    handleModelOptionsChange,
  } = useWorkbenchStartThreadSelection({
    providers,
    settings,
    defaultModelSelection,
    stickyModelSelection,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !selectionAvailable || resolvedSelection === null) return;
    onStart(resolvedSelection);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="workbench-start-thread" className="space-y-5" onSubmit={submit}>
            {resolvedSelection && activeEntry ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Provider and model</p>
                  <p className="text-xs text-muted-foreground">
                    This choice is saved on the native Thread when it starts.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ProviderModelPicker
                    activeInstanceId={resolvedSelection.instanceId}
                    model={resolvedSelection.model}
                    lockedProvider={null}
                    instanceEntries={instanceEntries}
                    modelOptionsByInstance={modelOptionsByInstance}
                    triggerVariant="outline"
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
                    planModeEnabled={settings.planModeEnabled}
                    triggerVariant="outline"
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
            )}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending || !selectionAvailable}
            form="workbench-start-thread"
            type="submit"
          >
            {startLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
