import type { EnvironmentId, ModelSelection, ServerProvider } from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useMemo, useState, type FormEvent } from "react";

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
  startLabel = "Start Thread",
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
  const dialogTitle =
    customTitle ?? (additional ? "Start Additional Agent Thread" : "Start Agent Thread");
  const dialogDescription =
    customDescription ??
    (additional
      ? "Choose the provider and model for another native T3 conversation."
      : "Choose the provider and model for this native T3 conversation.");
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const defaultSelection = useMemo(
    () => resolveWorkbenchStartThreadSelection(instanceEntries, defaultModelSelection),
    [defaultModelSelection, instanceEntries],
  );
  const [selection, setSelection] = useState<ModelSelection | null>(() => defaultSelection);
  const resetSelection = () => {
    setSelection(defaultSelection);
  };
  const selectedEntry = selection
    ? instanceEntries.find((entry) => entry.instanceId === selection.instanceId)
    : undefined;
  const resolvedSelection =
    selectedEntry && isProviderInstancePickerReady(selectedEntry) ? selection : defaultSelection;

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
  const selectedModelOption = resolvedSelection
    ? (modelOptionsByInstance.get(resolvedSelection.instanceId) ?? []).find(
        (option) => option.slug === resolvedSelection.model,
      )
    : undefined;
  const selectionAvailable =
    resolvedSelection !== null &&
    activeEntry !== undefined &&
    isProviderInstancePickerReady(activeEntry) &&
    selectedModelOption !== undefined &&
    selectedModelOption.isUnavailable !== true;

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    setSelection((current) =>
      createModelSelection(
        instanceId,
        model,
        current?.instanceId === instanceId && current.model === model ? current.options : undefined,
      ),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !selectionAvailable || resolvedSelection === null) return;
    onStart(resolvedSelection);
    resetSelection();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetSelection();
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
                    onModelOptionsChange={(options) => {
                      setSelection((current) =>
                        createModelSelection(
                          current?.instanceId ?? resolvedSelection.instanceId,
                          current?.model ?? resolvedSelection.model,
                          options,
                        ),
                      );
                    }}
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
