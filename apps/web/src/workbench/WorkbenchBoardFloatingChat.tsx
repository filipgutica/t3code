import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  WorkbenchAssignment,
  WorkbenchTicket,
  WorkbenchTicketDraft,
} from "@t3tools/contracts";
import { ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { randomUUID } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { WorkbenchFloatingChat } from "./WorkbenchFloatingChat";
import {
  getWorkbenchBoardChatThreads,
  resolveWorkbenchFloatingChat,
} from "./workbenchFloatingChat.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { failureMessage } from "./workbenchPageCommands";
import { usePlanningModelSelection } from "./usePlanningModelSelection";

type ThreadsById = ReadonlyMap<ThreadId, EnvironmentThreadShell>;

interface WorkbenchBoardFloatingChatProps extends Pick<
  Parameters<typeof usePlanningModelSelection>[0],
  "providers" | "linkedProjects" | "workspace"
> {
  readonly environmentId: EnvironmentId;
  /** The Workspace's tickets in board order, before board search and filters. */
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  /** Every draft in the snapshot, in all phases. */
  readonly drafts: ReadonlyArray<WorkbenchTicketDraft>;
  readonly threadsById: ThreadsById;
  readonly archivedThreadsById: ThreadsById;
  readonly ticketKeysById: ReadonlyMap<WorkbenchTicketId, string>;
  /** False for a read-only Workspace, a missing permission, or a host without drafts. */
  readonly canStartDrafts: boolean;
  readonly refreshSnapshot: () => void;
  /** Opens a draft's planning conversation; promoted drafts share the ticket's id. */
  readonly onOpenDraft: (draftId: WorkbenchTicketId) => void;
  readonly onOpenTicketThread: (ticket: WorkbenchTicket, threadId: ThreadId) => void;
}

/** The Workspace's ticket Threads and ticket drafts in the floating chat. Hidden on narrow screens. */
export function WorkbenchBoardFloatingChat(props: WorkbenchBoardFloatingChatProps) {
  const narrow = useMediaQuery("max-sm");
  if (narrow) return null;
  return <BoardFloatingChat key={`${props.environmentId}:${props.workspace.id}`} {...props} />;
}

type DraftAttempt = { readonly id: WorkbenchTicketId; readonly threadId: ThreadId };

/**
 * Each click on New ticket draft begins one draft. A failed attempt keeps its ids, so the next
 * click repeats that begin instead of leaving a second draft behind a lost reply.
 */
function useBeginBoardDraft({
  environmentId,
  workspaceId,
  modelSelection,
  refreshSnapshot,
  onBegun,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspaceId: WorkbenchBoardFloatingChatProps["workspace"]["id"];
  readonly modelSelection: ReturnType<typeof usePlanningModelSelection>["modelSelection"];
  readonly refreshSnapshot: () => void;
  readonly onBegun: (threadId: ThreadId) => void;
}) {
  const beginDraft = useAtomCommand(workbenchEnvironment.beginTicketDraft, {
    reportFailure: false,
  });
  const failedAttemptRef = useRef<DraftAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const begin = async () => {
    if (modelSelection === null || pending) return;
    const attempt = failedAttemptRef.current ?? {
      id: WorkbenchTicketId.make(randomUUID()),
      threadId: ThreadId.make(randomUUID()),
    };
    failedAttemptRef.current = attempt;
    setPending(true);
    const result = await beginDraft({
      environmentId,
      input: { ...attempt, projectId: workspaceId, modelSelection },
    });
    setPending(false);
    if (result._tag === "Failure") {
      refreshSnapshot();
      toastManager.add({
        type: "error",
        title: "Could not start a ticket draft",
        description: failureMessage(result),
      });
      return;
    }
    failedAttemptRef.current = null;
    onBegun(attempt.threadId);
  };
  return { begin, pending, ready: modelSelection !== null };
}

function BoardFloatingChat(props: WorkbenchBoardFloatingChatProps) {
  const { environmentId, workspace } = props;
  const [explicitThreadId, setExplicitThreadId] = useState<ThreadId | null>(null);
  const showThread = (threadId: ThreadId) => {
    setExplicitThreadId(threadId);
    useWorkbenchFloatingChatStore.getState().expand(threadId);
  };
  const projectId = workspace.id;
  useEffect(() => {
    const { setPageChat, expand } = useWorkbenchFloatingChatStore.getState();
    setPageChat({
      environmentId,
      kind: "board",
      projectId,
      showThread: (threadId) => {
        setExplicitThreadId(threadId);
        expand(threadId);
      },
    });
    return () => setPageChat(null);
  }, [environmentId, projectId]);
  const { modelSelection } = usePlanningModelSelection({
    environmentId,
    providers: props.providers,
    linkedProjects: props.linkedProjects,
    workspace,
    draft: null,
  });
  const draftBegin = useBeginBoardDraft({
    environmentId,
    workspaceId: projectId,
    modelSelection,
    refreshSnapshot: props.refreshSnapshot,
    onBegun: showThread,
  });
  const threads = getWorkbenchBoardChatThreads({
    projectId,
    tickets: props.tickets,
    assignments: props.assignments,
    drafts: props.drafts,
    threadsById: props.threadsById,
    archivedThreadsById: props.archivedThreadsById,
    ticketKeysById: props.ticketKeysById,
  });
  const chat = resolveWorkbenchFloatingChat({
    ...threads,
    primaryThreadId: null,
    explicitThreadId,
  });
  const openThread = (threadId: ThreadId) => {
    const draft = props.drafts.find(
      (candidate) =>
        candidate.threadId === threadId &&
        candidate.projectId === projectId &&
        candidate.phase !== "working",
    );
    if (draft) return props.onOpenDraft(draft.id);
    const assignment = props.assignments.find((candidate) => candidate.threadId === threadId);
    const ticket = props.tickets.find((candidate) => candidate.id === assignment?.ticketId);
    if (ticket) props.onOpenTicketThread(ticket, threadId);
  };
  return (
    <WorkbenchFloatingChat
      environmentId={environmentId}
      kind="board"
      label={workspace.title}
      chat={chat}
      onSelectThread={setExplicitThreadId}
      onOpenThread={openThread}
      onNewThread={() => void draftBegin.begin()}
      newThreadDisabled={!props.canStartDrafts || !draftBegin.ready || draftBegin.pending}
    />
  );
}
