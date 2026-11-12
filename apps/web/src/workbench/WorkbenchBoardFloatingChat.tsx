import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  WorkbenchAssignment,
  WorkbenchTicket,
  WorkbenchTicketDraft,
} from "@t3tools/contracts";
import type { ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { useThreadHasUnsentDraft } from "../composerDraftStore";
import { useUiStateStore } from "../uiStateStore";
import { workbenchEnvironment } from "./state";
import { WorkbenchDiscardDraftDialog } from "./WorkbenchDiscardDraftDialog";
import { WorkbenchDraftNavigationGuard } from "./WorkbenchDraftNavigationGuard";
import { WorkbenchDraftActions } from "./WorkbenchDraftActions";
import { WorkbenchDraftCard } from "./WorkbenchDraftCard";
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
import { getTicketDraftCreateState } from "./WorkbenchTicketDraftPanel";
import {
  useTicketDraftBegin,
  useRefreshOnThreadActivity,
  useTicketDraftEditor,
  useTicketDraftTransitions,
} from "./useWorkbenchTicketConversation";
import {
  isUnsavedConversationDraft,
  pickNewestConversationDraft,
  type WorkbenchConversationDraft,
} from "./workbenchTicketDraft.logic";
import { usePlanningModelSelection } from "./usePlanningModelSelection";
import { useWorkbenchThreadRecaps } from "./useWorkbenchThreadRecaps";
import { WorkbenchDraftReferences, workbenchProvenanceSource } from "./WorkbenchReferences";
import { useWorkbenchDraftBriefReview } from "./useWorkbenchBriefReview";
import {
  getReferenceFileCwd,
  getTicketReferences,
  type WorkbenchReferencesByTicket,
} from "./workbenchReferences.logic";

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
  readonly draftRequest?: {
    readonly id: WorkbenchTicketId | null;
    readonly draft: WorkbenchConversationDraft | null;
  } | null;
  readonly onNewDraft: () => void;
  readonly onDraftPrepared: (draft: WorkbenchConversationDraft) => void;
  readonly onCreateManually: () => void;
  readonly onDraftClosed: () => void;
  readonly refreshSnapshot: () => void;
  /** Opens a draft's planning conversation; promoted drafts share the ticket's id. */
  readonly onOpenDraft: (draftId: WorkbenchTicketId) => void;
  /** Opens a ticket's Thread on its route, restoring it first when archived. */
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** Starts another Thread on a ticket through the start-Thread dialog. */
  readonly onNewTicketThread: (ticket: WorkbenchTicket) => void;
  readonly newTicketThreadDisabled: boolean;
}

/** The Board owns Ticket drafting, including startup and recovery. */
export function WorkbenchBoardFloatingChat(props: WorkbenchBoardFloatingChatProps) {
  return <BoardFloatingChat key={`${props.environmentId}:${props.workspace.id}`} {...props} />;
}

function useBoardDraftRequest({
  props,
  showThread,
  selectThread,
}: {
  readonly props: WorkbenchBoardFloatingChatProps;
  readonly showThread: (threadId: ThreadId) => void;
  readonly selectThread: (threadId: ThreadId | null) => void;
}) {
  const [fromCommand, setFromCommand] = useState<WorkbenchConversationDraft | null>(null);
  const { environmentId, workspace } = props;
  const request = props.draftRequest;
  const requestedDraft = request
    ? pickNewestConversationDraft(
        request.draft,
        fromCommand?.id === request.id ? fromCommand : null,
      )
    : null;
  const { modelSelection } = usePlanningModelSelection({
    environmentId,
    providers: props.providers,
    linkedProjects: props.linkedProjects,
    workspace,
    draft: requestedDraft,
  });
  // Leaving a draft through Cancel or Discard returns to the Thread it was started from.
  const draftReturnRef = useRef<ThreadId | null>(null);
  const draftReturnsRef = useRef(new Map<ThreadId, ThreadId | null>());
  const draftPrepared = (draft: WorkbenchConversationDraft) => {
    setFromCommand(draft);
    if (!draftReturnsRef.current.has(draft.threadId))
      draftReturnsRef.current.set(draft.threadId, draftReturnRef.current);
    showThread(draft.threadId);
    props.onDraftPrepared(draft);
  };
  const hasRequest = request != null;
  const requestedThreadId = requestedDraft?.threadId;
  // Draft URLs also restore the chat after reload or sidebar navigation.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- consumes the route's explicit draft request in the page chat preference
  useEffect(() => {
    if (hasRequest) useWorkbenchFloatingChatStore.getState().expand(requestedThreadId);
  }, [hasRequest, requestedThreadId]);
  const drafts = requestedDraft
    ? [...props.drafts.filter((draft) => draft.id !== requestedDraft.id), requestedDraft]
    : props.drafts;
  const startingDraft = getStartingDraftRequest({
    request,
    requestedDraft,
    threadsById: props.threadsById,
  });
  return {
    request,
    requestedDraft,
    modelSelection,
    drafts,
    startingDraft,
    draftPrepared,
    begin: (from: ThreadId | null) => {
      draftReturnRef.current = from;
      props.onNewDraft();
    },
    discarded: (threadId: ThreadId) => {
      selectThread(draftReturnsRef.current.get(threadId) ?? null);
      props.onDraftClosed();
    },
  };
}

