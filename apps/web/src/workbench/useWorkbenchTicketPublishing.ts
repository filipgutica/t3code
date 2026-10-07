import type {
  EnvironmentId,
  WorkbenchCreateTicketInput,
  WorkbenchEpicId,
  WorkbenchJiraBinding,
  WorkbenchJiraSnapshot,
  WorkbenchProjectId,
  WorkbenchSnapshot,
  WorkbenchTicket,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { isWorkbenchDraftProjected, type WorkbenchTicketDraft } from "./workbenchDraftStore";
import { getWorkbenchJiraBindingSprints, isWorkbenchJiraEpic } from "./workbenchJira.logic";
import { reportWorkbenchCommandFailure } from "./workbenchPageCommands";

type Publication = {
  readonly environmentId: EnvironmentId;
  readonly ticket: WorkbenchTicket;
  readonly binding: WorkbenchJiraBinding;
  input: WorkbenchCreateTicketInput | null;
};

type PublicationSelection = { jiraSprintId: number; epicId: WorkbenchEpicId | null };
type PublicationContext = Pick<
  Parameters<typeof useWorkbenchTicketPublishing>[0],
  | "environmentId"
  | "selectedProjectId"
  | "snapshot"
  | "jiraSnapshot"
  | "ticketDrafts"
  | "pendingAction"
>;

const validateTicketLocation = ({
  ticket,
  current,
}: {
  ticket: WorkbenchTicket;
  current: PublicationContext;
}): string | null => {
  if (
    current.environmentId === null ||
    current.selectedProjectId !== ticket.projectId ||
    !current.snapshot?.projects.some((project) => project.id === ticket.projectId)
  ) {
    return "The Ticket’s Workspace is no longer selected or available.";
  }
  if (current.jiraSnapshot === null) return "Wait for Jira connection details to load.";
  return null;
};

const validateTicketState = ({
  ticket,
  current,
}: {
  ticket: WorkbenchTicket;
  current: PublicationContext;
}): string | null => {
  const saved = current.snapshot?.tickets.find((candidate) => candidate.id === ticket.id);
  if (!saved || saved.archivedAt)
    return "This Ticket was archived or deleted. Reopen it before publishing.";
  if (saved.revision !== ticket.revision || saved.updatedAt !== ticket.updatedAt) {
    return "This Ticket changed. Close this dialog and reopen it to publish the latest version.";
  }
  if (
    ticket.id.startsWith("jira:") ||
    current.jiraSnapshot?.issueLinks.some((link) => link.ticketId === ticket.id)
  ) {
    return "This Ticket is already linked to Jira.";
  }
  const draft = current.ticketDrafts.get(ticket.id);
  if (draft && !isWorkbenchDraftProjected({ draft, ticket: saved })) {
    return "Save or discard this Ticket’s edits before publishing to Jira.";
  }
  return null;
};

const validateTicket = (input: { ticket: WorkbenchTicket; current: PublicationContext }) =>
  validateTicketLocation(input) ?? validateTicketState(input);

const matchesPublicationScope = ({
  opened,
  current,
}: {
  opened: Publication;
  current: PublicationContext;
}) =>
  current.environmentId === opened.environmentId &&
  current.selectedProjectId === opened.ticket.projectId;

const resolvePublicationBinding = ({
  opened,
  current,
}: {
  opened: Publication;
  current: PublicationContext;
}) => {
  const binding = current.jiraSnapshot?.bindings.find(
    (candidate) =>
      candidate.id === opened.binding.id && candidate.projectId === opened.ticket.projectId,
  );
  if (
    !binding ||
    binding.connectionId !== opened.binding.connectionId ||
    binding.jiraProjectId !== opened.binding.jiraProjectId ||
    binding.boardId !== opened.binding.boardId
  ) {
    return null;
  }
  return binding;
};

const isAvailablePublicationEpic = ({
  epicId,
  opened,
  binding,
  current,
}: {
  epicId: WorkbenchEpicId;
  opened: Publication;
  binding: WorkbenchJiraBinding;
  current: PublicationContext;
}) =>
  current.snapshot?.epics.some(
    (epic) => epic.id === epicId && epic.projectId === opened.ticket.projectId && !epic.archivedAt,
  ) &&
  isWorkbenchJiraEpic({
    epicId,
    bindingId: binding.id,
    epicLinks: current.jiraSnapshot?.epicLinks,
  });

const validatePublicationSelection = ({
  opened,
  current,
  binding,
  selection,
}: {
  opened: Publication;
  current: PublicationContext;
  binding: WorkbenchJiraBinding;
  selection: PublicationSelection;
}): string | null => {
  if (!binding.active) return "Resume the Jira connection before publishing this Ticket.";
  if (binding.localMigrationPending)
    return "Finish the Jira connection’s local data migration before publishing.";
  if (
    !getWorkbenchJiraBindingSprints(binding).some((sprint) => sprint.id === selection.jiraSprintId)
  ) {
    return "The selected Jira sprint is no longer available. Close this dialog and reopen it.";
  }
  if (
    selection.epicId !== null &&
    !isAvailablePublicationEpic({ epicId: selection.epicId, opened, binding, current })
  ) {
    return "Choose an available Jira Epic or publish with no Epic.";
  }
  if (
    opened.input &&
    (opened.input.jiraSprintId !== selection.jiraSprintId ||
      opened.input.epicId !== selection.epicId)
  ) {
    return "Retry with the original sprint and Epic so an existing Jira issue can be recovered safely.";
  }
  return null;
};

const createPublicationInput = ({
  opened,
  selection,
}: {
  opened: Publication;
  selection: PublicationSelection;
}): WorkbenchCreateTicketInput => {
  const ticket = opened.ticket;
  return (
    opened.input ?? {
      id: ticket.id,
      projectId: ticket.projectId,
      title: ticket.title,
      markdown: ticket.markdown,
      kind: ticket.kind,
      epicId: selection.epicId,
      primaryT3ProjectId: ticket.primaryT3ProjectId,
      repositoryProjectIds:
        ticket.repositoryProjectIds.length > 0
          ? ticket.repositoryProjectIds
          : [ticket.primaryT3ProjectId],
      existingLocalTicketRevision: ticket.revision,
      jiraSprintId: selection.jiraSprintId,
      createdAt: ticket.createdAt,
    }
  );
};

const preparePublication = ({
  opened,
  current,
  selection,
}: {
  opened: Publication;
  current: PublicationContext;
  selection: PublicationSelection;
}): { input: WorkbenchCreateTicketInput; error: null } | { input: null; error: string } => {
  const ticketProblem = validateTicket({ ticket: opened.ticket, current });
  if (ticketProblem) return { input: null, error: ticketProblem };
  const binding = resolvePublicationBinding({ opened, current });
  if (!binding)
    return { input: null, error: "The Jira connection changed. Close this dialog and reopen it." };
  const selectionProblem = validatePublicationSelection({ opened, current, binding, selection });
  if (selectionProblem) return { input: null, error: selectionProblem };
  return { input: createPublicationInput({ opened, selection }), error: null };
};

export function useWorkbenchTicketPublishing({
  environmentId,
  selectedProjectId,
  snapshot,
  jiraSnapshot,
  ticketDrafts,
  pendingAction,
  setPendingAction,
  setError,
  refreshWorkbenchSnapshot,
  refreshJiraSnapshot,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly selectedProjectId: WorkbenchProjectId | null;
  readonly snapshot: WorkbenchSnapshot | null;
  readonly jiraSnapshot: WorkbenchJiraSnapshot | null;
  readonly ticketDrafts: ReadonlyMap<WorkbenchTicketId, WorkbenchTicketDraft>;
  readonly pendingAction: string | null;
  readonly setPendingAction: Dispatch<SetStateAction<string | null>>;
  readonly setError: (message: string | null) => void;
  readonly refreshWorkbenchSnapshot: () => void;
  readonly refreshJiraSnapshot: () => void;
}) {
  const createTicket = useAtomCommand(workbenchEnvironment.createTicket, { reportFailure: false });
  const [session, setSession] = useState<Publication | null>(null);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [scope, setScope] = useState({ environmentId, selectedProjectId });
  if (scope.environmentId !== environmentId || scope.selectedProjectId !== selectedProjectId) {
    setScope({ environmentId, selectedProjectId });
    setSession(null);
    setPublicationError(null);
  }
  const sessionRef = useRef<Publication | null>(null);
  const submitting = useRef(false);
  const latest = useRef({
    environmentId,
    selectedProjectId,
    snapshot,
    jiraSnapshot,
    ticketDrafts,
    pendingAction,
  });
  useLayoutEffect(() => {
    latest.current = {
      environmentId,
      selectedProjectId,
      snapshot,
      jiraSnapshot,
      ticketDrafts,
      pendingAction,
    };
    if (
      sessionRef.current &&
      (sessionRef.current.environmentId !== environmentId ||
        sessionRef.current.ticket.projectId !== selectedProjectId)
    )
      sessionRef.current = null;
  }, [environmentId, selectedProjectId, snapshot, jiraSnapshot, ticketDrafts, pendingAction]);

  const fail = (message: string) => {
    setPublicationError(message);
    setError(message);
    return false;
  };
  const openPublication = (ticket: WorkbenchTicket) => {
    const current = latest.current;
    if (current.pendingAction !== null || submitting.current) return;
    const problem = validateTicket({ ticket, current });
    if (problem) {
      fail(problem);
      return;
    }
    const binding = current.jiraSnapshot?.bindings.find(
      (candidate) => candidate.projectId === ticket.projectId,
    );
    if (!binding || current.environmentId === null) {
      fail("Connect this Workspace to Jira before publishing.");
      return;
    }
    const opened = { environmentId: current.environmentId, ticket, binding, input: null };
    sessionRef.current = opened;
    setSession(opened);
    setPublicationError(null);
    setError(null);
  };
  const closePublication = () => {
    if (submitting.current || latest.current.pendingAction !== null) return;
    sessionRef.current = null;
    setSession(null);
    setPublicationError(null);
  };
  const submitPublication = async (opened: Publication, input: WorkbenchCreateTicketInput) => {
    const action = `publish-ticket:${opened.ticket.id}`;
    setPendingAction(action);
    setPublicationError(null);
    setError(null);
    const isCurrent = () =>
      matchesPublicationScope({ opened, current: latest.current }) && sessionRef.current === opened;
    try {
      const result = await createTicket({ environmentId: opened.environmentId, input });
      if (!isCurrent()) return false;
      const failed = reportWorkbenchCommandFailure(result, (message) => {
        fail(message);
      });
      // A failed response can follow a committed Jira issue. Request both snapshot
      // refreshes; retries retain the same input for resumable creation.
      refreshWorkbenchSnapshot();
      refreshJiraSnapshot();
      if (failed) return false;
      sessionRef.current = null;
      setSession(null);
      return true;
    } catch (cause) {
      if (!isCurrent()) return false;
      fail(cause instanceof Error ? cause.message : "Publishing this Ticket to Jira failed.");
      refreshWorkbenchSnapshot();
      refreshJiraSnapshot();
      return false;
    } finally {
      submitting.current = false;
      setPendingAction((current) => (current === action ? null : current));
    }
  };
  const publishTicket = async (selection: PublicationSelection): Promise<boolean> => {
    const opened = sessionRef.current;
    const current = latest.current;
    if (!opened || submitting.current || current.pendingAction !== null) return false;
    if (!matchesPublicationScope({ opened, current })) return false;
    const prepared = preparePublication({ opened, current, selection });
    if (prepared.error !== null) return fail(prepared.error);
    opened.input = prepared.input;
    submitting.current = true;
    return submitPublication(opened, prepared.input);
  };
  const visible =
    session?.environmentId === environmentId &&
    session.ticket.projectId === selectedProjectId &&
    !jiraSnapshot?.issueLinks.some((link) => link.ticketId === session.ticket.id)
      ? session
      : null;
  const binding = visible
    ? jiraSnapshot?.bindings.find((candidate) => candidate.id === visible.binding.id)
    : undefined;
  return {
    publication: visible ? { ticket: visible.ticket, binding: binding ?? visible.binding } : null,
    publicationError,
    openPublication,
    closePublication,
    publishTicket,
  };
}
