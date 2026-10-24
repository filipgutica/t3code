import type { ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { create } from "zustand";

type WorkbenchFloatingChatPanel = "collapsed" | "expanded";
export type WorkbenchFloatingChatMode = WorkbenchFloatingChatPanel | "launcher";

/** An explicit request to expand and focus a composer: `threadId`'s, or the selected Thread's. */
export interface WorkbenchFloatingChatFocusRequest {
  readonly id: number;
  readonly threadId: ThreadId | null;
}

interface WorkbenchTicketChat {
  readonly ticketId: WorkbenchTicketId;
  readonly showThread: (threadId: ThreadId) => void;
}

// A client-session preference shared by every ticket, like the board view state.
export const useWorkbenchFloatingChatStore = create<{
  readonly mode: WorkbenchFloatingChatMode;
  /** The panel the launcher restores. */
  readonly restoreMode: WorkbenchFloatingChatPanel;
  readonly focusRequest: WorkbenchFloatingChatFocusRequest;
  /** A floating chat with a Thread is on screen, so entry points elsewhere can show it. */
  readonly available: boolean;
  /** The ticket chat on screen, which shows a new Thread instead of navigating to it. */
  readonly ticketChat: WorkbenchTicketChat | null;
  readonly setAvailable: (available: boolean) => void;
  readonly setTicketChat: (ticketChat: WorkbenchTicketChat | null) => void;
  readonly expand: (threadId?: ThreadId) => void;
  readonly collapse: () => void;
  readonly minimize: () => void;
  readonly restore: () => void;
}>((set) => ({
  mode: "collapsed",
  restoreMode: "collapsed",
  focusRequest: { id: 0, threadId: null },
  available: false,
  ticketChat: null,
  setAvailable: (available) => set({ available }),
  setTicketChat: (ticketChat) => set({ ticketChat }),
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

/** Shows a ticket's Thread in its floating chat. False when that chat is not on screen. */
export const showWorkbenchTicketChatThread = (ticketId: WorkbenchTicketId, threadId: ThreadId) => {
  const { ticketChat } = useWorkbenchFloatingChatStore.getState();
  if (ticketChat?.ticketId !== ticketId) return false;
  ticketChat.showThread(threadId);
  return true;
};
