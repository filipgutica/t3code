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

type WorkbenchFloatingChatPanel = "collapsed" | "expanded";
export type WorkbenchFloatingChatMode = WorkbenchFloatingChatPanel | "launcher";

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
  /** The panel the launcher restores. */
  readonly restoreMode: WorkbenchFloatingChatPanel;
  readonly focusRequest: WorkbenchFloatingChatFocusRequest;
  /** The page chat on screen, which shows a new Thread instead of navigating to it. */
  readonly pageChat: WorkbenchPageChat | null;
  /** The Thread the page chat shows, whose right panel the page hosts. */
  readonly shownThread: ScopedThreadRef | null;
  /** The Thread the user picked in each page chat, so returning to the page shows it again. */
  readonly pickedThreads: Readonly<Record<string, WorkbenchFloatingChatPick | null>>;
  readonly setPageChat: (pageChat: WorkbenchPageChat | null) => void;
  readonly setShownThread: (shownThread: ScopedThreadRef | null) => void;
  readonly pickThread: (pageChatKey: string, thread: ScopedThreadRef | null) => void;
  readonly expand: (threadId?: ThreadId) => void;
  readonly collapse: () => void;
  readonly minimize: () => void;
  readonly restore: () => void;
}>((set) => ({
  mode: "collapsed",
  restoreMode: "collapsed",
  focusRequest: { id: 0, threadId: null },
  pageChat: null,
  shownThread: null,
  pickedThreads: {},
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
  expand: (threadId) =>
    set((state) => ({
      mode: "expanded",
      restoreMode: "expanded",
      focusRequest: { id: state.focusRequest.id + 1, threadId: threadId ?? null },
    })),
  collapse: () => set({ mode: "collapsed", restoreMode: "collapsed" }),
  minimize: () => set({ mode: "launcher" }),
  restore: () => set((state) => ({ mode: state.restoreMode })),
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
