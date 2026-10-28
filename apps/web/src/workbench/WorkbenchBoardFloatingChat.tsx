import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  WorkbenchAssignment,
  WorkbenchTicket,
  WorkbenchTicketDraft,
} from "@t3tools/contracts";
import { ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { toastManager } from "../components/ui/toast";
import { useThreadHasUnsentDraft } from "../composerDraftStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { randomUUID } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { WorkbenchDraftActions } from "./WorkbenchDraftActions";
import {
  WorkbenchFloatingChat,
  type WorkbenchFloatingChatTicketThread,
} from "./WorkbenchFloatingChat";
import {
  getWorkbenchBoardChatThreads,
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";
import { failureMessage } from "./workbenchPageCommands";
import { getTicketDraftCreateState } from "./WorkbenchTicketDraftPanel";
import {
  useRefreshOnThreadActivity,
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";
import {
  pickNewestConversationDraft,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";
import { usePlanningModelSelection } from "./usePlanningModelSelection";
import { useWorkbenchThreadRecaps } from "./useWorkbenchThreadRecaps";
import type { WorkbenchReferencesByTicket } from "./workbenchReferences.logic";

type ThreadsById = ReadonlyMap<ThreadId, EnvironmentThreadShell>;

interface WorkbenchBoardFloatingChatProps extends Pick<
  Parameters<typeof usePlanningModelSelection>[0],
  "providers" | "linkedProjects" | "workspace"
> {
  readonly environmentId: EnvironmentId;
  /** The Workspace's tickets in board order, before board search and filters. */
  readonly tickets: ReadonlyArray<WorkbenchTicket>;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly referencesByTicket: WorkbenchReferencesByTicket;
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
  /** Starts another Thread on a ticket through the start-Thread dialog. */
  readonly onNewTicketThread: (ticket: WorkbenchTicket) => void;
  readonly newTicketThreadDisabled: boolean;
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
  readonly onBegun: (threadId: ThreadId, from: ThreadId | null) => void;
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
  const begin = async (from: ThreadId | null) => {
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
    onBegun(attempt.threadId, from);
  };
  return { begin, pending, ready: modelSelection !== null };
}

function BoardFloatingChat(props: WorkbenchBoardFloatingChatProps) {
  const { environmentId, workspace } = props;
  const projectId = workspace.id;
  const pageChatKey = `${environmentId}:board:${projectId}`;
  const explicitThreadId = useWorkbenchFloatingChatStore(
    (state) => state.pickedThreads[pageChatKey] ?? null,
  );
  const setExplicitThreadId = (threadId: ThreadId | null) =>
    useWorkbenchFloatingChatStore.getState().pickThread(pageChatKey, threadId);
  const showThread = (threadId: ThreadId) => {
    setExplicitThreadId(threadId);
    useWorkbenchFloatingChatStore.getState().expand(threadId);
  };
  useEffect(() => {
    const { setPageChat, pickThread, expand } = useWorkbenchFloatingChatStore.getState();
    setPageChat({
      environmentId,
      kind: "board",
      projectId,
      showThread: (threadId) => {
        pickThread(pageChatKey, threadId);
        expand(threadId);
      },
    });
    return () => setPageChat(null);
  }, [environmentId, projectId, pageChatKey]);
  const { modelSelection } = usePlanningModelSelection({
    environmentId,
    providers: props.providers,
    linkedProjects: props.linkedProjects,
    workspace,
    draft: null,
  });
  // Leaving a draft through Cancel or Discard returns to the Thread it was started from.
  const draftReturnsRef = useRef(new Map<ThreadId, ThreadId | null>());
  const draftBegin = useBeginBoardDraft({
    environmentId,
    workspaceId: projectId,
    modelSelection,
    refreshSnapshot: props.refreshSnapshot,
    onBegun: (threadId, from) => {
      draftReturnsRef.current.set(threadId, from);
      showThread(threadId);
    },
  });
  const threads = getWorkbenchBoardChatThreads({
    projectId,
    tickets: props.tickets,
    assignments: props.assignments,
    drafts: props.drafts,
    threadsById: props.threadsById,
    archivedThreadsById: props.archivedThreadsById,
    recaps: useWorkbenchThreadRecaps(environmentId),
    referencesByTicket: props.referencesByTicket,
  });
  const chat = resolveWorkbenchFloatingChat({
    ...threads,
    primaryThreadId: null,
    explicitThreadId,
  });
  useRefreshOnThreadActivity(
    chat.selected ? scopeThreadRef(environmentId, chat.selected.threadId) : null,
    props.refreshSnapshot,
  );
  const canBeginDraft = useAtomValue(
    workbenchEnvironment.beginTicketDraft.permissionAtom(environmentId),
  );
  // Drafts keep their planning conversation until Start work finishes.
  const planningDrafts = new Map(
    props.drafts
      .filter((draft) => draft.projectId === projectId && draft.phase !== "working")
      .map((draft) => [draft.threadId, draft]),
  );
  const openThread = (threadId: ThreadId) => {
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
      onNewThread={() => void draftBegin.begin(chat.selected?.threadId ?? null)}
      newThreadDisabled={
        !props.canStartDrafts || !canBeginDraft || !draftBegin.ready || draftBegin.pending
      }
      ticketThread={getNewTicketThread(chat.selected, planningDrafts, props)}
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
              createContext={props.createContext}
              refreshSnapshot={props.refreshSnapshot}
              onOpenDraft={() => props.onOpenDraft(draft.id)}
              neverRan={props.threadsById.get(threadId)?.latestRun == null}
              onDiscarded={() => setExplicitThreadId(draftReturnsRef.current.get(threadId) ?? null)}
            >
              {conversation}
            </BoardDraftThread>
          );
        },
      }}
    />
  );
}

