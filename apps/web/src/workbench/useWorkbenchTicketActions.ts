import type {
  EnvironmentId,
  WorkbenchTicketId,
  WorkbenchTicket,
  WorkbenchSnapshot,
  WorkbenchJiraSnapshot,
} from "@t3tools/contracts";
import { useState, type RefObject } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";
import {
  resolveWorkbenchTicketContent,
  resolveWorkbenchTicketUpdateFields,
} from "./workbenchJira.logic";
import {
  isWorkbenchDraftProjected,
  type WorkbenchTicketDraft,
  type WorkbenchTicketSavedVersion,
} from "./workbenchDraftStore";
import type { useOptimisticWorkbenchStatus } from "./useOptimisticWorkbenchStatus";
import type { useWorkbenchJiraBindings } from "./useWorkbenchJiraBindings";
import type { WorkbenchJiraTransitionSelection } from "./WorkbenchTicketStatusMenu";
import {
  getWorkbenchRepositoryScope,
  isWorkbenchRepositoryScopeEqual,
  type WorkbenchRepositoryScope,
  type WorkbenchRepositoryScopeDraft,
} from "./workbenchRepositoryScope";

type WorkbenchTicketPatch = Partial<
  Pick<
    WorkbenchTicket,
    | "title"
    | "markdown"
    | "kind"
    | "epicId"
    | "repositoryProjectIds"
    | "primaryT3ProjectId"
    | "status"
    | "blocked"
  >
>;

