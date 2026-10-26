import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  WorkbenchAssignment,
  WorkbenchTicket,
  WorkbenchTicketDraft,
} from "@t3tools/contracts";
import { ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { randomUUID } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { applyTicketProposal, WorkbenchDraftActions } from "./WorkbenchDraftActions";
import { WorkbenchFloatingChat } from "./WorkbenchFloatingChat";
import {
  getWorkbenchBoardChatThreads,
  resolveWorkbenchFloatingChat,
} from "./workbenchFloatingChat.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { failureMessage } from "./workbenchPageCommands";
import { getTicketDraftCreateState } from "./WorkbenchTicketDraftPanel";
import { WorkbenchTicketProposalRenderer } from "./WorkbenchTicketProposal";
import { useTicketDraftEditor, useTicketDraftTransitions } from "./useWorkbenchTicketConversation";
import {
  pickNewestConversationDraft,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";
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
  /** What Create ticket checks a draft against, as on the full draft page. */
  readonly createContext: Omit<Parameters<typeof getTicketDraftCreateState>[0], "fields">;
  /** False for a read-only Workspace, a missing permission, or a host without drafts. */
  readonly canStartDrafts: boolean;
  readonly refreshSnapshot: () => void;
  /** Opens a draft's planning conversation; promoted drafts share the ticket's id. */
  readonly onOpenDraft: (draftId: WorkbenchTicketId) => void;
  /** Opens a ticket's Thread on its route, restoring it first when archived. */
  readonly onOpenThread: (threadId: ThreadId) => void;
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
  // The chat remounts for another Workspace or environment; a late reply must not open there.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
    if (!mountedRef.current) return;
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

type MountedDraftOpen = { readonly threadId: ThreadId; readonly open: () => Promise<void> };

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
  });
  const chat = resolveWorkbenchFloatingChat({
    ...threads,
    primaryThreadId: null,
    explicitThreadId,
  });
  const canBeginDraft = useAtomValue(
    workbenchEnvironment.beginTicketDraft.permissionAtom(environmentId),
  );
  // Drafts keep their planning conversation until Start work finishes.
  const planningDrafts = new Map(
    props.drafts
      .filter((draft) => draft.projectId === projectId && draft.phase !== "working")
      .map((draft) => [draft.threadId, draft]),
  );
  // The mounted draft must save an applied proposal before the full draft page replaces it.
  const mountedDraftOpenRef = useRef<MountedDraftOpen | null>(null);
  const openThread = (threadId: ThreadId) => {
    const mounted = mountedDraftOpenRef.current;
    if (mounted?.threadId === threadId) return void mounted.open();
    const draft = planningDrafts.get(threadId);
    if (draft) props.onOpenDraft(draft.id);
    else props.onOpenThread(threadId);
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
      newThreadDisabled={
        !props.canStartDrafts || !canBeginDraft || !draftBegin.ready || draftBegin.pending
      }
      planning={{
        threadIds: new Set(planningDrafts.keys()),
        render: (threadId, conversation) => {
          const draft = planningDrafts.get(threadId);
          if (!draft) return conversation;
          return (
            <BoardDraftThread
              key={draft.id}
              environmentId={environmentId}
              workspace={workspace}
              snapshotDraft={draft}
              ticket={props.tickets.find((candidate) => candidate.id === draft.id) ?? null}
              linkedProjects={props.linkedProjects}
              createContext={props.createContext}
              refreshSnapshot={props.refreshSnapshot}
              onOpenDraft={() => props.onOpenDraft(draft.id)}
              openRef={mountedDraftOpenRef}
              onDiscarded={() => setExplicitThreadId(null)}
            >
              {conversation}
            </BoardDraftThread>
          );
        },
      }}
    />
  );
}

const canApplyProposal = (
  canOperate: boolean,
  editor: Pick<ReturnType<typeof useTicketDraftEditor>, "editable" | "conflict">,
  transitions: Pick<ReturnType<typeof useTicketDraftTransitions>, "action">,
) => canOperate && editor.editable && editor.conflict === null && transitions.action === null;

/**
 * An applied proposal may still be saving, and the full draft page reads only saved fields.
 * Registers the guard so the chat header's Open full Thread waits for the same save.
 */
function useOpenSavedDraft({
  threadId,
  flush,
  setError,
  onOpenDraft,
  openRef,
}: {
  readonly threadId: ThreadId;
  readonly flush: ReturnType<typeof useTicketDraftEditor>["flush"];
  readonly setError: (message: string) => void;
  readonly onOpenDraft: () => void;
  readonly openRef: RefObject<MountedDraftOpen | null>;
}) {
  const open = async () => {
    const outcome = await flush();
    if (outcome.ok) onOpenDraft();
    else setError(outcome.message);
  };
  useEffect(() => {
    const mounted = { threadId, open };
    openRef.current = mounted;
    return () => {
      if (openRef.current === mounted) openRef.current = null;
    };
  });
  return open;
}

