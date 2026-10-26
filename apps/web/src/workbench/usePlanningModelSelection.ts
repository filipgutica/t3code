import type { EnvironmentId, ServerProvider, WorkbenchProject } from "@t3tools/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../providerInstances";
import type { Project } from "../types";
import {
  resolveTicketPlanningModelSelection,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";

/** The Thread starts on the first provider the server can restrict to read-only planning. */
export function usePlanningModelSelection({
  environmentId,
  providers,
  linkedProjects,
  workspace,
  draft,
}: {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly workspace: WorkbenchProject;
  readonly draft: Pick<WorkbenchConversationDraft, "anchorProjectId"> | null;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const sticky = useComposerDraftStore((store) =>
    store.stickyActiveProvider === null
      ? null
      : (store.stickyModelSelectionByProvider[store.stickyActiveProvider] ?? null),
  );
  const anchorProjectId = draft?.anchorProjectId ?? workspace.linkedProjectIds[0] ?? null;
  const anchorProject = linkedProjects.find((project) => project.id === anchorProjectId);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      anchorProjectId,
    ),
  );
  const modelSelection = resolveTicketPlanningModelSelection({
    candidates: entries.map((entry) => ({
      instanceId: entry.instanceId,
      driverKind: entry.driverKind,
      ready: isProviderInstancePickerReady(entry),
      defaultModel:
        entry.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
        entry.models.find((model) => !model.isCustom)?.slug ??
        entry.models[0]?.slug ??
        null,
    })),
    preferred: [anchorProject?.defaultModelSelection, sticky],
  });
  return { entries, modelSelection };
}