export function useWorkbenchTicketActions({
  environmentId,
  pendingAction,
  setPendingAction,
  setError,
  optimisticStatus,
  jiraOwnershipKnown,
  ticketDrafts,
  jiraIssueLinksByTicketId,
  jiraManagedTicketIds,
  statusEnvironmentRef,
  snapshot,
  jiraSnapshot,
  refreshWorkbenchSnapshot,
  refreshJiraSnapshot,
  syncJiraBinding,
  clearTicketDraft,
  closeWorkItem,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly pendingAction: string | null;
  readonly setPendingAction: (action: string | null) => void;
  readonly setError: (message: string | null) => void;
  readonly optimisticStatus: ReturnType<typeof useOptimisticWorkbenchStatus>;
  readonly jiraOwnershipKnown: boolean;
  readonly ticketDrafts: ReadonlyMap<WorkbenchTicketId, WorkbenchTicketDraft>;
  readonly jiraIssueLinksByTicketId: ReadonlyMap<
    WorkbenchTicketId,
    WorkbenchJiraSnapshot["issueLinks"][number]
  >;
  readonly jiraManagedTicketIds: ReadonlySet<WorkbenchTicketId>;
  readonly statusEnvironmentRef: RefObject<EnvironmentId | null>;
  readonly snapshot: WorkbenchSnapshot | null;
  readonly jiraSnapshot: WorkbenchJiraSnapshot | null;
  readonly refreshWorkbenchSnapshot: () => unknown;
  readonly refreshJiraSnapshot: () => unknown;
  readonly syncJiraBinding: ReturnType<typeof useWorkbenchJiraBindings>["syncJiraBinding"];
  readonly clearTicketDraft: (environmentId: EnvironmentId, ticketId: WorkbenchTicketId) => void;
  readonly closeWorkItem: () => void;
}) {
  const updateTicket = useAtomCommand(workbenchEnvironment.updateTicket, { reportFailure: false });
  const regenerateTicketSummary = useAtomCommand(workbenchEnvironment.regenerateTicketSummary, {
    reportFailure: false,
  });
  const updateJiraTicket = useAtomCommand(workbenchEnvironment.jiraUpdateTicket, {
    reportFailure: false,
  });
  const archiveTicket = useAtomCommand(workbenchEnvironment.archiveTicket, {
    reportFailure: false,
  });
  const deleteTicket = useAtomCommand(workbenchEnvironment.deleteTicket, {
    reportFailure: false,
  });
  const prepareTicketWorkspace = useAtomCommand(workbenchEnvironment.prepareTicketWorkspace, {
    reportFailure: false,
  });
  const releaseTicketWorkspace = useAtomCommand(workbenchEnvironment.releaseTicketWorkspace, {
    reportFailure: false,
  });
  const [workspacePreparationFailure, setWorkspacePreparationFailure] =
    useState<WorkbenchTicketId | null>(null);
  const [scopeDraft, setScopeDraft] = useState<WorkbenchRepositoryScopeDraft | null>(null);
  const repositoryScopeDraft = scopeDraft?.environmentId === environmentId ? scopeDraft : null;
  const editRepositories = ({ ticket, prepare }: { ticket: WorkbenchTicket; prepare: boolean }) => {
    if (environmentId === null || pendingAction !== null) return;
    setError(null);
    setScopeDraft((current) => ({
      environmentId,
      ticket:
        current?.environmentId === environmentId && current.ticket.id === ticket.id
          ? current.ticket
          : ticket,
      value:
        current?.environmentId === environmentId && current.ticket.id === ticket.id
          ? current.value
          : getWorkbenchRepositoryScope(ticket),
      prepare,
    }));
  };
  const changeRepositoryScope = (value: WorkbenchRepositoryScope) => {
    setScopeDraft((current) =>
      current?.environmentId === environmentId ? { ...current, value } : current,
    );
  };
  const cancelRepositoryScope = () => {
    if (pendingAction !== null) return;
    setScopeDraft(null);
    setError(null);
  };
  const clearRepositoryScope = () => setScopeDraft(null);
  const acceptSavedRepositoryScope = (ticket: WorkbenchTicket) => {
    setScopeDraft((current) =>
      current?.environmentId === environmentId && current.ticket.id === ticket.id
        ? {
            ...current,
            ticket,
            value: getWorkbenchRepositoryScope(ticket),
            prepare: true,
          }
        : current,
    );
  };
  const saveRepositories = async () => {
    const draft = repositoryScopeDraft;
    if (environmentId === null || draft === null || pendingAction !== null) return false;
    const latestTicket = snapshot?.tickets.find((ticket) => ticket.id === draft.ticket.id);
    if (
      !latestTicket ||
      latestTicket.archivedAt != null ||
      latestTicket.revision !== draft.ticket.revision
    ) {
      setError(
        "This Ticket changed. Cancel repository edits and review its current choices before saving.",
      );
      return false;
    }
    const workspace = snapshot?.ticketWorkspaces.find(
      (candidate) => candidate.ticketId === draft.ticket.id,
    );
    if (workspace?.status === "preparing" || workspace?.status === "releasing") return false;
    setPendingAction(`update-repositories:${draft.ticket.id}`);
    setError(null);
    let savedTicket = draft.ticket;
    const changed = !isWorkbenchRepositoryScopeEqual(draft.ticket, draft.value);
    try {
      if (changed) {
        const saved = await updateTicket({
          environmentId,
          input: {
            id: draft.ticket.id,
            expectedRevision: draft.ticket.revision,
            ...draft.value,
            updatedAt: new Date().toISOString(),
          },
        });
        if (reportWorkbenchCommandFailure(saved, setError)) {
          refreshWorkbenchSnapshot();
          return false;
        }
        savedTicket = saved.value;
      }
      if (draft.prepare || (changed && workspace?.status === "ready")) {
        setWorkspacePreparationFailure(null);
        setPendingAction(`prepare-workspace:${draft.ticket.id}`);
        const prepared = await prepareTicketWorkspace({
          environmentId,
          input: { ticketId: savedTicket.id, requestedAt: new Date().toISOString() },
        });
        if (
          reportWorkbenchCommandFailure(prepared, (message) =>
            setError(`Repository choices saved. Workspace preparation failed: ${message}`),
          )
        ) {
          setWorkspacePreparationFailure(savedTicket.id);
          setScopeDraft({
            ...draft,
            ticket: savedTicket,
            value: getWorkbenchRepositoryScope(savedTicket),
            prepare: true,
          });
          refreshWorkbenchSnapshot();
          return false;
        }
      }
      setScopeDraft(null);
      return true;
    } finally {
      setPendingAction(null);
    }
  };
  const updateTicketFields = async (
    ticket: WorkbenchTicket,
    patch: WorkbenchTicketPatch,
  ): Promise<WorkbenchTicketSavedVersion | false> => {
    if (
      environmentId === null ||
      pendingAction !== null ||
      optimisticStatus.pendingTicketIds.has(ticket.id)
    )
      return false;
    const jiraFieldsChanged = patch.markdown !== undefined || patch.status !== undefined;
    if (jiraFieldsChanged && !jiraOwnershipKnown) {
      setError("Jira ownership is still loading. Try again in a moment.");
      return false;
    }
    const draft = ticketDrafts.get(ticket.id);
    if (patch.status !== undefined && draft?.mode === "editing") {
      setError("Save or cancel this Ticket's edits before changing its status.");
      return false;
    }
    const jiraIssueLink = jiraIssueLinksByTicketId.get(ticket.id);
    if (jiraIssueLink !== undefined && jiraFieldsChanged) {
      return saveJiraTicketFields({ environmentId, ticket, patch, draft, jiraIssueLink });
    }
    return saveLocalTicketFields({ environmentId, ticket, patch, draft });
  };

  const saveJiraTicketFields = async ({
    environmentId,
    ticket,
    patch,
    draft,
    jiraIssueLink,
  }: {
    environmentId: EnvironmentId;
    ticket: WorkbenchTicket;
    patch: WorkbenchTicketPatch;
    draft: WorkbenchTicketDraft | undefined;
    jiraIssueLink: WorkbenchJiraSnapshot["issueLinks"][number];
  }): Promise<WorkbenchTicketSavedVersion | false> => {
    const expectedRemoteUpdatedAt =
      patch.markdown !== undefined && draft?.mode === "editing"
        ? (draft.jiraRemoteUpdatedAt ?? null)
        : jiraIssueLink.issue.remoteUpdatedAt;
    setPendingAction(`jira-update:${ticket.id}`);
    setError(null);
    const result = await updateJiraTicket({
      environmentId,
      input: {
        ticketId: ticket.id,
        ...(patch.markdown !== undefined ? { markdown: patch.markdown } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        expectedRemoteUpdatedAt,
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    return { jiraRemoteUpdatedAt: result.value.remoteUpdatedAt };
  };

  const saveLocalTicketFields = async ({
    environmentId,
    ticket,
    patch,
    draft,
  }: {
    environmentId: EnvironmentId;
    ticket: WorkbenchTicket;
    patch: WorkbenchTicketPatch;
    draft: WorkbenchTicketDraft | undefined;
  }): Promise<WorkbenchTicketSavedVersion | false> => {
    const fields = resolveWorkbenchTicketUpdateFields({
      patch,
      jiraFieldsManaged: jiraManagedTicketIds.has(ticket.id),
    });
    const statusToken =
      patch.status !== undefined
        ? optimisticStatus.begin({ ticketId: ticket.id, status: patch.status })
        : null;
    if (statusToken === false) return false;
    if (statusToken === null) setPendingAction(`update:${ticket.id}`);
    setError(null);
    const expectedRevision = ticketEditRevision({ ticket, patch, draft });
    const result = await updateTicket({
      environmentId,
      input: {
        id: ticket.id,
        expectedRevision,
        ...fields,
        updatedAt: new Date().toISOString(),
      },
    });
    if (statusToken !== null && statusEnvironmentRef.current !== environmentId) return false;
    if (
      reportWorkbenchCommandFailure(result, (message) =>
        setError(statusToken === null ? message : `${ticket.title}: ${message}`),
      )
    ) {
      if (statusToken === null) setPendingAction(null);
      if (statusToken !== null) optimisticStatus.fail(statusToken);
      refreshWorkbenchSnapshot();
      return false;
    }
    if (statusToken !== null) {
      optimisticStatus.succeed({ token: statusToken, revision: result.value.revision });
    }
    await prepareChangedRepositories({ environmentId, ticket, patch });
    if (statusToken === null) setPendingAction(null);
    return { revision: result.value.revision };
  };

  const prepareChangedRepositories = async ({
    environmentId,
    ticket,
    patch,
  }: {
    environmentId: EnvironmentId;
    ticket: WorkbenchTicket;
    patch: WorkbenchTicketPatch;
  }) => {
    const workspace = snapshot?.ticketWorkspaces.find(
      (candidate) => candidate.ticketId === ticket.id,
    );
    if (
      (patch.repositoryProjectIds !== undefined || patch.primaryT3ProjectId !== undefined) &&
      workspace?.status === "ready"
    ) {
      setWorkspacePreparationFailure(null);
      setPendingAction(`prepare-workspace:${ticket.id}`);
      const preparation = await prepareTicketWorkspace({
        environmentId,
        input: { ticketId: ticket.id, requestedAt: new Date().toISOString() },
      });
      if (
        reportWorkbenchCommandFailure(preparation, (message) =>
          setError(`Repository selection saved. Workspace preparation failed: ${message}`),
        )
      ) {
        setWorkspacePreparationFailure(ticket.id);
        refreshWorkbenchSnapshot();
      }
    }
  };

  const changeJiraTransition = async ({
    ticket,
    transitionId,
    destination,
    expectedRemoteUpdatedAt,
  }: WorkbenchJiraTransitionSelection) => {
    if (environmentId === null || pendingAction !== null) return;
    if (!jiraOwnershipKnown || !jiraIssueLinksByTicketId.has(ticket.id)) {
      setError("Jira ownership changed. Refresh the Ticket and try again.");
      return;
    }
    if (ticketDrafts.get(ticket.id)?.mode === "editing") {
      setError("Save or cancel this Ticket's description edits before changing its status.");
      return;
    }
    const link = jiraSnapshot?.issueLinks.find((candidate) => candidate.ticketId === ticket.id);
    const binding = jiraSnapshot?.bindings.find((candidate) => candidate.id === link?.bindingId);
    const mappedStatus = binding?.statusMappings.find(
      (mapping) => mapping.jiraStatusId === destination.id,
    )?.workbenchStatus;
    if (mappedStatus === undefined) {
      setError("This Jira status is no longer mapped to the board. Refresh Jira and try again.");
      return;
    }
    const token = optimisticStatus.begin({
      ticketId: ticket.id,
      status: mappedStatus,
      jiraStatus: destination,
    });
    if (token === false) return;
    setError(null);
    const result = await updateJiraTicket({
      environmentId,
      input: { ticketId: ticket.id, transitionId, expectedRemoteUpdatedAt },
    });
    if (statusEnvironmentRef.current !== environmentId) return;
    if (
      reportWorkbenchCommandFailure(result, (message) => setError(`${ticket.title}: ${message}`))
    ) {
      optimisticStatus.fail(token);
      refreshWorkbenchSnapshot();
      refreshJiraSnapshot();
      if (binding) void syncJiraBinding(binding);
      return;
    }
    optimisticStatus.succeed({
      token,
      jiraIssue: result.value,
      status:
        binding?.statusMappings.find((mapping) => mapping.jiraStatusId === result.value.status.id)
          ?.workbenchStatus ?? mappedStatus,
    });
  };

  const changeTicket = (ticket: WorkbenchTicket, patch: WorkbenchTicketPatch) => {
    void updateTicketFields(ticket, patch);
  };

  const setTicketArchived = async (ticket: WorkbenchTicket, archivedAt: string | null) => {
    if (
      environmentId === null ||
      !jiraOwnershipKnown ||
      jiraManagedTicketIds.has(ticket.id) ||
      pendingAction !== null
    )
      return false;
    setPendingAction(`archive:${ticket.id}`);
    setError(null);
    const result = await archiveTicket({
      environmentId,
      input: {
        ticketId: ticket.id,
        archivedAt,
        expectedRevision: ticket.revision,
        updatedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    clearTicketDraft(environmentId, ticket.id);
    if (archivedAt !== null) closeWorkItem();
    return true;
  };

  const removeTicket = async (ticket: WorkbenchTicket) => {
    if (
      environmentId === null ||
      !jiraOwnershipKnown ||
      jiraManagedTicketIds.has(ticket.id) ||
      pendingAction !== null
    )
      return false;
    setPendingAction(`delete:${ticket.id}`);
    setError(null);
    const result = await deleteTicket({
      environmentId,
      input: {
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        deletedAt: new Date().toISOString(),
      },
    });
    setPendingAction(null);
    if (reportWorkbenchCommandFailure(result, setError)) return false;
    clearTicketDraft(environmentId, ticket.id);
    closeWorkItem();
    return true;
  };

  const resetTicketWorkspace = async (ticket: WorkbenchTicket) => {
    if (environmentId === null || pendingAction !== null) return false;
    setPendingAction(`reset-workspace:${ticket.id}`);
    setError(null);
    const result = await releaseTicketWorkspace({
      environmentId,
      input: { ticketId: ticket.id, releasedAt: new Date().toISOString() },
    });
    setPendingAction(null);
    return !reportWorkbenchCommandFailure(result, setError);
  };

  const ticketForBoardAction = (ticket: WorkbenchTicket) => {
    const draft = ticketDrafts.get(ticket.id);
    const projectedTicket = {
      ...ticket,
      ...resolveWorkbenchTicketContent({
        ticket,
        jiraIssue: jiraIssueLinksByTicketId.get(ticket.id)?.issue,
      }),
    };
    return draft?.mode === "saved" &&
      !isWorkbenchDraftProjected({
        draft,
        ticket: projectedTicket,
        jiraRemoteUpdatedAt: jiraIssueLinksByTicketId.get(ticket.id)?.issue.remoteUpdatedAt,
      })
      ? {
          ...projectedTicket,
          title: jiraManagedTicketIds.has(ticket.id) ? projectedTicket.title : draft.title,
          markdown: draft.markdown,
        }
      : projectedTicket;
  };

  const saveTicketContent = (ticket: WorkbenchTicket, title: string, markdown: string) => {
    if (title.trim().length === 0) return Promise.resolve(false as const);
    return updateTicketFields(ticket, { title: title.trim(), markdown: markdown.trim() });
  };

  const regenerateSummary = async (ticket: WorkbenchTicket) => {
    if (environmentId === null || pendingAction !== null || ticket.archivedAt != null) return;
    const draft = ticketDrafts.get(ticket.id);
    const projectedTicket = {
      ...ticket,
      ...resolveWorkbenchTicketContent({
        ticket,
        jiraIssue: jiraIssueLinksByTicketId.get(ticket.id)?.issue,
      }),
    };
    const hasUnsavedChanges =
      draft?.mode === "editing" &&
      (draft.markdown !== projectedTicket.markdown ||
        (!jiraManagedTicketIds.has(ticket.id) && draft.title !== projectedTicket.title));
    if (hasUnsavedChanges) {
      setError("Save changes to update summary.");
      return;
    }
    setPendingAction(`summary:${ticket.id}`);
    setError(null);
    const result = await regenerateTicketSummary({
      environmentId,
      input: { ticketId: ticket.id },
    });
    setPendingAction(null);
    reportWorkbenchCommandFailure(result, setError);
  };

  return {
    repositoryScopeDraft,
    editRepositories,
    changeRepositoryScope,
    cancelRepositoryScope,
    clearRepositoryScope,
    acceptSavedRepositoryScope,
    saveRepositories,
    workspacePreparationFailure,
    changeTicket,
    changeJiraTransition,
    setTicketArchived,
    removeTicket,
    resetTicketWorkspace,
    ticketForBoardAction,
    saveTicketContent,
    regenerateSummary,
  };
}

function ticketEditRevision({
  ticket,
  patch,
  draft,
}: {
  ticket: WorkbenchTicket;
  patch: WorkbenchTicketPatch;
  draft: WorkbenchTicketDraft | undefined;
}) {
  return (patch.title !== undefined || patch.markdown !== undefined) && draft?.mode === "editing"
    ? (draft.revision ?? ticket.revision)
    : ticket.revision;
}