/** A new Thread joins the showing Thread's ticket; a draft's ticket waits for Start work. */
const getNewTicketThread = (
  selected: WorkbenchFloatingChatThread | null,
  planningDrafts: ReadonlyMap<ThreadId, WorkbenchTicketDraft>,
  props: Pick<
    WorkbenchBoardFloatingChatProps,
    "tickets" | "newTicketThreadDisabled" | "onNewTicketThread"
  >,
): WorkbenchFloatingChatTicketThread | null => {
  if (!selected?.ticket || planningDrafts.has(selected.threadId)) return null;
  const ticket = props.tickets.find((candidate) => candidate.id === selected.ticket?.id);
  if (!ticket) return null;
  return {
    ticket: selected.ticket,
    disabled: props.newTicketThreadDisabled || ticket.archivedAt != null,
    onStart: () => props.onNewTicketThread(ticket),
  };
};

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

/** Nothing was sent, typed, or written, so leaving the draft loses nothing. */
const useIsUntouchedDraft = (
  environmentId: EnvironmentId,
  threadId: ThreadId,
  neverRan: boolean,
  fields: { readonly title: string; readonly markdown: string },
) =>
  !useThreadHasUnsentDraft(scopeThreadRef(environmentId, threadId)) &&
  neverRan &&
  fields.title.trim() === "" &&
  fields.markdown.trim() === "";

/**
 * A draft's conversation in the chat, with the draft page's actions in the strip below. The agent
 * fills the fields through MCP, and people edit them on the full draft page.
 */
function BoardDraftThread({
  environmentId,
  workspace,
  snapshotDraft,
  ticket,
  createContext,
  refreshSnapshot,
  onOpenDraft,
  neverRan,
  onDiscarded,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: WorkbenchBoardFloatingChatProps["workspace"];
  readonly snapshotDraft: WorkbenchConversationDraft;
  readonly ticket: WorkbenchTicket | null;
  readonly createContext: WorkbenchBoardFloatingChatProps["createContext"];
  readonly refreshSnapshot: () => void;
  readonly onOpenDraft: () => void;
  /** No message was ever sent, so the conversation holds nothing to lose. */
  readonly neverRan: boolean;
  readonly onDiscarded: () => void;
  readonly children: ReactNode;
}) {
  // Command replies can be newer than the snapshot; the newest revision wins.
  const [fromCommand, setFromCommand] = useState<WorkbenchConversationDraft | null>(null);
  const draft = pickNewestConversationDraft(snapshotDraft, fromCommand) ?? snapshotDraft;
  const canOperate = useCanOperateDraft({ environmentId, workspace, ticket });
  const editor = useTicketDraftEditor({
    environmentId,
    draft,
    onDraft: setFromCommand,
    refreshSnapshot,
  });
  const createState = getTicketDraftCreateState({ ...createContext, fields: editor.fields });
  const untouched = useIsUntouchedDraft(environmentId, draft.threadId, neverRan, editor.fields);
  const transitions = useTicketDraftTransitions({
    environmentId,
    draft,
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
  return (
    <>
      {children}
      <BoardDraftStrip
        draft={draft}
        editor={editor}
        transitions={transitions}
        createState={createState}
        canOperate={canOperate}
        ticketExists={ticket !== null}
        untouched={untouched}
      />
    </>
  );
}

function BoardDraftStrip({
  editor,
  transitions,
  untouched,
  ...actions
}: Omit<Parameters<typeof WorkbenchDraftActions>[0], "onDiscard" | "layout" | "onCancel"> & {
  readonly editor: ReturnType<typeof useTicketDraftEditor>;
  readonly transitions: ReturnType<typeof useTicketDraftTransitions>;
  readonly untouched: boolean;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  // A conflict explains itself in the actions' status line.
  const error = transitions.error ?? (editor.conflict ? null : editor.saveError);
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
      <WorkbenchDraftActions
        {...actions}
        editor={editor}
        transitions={transitions}
        layout="inline"
        onCancel={untouched ? () => void transitions.discard() : null}
        onDiscard={() => setDiscardOpen(true)}
      />
      <WorkbenchDiscardDraftDialog
        open={discardOpen}
        busy={transitions.action !== null}
        error={transitions.error}
        onOpenChange={setDiscardOpen}
        onDiscard={transitions.discard}
      />
    </div>
  );
}