const getStartingDraftRequest = ({
  request,
  requestedDraft,
  threadsById,
}: {
  readonly request: WorkbenchBoardFloatingChatProps["draftRequest"];
  readonly requestedDraft: WorkbenchConversationDraft | null;
  readonly threadsById: ThreadsById;
}) =>
  request &&
  (requestedDraft === null ||
    requestedDraft.phase === "creating" ||
    !threadsById.has(requestedDraft.threadId))
    ? request
    : null;

function BoardFloatingChat(props: WorkbenchBoardFloatingChatProps) {
  const { environmentId, workspace } = props;
  const projectId = workspace.id;
  const pageChatKey = `${environmentId}:board:${projectId}`;
  const editorRef = useRef<Pick<ReturnType<typeof useTicketDraftEditor>, "flush"> | null>(null);
  const onDraftEditor = (editor: Pick<ReturnType<typeof useTicketDraftEditor>, "flush"> | null) => {
    editorRef.current = editor;
  };
  const flushDraft = async () => (await editorRef.current?.flush())?.ok !== false;
  const pick = useWorkbenchFloatingChatStore((state) => state.pickedThreads[pageChatKey] ?? null);
  const setExplicitThreadId = (threadId: ThreadId | null) =>
    useWorkbenchFloatingChatStore
      .getState()
      .pickThread(pageChatKey, threadId === null ? null : scopeThreadRef(environmentId, threadId));
  const showThread = (threadId: ThreadId) => {
    setExplicitThreadId(threadId);
    useWorkbenchFloatingChatStore.getState().expand(threadId);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this mounted Board chat for imperative draft/Thread actions and releases its registration on unmount
  useEffect(() => {
    const { setPageChat, pickThread, expand } = useWorkbenchFloatingChatStore.getState();
    setPageChat({
      environmentId,
      kind: "board",
      projectId,
      showThread: (threadId) => {
        pickThread(pageChatKey, scopeThreadRef(environmentId, threadId));
        expand(threadId);
      },
    });
    return () => setPageChat(null);
  }, [environmentId, projectId, pageChatKey]);
  const {
    request,
    requestedDraft,
    modelSelection,
    drafts,
    startingDraft,
    draftPrepared,
    begin,
    discarded,
  } = useBoardDraftRequest({ props, showThread, selectThread: setExplicitThreadId });
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threads = getWorkbenchBoardChatThreads({
    projectId,
    tickets: props.tickets,
    assignments: props.assignments,
    drafts,
    threadsById: props.threadsById,
    archivedThreadsById: props.archivedThreadsById,
    recaps: useWorkbenchThreadRecaps(environmentId),
    referencesByTicket: props.referencesByTicket,
    localVisits,
  });
  const resolvedChat = resolveWorkbenchFloatingChat({
    ...threads,
    primaryThreadId: null,
    pick: requestedDraft
      ? {
          threadId: requestedDraft.threadId,
          settledAt: props.threadsById.get(requestedDraft.threadId)?.settledAt ?? null,
        }
      : pick,
  });
  const chat = { ...resolvedChat, selected: startingDraft ? null : resolvedChat.selected };
  useRefreshOnThreadActivity(
    chat.selected ? scopeThreadRef(environmentId, chat.selected.threadId) : null,
    props.refreshSnapshot,
  );
  const canBeginDraft = useAtomValue(
    workbenchEnvironment.beginTicketDraft.permissionAtom(environmentId),
  );
  // Drafts keep their planning conversation until Start work finishes.
  const planningDrafts = new Map(
    drafts
      .filter((draft) => draft.projectId === projectId && draft.phase !== "working")
      .map((draft) => [draft.threadId, draft]),
  );
  const openThread = (threadId: ThreadId) => {
    props.onOpenThread(threadId);
  };
  const renderDraft = ({
    draft,
    conversation,
    withCard,
  }: {
    readonly draft: WorkbenchConversationDraft;
    readonly conversation: ReactNode;
    readonly withCard: boolean;
  }) => (
    <WorkbenchDraftThread
      key={draft.id}
      context={props}
      snapshotDraft={draft}
      ticket={props.tickets.find((candidate) => candidate.id === draft.id) ?? null}
      onOpenDraft={props.onCreateManually}
      neverRan={props.threadsById.get(draft.threadId)?.latestRun == null}
      onDiscarded={() => discarded(draft.threadId)}
      onTicketCreated={(created) => props.onOpenDraft(created.id)}
      {...(withCard ? { card: props } : {})}
      onDraftEditor={onDraftEditor}
    >
      {conversation}
    </WorkbenchDraftThread>
  );
  return (
    <WorkbenchFloatingChat
      environmentId={environmentId}
      kind="board"
      label={workspace.title}
      chat={chat}
      onSelectThread={async (threadId) => {
        if (!(await flushDraft())) return;
        setExplicitThreadId(threadId);
        const draft = planningDrafts.get(threadId);
        if (draft && isUnsavedConversationDraft(draft)) props.onOpenDraft(draft.id);
        else if (request) props.onDraftClosed();
      }}
      onOpenThread={openThread}
      onNewThread={async () => {
        if (await flushDraft()) begin(chat.selected?.threadId ?? null);
      }}
      newThreadDisabled={!props.canStartDrafts || !canBeginDraft || request?.id === null}
      ticketThread={getNewTicketThread(chat.selected, planningDrafts, props)}
      draftStart={
        startingDraft ? (
          <WorkbenchBoardDraftRequest
            page={props}
            request={startingDraft}
            draft={requestedDraft}
            modelSelection={modelSelection}
            onDraft={draftPrepared}
            renderUnavailable={(draft) =>
              renderDraft({
                draft,
                conversation: (
                  <p role="status" className="p-3 text-sm text-muted-foreground">
                    Planning Thread is unavailable.
                  </p>
                ),
                withCard: false,
              })
            }
          />
        ) : undefined
      }
      planning={{
        threadIds: new Set(planningDrafts.keys()),
        render: (threadId, conversation) => {
          const draft = planningDrafts.get(threadId);
          if (!draft) return conversation;
          return renderDraft({ draft, conversation, withCard: true });
        },
      }}
    />
  );
}

function WorkbenchBoardDraftRequest({
  page,
  request,
  draft,
  modelSelection,
  onDraft,
  renderUnavailable,
}: {
  readonly page: WorkbenchBoardFloatingChatProps;
  readonly request: NonNullable<WorkbenchBoardFloatingChatProps["draftRequest"]>;
  readonly draft: WorkbenchConversationDraft | null;
  readonly modelSelection: Parameters<typeof useTicketDraftBegin>[0]["modelSelection"];
  readonly onDraft: (draft: WorkbenchConversationDraft) => void;
  readonly renderUnavailable: (draft: WorkbenchConversationDraft) => ReactNode;
}) {
  if (draft && draft.phase !== "creating") return renderUnavailable(draft);
  return (
    <WorkbenchBoardDraftStart
      key={request.id ?? "new"}
      environmentId={page.environmentId}
      workspaceId={page.workspace.id}
      request={request}
      draft={draft}
      modelSelection={modelSelection}
      enabled={page.canStartDrafts}
      onDraft={onDraft}
      refreshSnapshot={page.refreshSnapshot}
      unavailable={!page.canStartDrafts || (modelSelection === null && page.providers.length > 0)}
      onCreateManually={page.onCreateManually}
    />
  );
}

function WorkbenchBoardDraftStart({
  request,
  unavailable,
  onCreateManually,
  ...options
}: Omit<Parameters<typeof useTicketDraftBegin>[0], "requestedDraftId"> & {
  readonly request: { readonly id: WorkbenchTicketId | null };
  readonly unavailable: boolean;
  readonly onCreateManually: () => void;
}) {
  const begin = useTicketDraftBegin({
    ...options,
    requestedDraftId: request.id,
    enabled: options.enabled && (request.id === null || options.draft !== null),
  });
  return (
    <WorkbenchDraftStart
      failure={begin.state.status === "failed" ? begin.state.message : null}
      unavailable={unavailable}
      onRetry={begin.retry}
      onCreateManually={onCreateManually}
    />
  );
}

function WorkbenchDraftStart({
  failure,
  unavailable,
  onRetry,
  onCreateManually,
}: {
  readonly failure: string | null;
  readonly unavailable: boolean;
  readonly onRetry: () => void;
  readonly onCreateManually: () => void;
}) {
  return (
    <div role="group" aria-label="Ticket draft" className="space-y-3 p-4">
      <p role={failure ? "alert" : "status"} className="text-sm text-muted-foreground">
        {failure ??
          (unavailable
            ? "Ticket planning needs a supported provider. Set up Codex or Claude, or create the ticket manually."
            : "Preparing conversation…")}
      </p>
      {failure || unavailable ? (
        <div className="flex gap-2">
          {failure && !unavailable ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onCreateManually}>
            Create manually
          </Button>
        </div>
      ) : null}
    </div>
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
const useCanOperateDraft = (environmentId: EnvironmentId, archived: boolean) =>
  useAtomValue(workbenchEnvironment.promoteTicketDraft.permissionAtom(environmentId)) && !archived;

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

/** What an unsaved draft's card needs beyond the draft itself. */
type DraftCardContext = Pick<
  WorkbenchBoardFloatingChatProps,
  "referencesByTicket" | "threadsById" | "archivedThreadsById"
>;

/**
 * A draft's conversation in a floating chat. Given a card context, an unsaved draft is pinned
 * above it as an editable card; saved Tickets keep Start work in a strip below. Without a
 * conversation it is the strip alone.
 */
export function WorkbenchDraftThread({
  context,
  snapshotDraft,
  ticket,
  onOpenDraft,
  neverRan,
  onDiscarded,
  onTicketCreated,
  card,
  onDraftEditor,
  children,
}: {
  readonly context: Pick<
    WorkbenchBoardFloatingChatProps,
    "environmentId" | "workspace" | "createContext" | "refreshSnapshot"
  >;
  readonly snapshotDraft: WorkbenchConversationDraft;
  readonly ticket: WorkbenchTicket | null;
  readonly onOpenDraft: () => void;
  /** No message was ever sent, so the conversation holds nothing to lose. */
  readonly neverRan: boolean;
  readonly onDiscarded: () => void;
  readonly onTicketCreated?: (draft: WorkbenchConversationDraft) => void;
  readonly card?: DraftCardContext;
  readonly onDraftEditor?: (
    editor: Pick<ReturnType<typeof useTicketDraftEditor>, "flush"> | null,
  ) => void;
  readonly children?: ReactNode;
}) {
  const { environmentId, workspace, createContext, refreshSnapshot } = context;
  // Command replies can be newer than the snapshot; the newest revision wins.
  const [fromCommand, setFromCommand] = useState<WorkbenchConversationDraft | null>(null);
  const draft = pickNewestConversationDraft(snapshotDraft, fromCommand) ?? snapshotDraft;
  const archived = workspace.archivedAt != null || ticket?.archivedAt != null;
  const canOperate = useCanOperateDraft(environmentId, archived);
  const editor = useTicketDraftEditor({
    environmentId,
    draft,
    onDraft: setFromCommand,
    refreshSnapshot,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this mounted draft editor so Board picker actions can flush before replacing it
  useEffect(() => {
    onDraftEditor?.(editor);
    return () => onDraftEditor?.(null);
  }, [editor, onDraftEditor]);
  const createState = getTicketDraftCreateState({ ...createContext, fields: editor.fields });
  const untouched = useIsUntouchedDraft(environmentId, draft.threadId, neverRan, editor.fields);
  const transitions = useTicketDraftTransitions({
    environmentId,
    draft,
    editor,
    onDraft: setFromCommand,
    onTicketCreated: (created) => {
      setFromCommand(created);
      onTicketCreated?.(created);
    },
    onWorkStarted: () => {},
    onDiscarded,
    onClose: () => {},
    onCreateManually: onOpenDraft,
    refreshSnapshot,
  });
  const cardContext = getDraftCardContext(card, draft);
  const content = cardContext ? (
    <BoardDraftCard
      environmentId={environmentId}
      draft={draft}
      editor={editor}
      transitions={transitions}
      createState={createState}
      createContext={createContext}
      canOperate={canOperate}
      archived={archived}
      ticketExists={ticket !== null}
      untouched={untouched}
      card={cardContext}
      onDraft={setFromCommand}
    >
      {children}
    </BoardDraftCard>
  ) : (
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
  return (
    <>
      <WorkbenchDraftNavigationGuard editor={editor} />
      {content}
    </>
  );
}

/** Only unsaved drafts get the card; planning and starting drafts keep the Start work strip. */
const getDraftCardContext = (
  card: DraftCardContext | undefined,
  draft: WorkbenchConversationDraft,
) => (card && isUnsavedConversationDraft(draft) ? card : null);

/** An unsaved draft's card, with its References and who last wrote it. */
function BoardDraftCard({
  environmentId,
  archived,
  card,
  createContext,
  onDraft,
  children,
  ...props
}: Omit<
  Parameters<typeof WorkbenchDraftCard>[0],
  "updatedBy" | "briefReview" | "linkedProjects" | "references" | "referenceCount"
> & {
  readonly environmentId: EnvironmentId;
  readonly archived: boolean;
  readonly card: DraftCardContext;
  readonly createContext: WorkbenchBoardFloatingChatProps["createContext"];
  readonly onDraft: (draft: WorkbenchConversationDraft) => void;
}) {
  const { draft, editor } = props;
  const references = getTicketReferences(card.referencesByTicket, draft.id);
  const briefReview = useWorkbenchDraftBriefReview({
    environmentId,
    draft,
    revision: editor.revision,
    // The review and offsets describe the saved draft, not unsaved local edits. Read-only
    // connections still see the diff; their command permissions hide its actions.
    reviewable:
      !archived &&
      editor.editable &&
      editor.conflict === null &&
      props.transitions.action === null &&
      editor.fields.title === draft.fields.title &&
      editor.fields.markdown === draft.fields.markdown,
    onDraft,
  });
  return (
    <WorkbenchDraftCard
      {...props}
      updatedBy={workbenchProvenanceSource({
        environmentId,
        threadId: draft.updatedByThreadId,
        askForChange: draft.updatedByAskForChange,
        threadsById: card.threadsById,
        archivedThreadsById: card.archivedThreadsById,
      })}
      briefReview={briefReview}
      linkedProjects={createContext.linkedProjects}
      references={
        <WorkbenchDraftReferences
          environmentId={environmentId}
          draftId={draft.id}
          references={references}
          threadsById={card.threadsById}
          archivedThreadsById={card.archivedThreadsById}
          readOnly={!props.canOperate || props.transitions.action !== null}
          fileCwd={getReferenceFileCwd(createContext.linkedProjects, [
            ...draft.fields.repositoryProjectIds,
            draft.anchorProjectId,
          ])}
          fileThreadId={draft.threadId}
        />
      }
      referenceCount={references.length}
    >
      {children}
    </WorkbenchDraftCard>
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
