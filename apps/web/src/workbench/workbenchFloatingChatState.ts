import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { create } from "zustand";

import { readThreadShell } from "../state/entities";
import type { WorkbenchFloatingChatPick } from "./workbenchFloatingChat.logic";

export type WorkbenchFloatingChatMode = "collapsed" | "expanded";

/** An explicit request to expand and focus a composer: `threadId`'s, or the selected Thread's. */
export interface WorkbenchFloatingChatFocusRequest {
  readonly id: number;
  readonly threadId: ThreadId | null;
}

type WorkbenchPageChat = {
  readonly environmentId: EnvironmentId;
  readonly showThread: (threadId: ThreadId) => void;
} & (
  | { readonly kind: "ticket"; readonly ticketId: WorkbenchTicketId }
  | { readonly kind: "board"; readonly projectId: WorkbenchProjectId }
);

// A client-session preference shared by page chats, like the board view state.
export const useWorkbenchFloatingChatStore = create<{
  readonly mode: WorkbenchFloatingChatMode;
  readonly focusRequest: WorkbenchFloatingChatFocusRequest;
  /** The page chat on screen, which shows a new Thread instead of navigating to it. */
  readonly pageChat: WorkbenchPageChat | null;
  /** The Thread the page chat shows, whose right panel the page hosts. */
  readonly shownThread: ScopedThreadRef | null;
  /** The Thread the user picked in each page chat, so returning to the page shows it again. */
  readonly pickedThreads: Readonly<Record<string, WorkbenchFloatingChatPick | null>>;
  /**
   * The Thread the Board chat showed when it unmounted, for the next Ticket chat to keep. It
   * outlives the Board chat, whose unmount clears `shownThread` and `pageChat` first.
   */
  readonly boardHandoff: { readonly thread: ScopedThreadRef | null } | null;
  readonly setBoardHandoff: (
    boardHandoff: { readonly thread: ScopedThreadRef | null } | null,
  ) => void;
  readonly setPageChat: (pageChat: WorkbenchPageChat | null) => void;
  readonly setShownThread: (shownThread: ScopedThreadRef | null) => void;
  readonly pickThread: (pageChatKey: string, thread: ScopedThreadRef | null) => void;
  readonly expand: (threadId?: ThreadId) => void;
  readonly collapse: () => void;
}>((set) => ({
  mode: "collapsed",
  focusRequest: { id: 0, threadId: null },
  pageChat: null,
  shownThread: null,
  pickedThreads: {},
  boardHandoff: null,
  setBoardHandoff: (boardHandoff) => set({ boardHandoff }),
  setPageChat: (pageChat) => set({ pageChat }),
  setShownThread: (shownThread) => set({ shownThread }),
  pickThread: (pageChatKey, thread) => {
    const shell = thread === null ? null : readThreadShell(thread);
    const pick =
      thread === null
        ? null
        : {
            threadId: thread.threadId,
            settledAt: shell?.settledOverride === "settled" ? (shell.settledAt ?? null) : null,
          };
    set((state) => ({ pickedThreads: { ...state.pickedThreads, [pageChatKey]: pick } }));
  },
  // An explicit request to show a Thread outranks the Board's handoff.
  expand: (threadId) =>
    set((state) => ({
      mode: "expanded",
      boardHandoff: null,
      focusRequest: { id: state.focusRequest.id + 1, threadId: threadId ?? null },
    })),
  collapse: () => set({ mode: "collapsed" }),
}));

/** Resolves the mounted page after creation, since the user may have changed pages or hosts. */
export const showWorkbenchPageChatThread = ({
  environmentId,
  ticketId,
  projectId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly projectId: WorkbenchProjectId;
  readonly threadId: ThreadId;
}) => {
  const { pageChat } = useWorkbenchFloatingChatStore.getState();
  if (
    pageChat?.environmentId !== environmentId ||
    (pageChat.kind === "ticket" ? pageChat.ticketId !== ticketId : pageChat.projectId !== projectId)
  )
    return false;
  pageChat.showThread(threadId);
  return true;
};

/** Thread links show the Thread in a mounted Ticket chat; elsewhere they open its page. */
export const useWorkbenchThreadOpenLabel = () =>
  useWorkbenchFloatingChatStore((state) =>
    state.pageChat?.kind === "ticket" ? "Show in chat" : "Open Thread",
  );