/** The full draft page's rule: the grant, and nothing archived. */
const useCanOperateDraft = ({
  environmentId,
  workspace,
  ticket,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: WorkbenchBoardFloatingChatProps["workspace"];
  readonly ticket: WorkbenchTicket | null;
}) =>
  useAtomValue(workbenchEnvironment.promoteTicketDraft.permissionAtom(environmentId)) &&
  workspace.archivedAt == null &&
  ticket?.archivedAt == null;

/**
 * A draft's conversation in the chat: proposals apply to the draft, and the strip below offers
 * the draft page's actions. Fields are edited on the full draft page, so no edits stay pending.
 */
function BoardDraftThread({
  environmentId,
  workspace,
  snapshotDraft,
  ticket,
  linkedProjects,
  createContext,
  refreshSnapshot,
  onOpenDraft,
  openRef,
  onDiscarded,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: WorkbenchBoardFloatingChatProps["workspace"];
  readonly snapshotDraft: WorkbenchConversationDraft;
  readonly ticket: WorkbenchTicket | null;
  readonly linkedProjects: WorkbenchBoardFloatingChatProps["linkedProjects"];
  readonly createContext: WorkbenchBoardFloatingChatProps["createContext"];
  readonly refreshSnapshot: () => void;
  readonly onOpenDraft: () => void;
  readonly openRef: RefObject<MountedDraftOpen | null>;
  readonly onDiscarded: () => void;
  readonly children: ReactNode;
}) {
  // Command replies can be newer than the snapshot; the newest revision wins.
  const [fromCommand, setFromCommand] = useState<WorkbenchConversationDraft | null>(null);
  const draft = pickNewestConversationDraft(snapshotDraft, fromCommand) ?? snapshotDraft;
  const [discardOpen, setDiscardOpen] = useState(false);
  const canOperate = useCanOperateDraft({ environmentId, workspace, ticket });
  const editor = useTicketDraftEditor({
    environmentId,
    draft,
    onDraft: setFromCommand,
    refreshSnapshot,
  });
  const createState = getTicketDraftCreateState({ ...createContext, fields: editor.fields });
  const transitions = useTicketDraftTransitions({
    environmentId,
    draft,
    projects: linkedProjects,
    editor,
    onDraft: setFromCommand,
    // The chat stays on the board; the tab follows the same Thread through each phase.
    onTicketCreated: setFromCommand,
    onWorkStarted: () => {},
    onDiscarded,
    onClose: () => {},
    onCreateManually: onOpenDraft,
    refreshSnapshot,
  });
  const openSavedDraft = useOpenSavedDraft({
    threadId: draft.threadId,
    flush: editor.flush,
    setError: transitions.setError,
    onOpenDraft,
    openRef,
  });
  return (
    <>
      <WorkbenchTicketProposalRenderer
        environmentId={environmentId}
        threadId={draft.threadId}
        linkedProjects={linkedProjects}
        fields={editor.fields}
        ticket={ticket}
        canApply={canApplyProposal(canOperate, editor, transitions)}
        onApply={applyTicketProposal(editor)}
      >
        {children}
      </WorkbenchTicketProposalRenderer>
      <BoardDraftStrip editor={editor} error={transitions.error} onOpenDraft={openSavedDraft}>
        <WorkbenchDraftActions
          draft={draft}
          editor={editor}
          transitions={transitions}
          createState={createState}
          canOperate={canOperate}
          ticketExists={ticket !== null}
          onDiscard={() => setDiscardOpen(true)}
        />
      </BoardDraftStrip>
      <WorkbenchDiscardDraftDialog
        open={discardOpen}
        busy={transitions.action !== null}
        error={transitions.error}
        onOpenChange={setDiscardOpen}
        onDiscard={transitions.discard}
      />
    </>
  );
}

function BoardDraftStrip({
  editor,
  error: transitionError,
  onOpenDraft,
  children,
}: {
  readonly editor: Pick<ReturnType<typeof useTicketDraftEditor>, "conflict" | "saveError">;
  readonly error: string | null;
  readonly onOpenDraft: () => Promise<void>;
  readonly children: ReactNode;
}) {
  // A conflict explains itself in the actions' status line.
  const error = transitionError ?? (editor.conflict ? null : editor.saveError);
  return (
    <div
      role="group"
      aria-label="Ticket draft"
      className="shrink-0 space-y-2 border-t border-border/60 px-3 py-2"
    >
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {children}
      <Button size="xs" variant="ghost" onClick={() => void onOpenDraft()}>
        <SquareArrowOutUpRightIcon />
        Open draft
      </Button>
    </div>
  );
}
