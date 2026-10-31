import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { useRightPanelStore } from "../rightPanelStore";
import { WorkbenchFloatingChat } from "./WorkbenchFloatingChat";
import {
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";

const { openPullRequest } = vi.hoisted(() => ({ openPullRequest: vi.fn() }));
vi.mock("./WorkbenchPullRequestPreview", () => ({
  useOpenWorkbenchPullRequest: () => openPullRequest,
}));
vi.mock("@t3tools/client-runtime/change-request-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/change-request-links")>()),
  resolveChangeRequestLinkTarget: () => ({
    project: { id: ProjectId.make("repo"), environmentId: EnvironmentId.make("environment") },
    repository: "acme/app",
    number: 42,
  }),
}));

// The real ChatView needs a connected environment. The stand-in honors the embedding inputs
// the panel controls, as ChatView does: each new focus request focuses the composer, and a
// pull request link in the timeline opens through the native link handler.
vi.mock("../components/ChatView", async () => {
  const { useEffect, useRef } = await import("react");
  const { useOpenChangeRequestLink } = await import("../lib/openPullRequestLink");
  return {
    default: function ChatViewStub(props: {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      workbenchEmbed?: { composerFocusRequest: number | null };
    }) {
      const ref = useRef<HTMLTextAreaElement>(null);
      const request = props.workbenchEmbed?.composerFocusRequest ?? null;
      const openChangeRequest = useOpenChangeRequestLink(
        scopeThreadRef(props.environmentId, props.threadId),
      );
      useEffect(() => {
        if (request !== null) ref.current?.focus();
      }, [request]);
      return (
        <>
          <textarea ref={ref} aria-label={`Composer for ${props.threadId}`} />
          <a
            href="https://github.com/acme/app/pull/42"
            onClick={(event) => openChangeRequest(event, "https://github.com/acme/app/pull/42")}
          >
            acme/app #42
          </a>
        </>
      );
    },
  };
});
const setup = () => {
  useWorkbenchFloatingChatStore.setState({
    mode: "collapsed",
    restoreMode: "collapsed",
    focusRequest: { id: 0, threadId: null },
    pageChat: null,
  });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  openPullRequest.mockReset();
};

const thread = (
  id: string,
  kind: WorkbenchThreadExecutionStatus["kind"] | null = null,
  recap: string | null = null,
): WorkbenchFloatingChatThread => ({
  threadId: ThreadId.make(id),
  title: `Thread ${id}`,
  status:
    kind === null
      ? null
      : {
          kind,
          presentation: resolveWorkbenchThreadExecutionStatusPresentation({ kind }),
          startedAt: null,
        },
  ticket: null,
  recap,
});

function Harness(props: {
  readonly threads: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly settled?: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly archived?: ReadonlyArray<WorkbenchFloatingChatThread>;
  readonly primaryThreadId?: ThreadId;
  readonly onNewThread?: () => void;
  readonly onOpenThread?: (threadId: ThreadId) => void;
  readonly kind?: "ticket" | "board";
}) {
  const [explicitThreadId, setExplicitThreadId] = useState<ThreadId | null>(null);
  return (
    <WorkbenchFloatingChat
      environmentId={EnvironmentId.make("environment")}
      kind={props.kind ?? "ticket"}
      label="PAY-1"
      chat={resolveWorkbenchFloatingChat({
        active: props.threads,
        archived: props.archived ?? [],
        settled: props.settled ?? [],
        primaryThreadId: props.primaryThreadId ?? null,
        explicitThreadId,
      })}
      onSelectThread={setExplicitThreadId}
      onOpenThread={props.onOpenThread ?? (() => {})}
      onNewThread={props.onNewThread ?? (() => {})}
      newThreadDisabled={false}
    />
  );
}

it("mounts the chat only when expanded and focuses the composer for an explicit expand", async () => {
  setup();
  await using screen = await render(<Harness threads={[thread("a"), thread("b")]} />);

  await expect
    .element(screen.getByRole("button", { name: "Ticket Threads: Thread a" }))
    .toBeInTheDocument();
  await expect.element(screen.getByLabelText("Composer for a")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Message Thread a…" }));

  await expect.element(screen.getByLabelText("Composer for a")).toHaveFocus();
});

it("switches Threads from the picker without moving focus into the composer", async () => {
  setup();
  await using screen = await render(<Harness threads={[thread("a"), thread("b")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
  await expect.element(screen.getByLabelText("Composer for a")).toHaveFocus();

  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads: Thread a" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Thread b/ }));

  await expect
    .element(screen.getByRole("button", { name: "Ticket Threads: Thread b" }))
    .toBeInTheDocument();
  await expect.element(screen.getByLabelText("Composer for b")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Composer for b")).not.toHaveFocus();

  // Returning to the Thread that was expanded does not replay the earlier focus request.
  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads: Thread b" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Thread a/ }));
  await expect.element(screen.getByLabelText("Composer for a")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Composer for a")).not.toHaveFocus();
});

it("shows each Thread's recap and opens on the first other Thread waiting on the user", async () => {
  setup();
  await using screen = await render(
    <Harness
      threads={[
        thread("a", "approval"),
        thread("b", "working", "Added the board chat picker."),
        thread("c", "input"),
        thread("d", "failed"),
      ]}
    />,
  );
  // The showing Thread waits too, but the pill counts only the others.
  const pill = screen.getByRole("button", { name: "2 other Threads need you" });
  await expect.element(pill).toBeVisible();
  await expect.element(pill).toHaveTextContent("2 need you");

  await userEvent.click(pill);

  await expect.element(screen.getByRole("menuitemradio", { name: /Thread c/ })).toHaveFocus();
  await expect.element(screen.getByText("Added the board chat picker.")).toBeVisible();
});

it("opens a collapsed group to focus its waiting Thread from the pill", async () => {
  setup();
  const ticket = (id: string, key: string) => ({
    id: WorkbenchTicketId.make(id),
    key,
    title: `Ticket ${key}`,
    kind: "story" as const,
  });
  const onTicket = (base: WorkbenchFloatingChatThread, key: string) => ({
    ...base,
    ticket: ticket(key.toLowerCase(), key),
  });
  await using screen = await render(
    <Harness
      kind="board"
      threads={[
        onTicket(thread("a"), "PAY-1"),
        onTicket(thread("c", "input"), "PAY-2"),
        onTicket(thread("e"), "PAY-2"),
      ]}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /^Board Threads/ }));
  const group = screen.getByRole("menuitem", { name: "PAY-2 Ticket PAY-2 2 Threads" });
  await userEvent.click(group);
  await expect.element(group).toHaveAttribute("aria-expanded", "false");
  await userEvent.keyboard("{Escape}");

  const pill = screen.getByRole("button", { name: "1 other Thread needs you" });
  await expect.element(pill).toHaveTextContent("1 needs you");
  await userEvent.click(pill);

  await expect.element(screen.getByRole("menuitemradio", { name: /Thread c/ })).toHaveFocus();
});

it("scrolls to the showing Thread whenever the menu opens, even after its group was collapsed", async () => {
  setup();
  const threads = Array.from({ length: 20 }, (_, index) => ({
    ...thread(`t${index}`),
    ticket: {
      id: WorkbenchTicketId.make(`ticket-${index}`),
      key: `PAY-${index}`,
      title: `Ticket ${index}`,
      kind: "story" as const,
    },
  }));
  await using screen = await render(
    <Harness kind="board" threads={threads} primaryThreadId={ThreadId.make("t19")} />,
  );
  const menu = screen.getByRole("button", { name: /^Board Threads/ });
  const showing = screen.getByRole("menuitemradio", { name: "Thread t19" });

  await userEvent.click(menu);
  await expect.element(showing).toBeInViewport();

  await userEvent.click(screen.getByRole("menuitem", { name: "PAY-19 Ticket 19 1 Thread" }));
  await expect.element(showing).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(menu);
  await expect.element(showing).toBeInViewport();
});

it("moves keyboard focus to the showing Thread it scrolls to", async () => {
  setup();
  const ticket = {
    id: WorkbenchTicketId.make("pay-1"),
    key: "PAY-1",
    title: "Refunds",
    kind: "story" as const,
  };
  const threads = [
    ...["d1", "d2", "d3"].map((id) => thread(id, null, `Recap ${id}`)),
    ...["t1", "t2", "t3", "t4"].map((id) => ({ ...thread(id, null, `Recap ${id}`), ticket })),
  ];
  await using screen = await render(
    <Harness kind="board" threads={threads} primaryThreadId={ThreadId.make("t4")} />,
  );
  const menu = screen.getByRole("button", { name: /^Board Threads/ });
  menu.element().focus();

  await userEvent.keyboard("{Enter}");

  const showing = screen.getByRole("menuitemradio", { name: "Thread t4" });
  await expect.element(showing).toHaveFocus();
  await expect.element(showing).toBeInViewport();
});

it("collapses a group in search results, and forgets it with the search", async () => {
  setup();
  const ticket = {
    id: WorkbenchTicketId.make("pay-2"),
    key: "PAY-2",
    title: "Payouts",
    kind: "story" as const,
  };
  const threads = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
    ...thread(id),
    ticket: id === "a" ? { ...ticket, id: WorkbenchTicketId.make("pay-1"), key: "PAY-1" } : ticket,
  }));
  await using screen = await render(<Harness kind="board" threads={threads} />);
  await userEvent.click(screen.getByRole("button", { name: /^Board Threads/ }));
  await userEvent.type(screen.getByRole("textbox", { name: "Search Threads" }), "Thread");
  const group = screen.getByRole("menuitem", { name: "PAY-2 Payouts 7 Threads" });
  await expect.element(group).toHaveAttribute("aria-expanded", "true");

  await userEvent.click(group);

  await expect.element(group).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByRole("menuitemradio", { name: /Thread h/ }))
    .not.toBeInTheDocument();
  await userEvent.type(screen.getByRole("textbox", { name: "Search Threads" }), " ");
  await expect.element(group).toHaveAttribute("aria-expanded", "true");
});

it("filters a long Thread list by title or recap", async () => {
  setup();
  const threads = ["a", "b", "c", "d", "e", "f", "g"].map((id) => thread(id));
  await using screen = await render(
    <Harness threads={[...threads, thread("h", null, "Wired the rate-limit headers.")]} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads: Thread a" }));

  await userEvent.type(screen.getByRole("textbox", { name: "Search Threads" }), "rate-limit");

  await expect.element(screen.getByRole("menuitemradio", { name: /Thread h/ })).toBeVisible();
  await expect
    .element(screen.getByRole("menuitemradio", { name: /Thread a/ }))
    .not.toBeInTheDocument();
});

it("restores an expanded panel from the launcher without moving focus into the composer", async () => {
  setup();
  await using screen = await render(<Harness threads={[thread("a")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Minimize ticket chat" }));

  await userEvent.click(screen.getByRole("button", { name: "Show PAY-1 chat" }));

  await expect.element(screen.getByLabelText("Composer for a")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Collapse ticket chat" })).toHaveFocus();
});

it("returns focus to the control that brings the panel back", async () => {
  setup();
  await using screen = await render(<Harness threads={[thread("a")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await userEvent.click(screen.getByRole("button", { name: "Collapse ticket chat" }));
  await expect.element(screen.getByRole("button", { name: "Expand ticket chat" })).toHaveFocus();
  await expect.element(screen.getByLabelText("Composer for a")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Minimize ticket chat" }));
  const launcher = screen.getByRole("button", { name: "Show PAY-1 chat" });
  await expect.element(launcher).toHaveFocus();

  await userEvent.click(launcher);
  await expect.element(screen.getByRole("button", { name: "Expand ticket chat" })).toHaveFocus();
});

it("offers Start Thread when the ticket has no Threads, without a Thread picker", async () => {
  setup();
  await using screen = await render(<Harness threads={[]} />);

  await expect
    .element(screen.getByText("No Threads on PAY-1 yet.", { exact: false }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Start Thread" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Ticket Threads" }))
    .not.toBeInTheDocument();
});

it("opens a settled Thread when the ticket has no active Threads", async () => {
  setup();
  await using screen = await render(<Harness threads={[]} settled={[thread("s")]} />);
  await expect
    .element(screen.getByText("No active Threads on PAY-1.", { exact: false }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Settled/ }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Thread s" }));

  const trigger = screen.getByRole("button", { name: "Ticket Threads: Thread s" });
  await expect.element(trigger).toBeInTheDocument();

  // Settled reopens expanded with the showing Thread highlighted.
  await userEvent.click(trigger);
  await expect
    .element(screen.getByRole("menuitemradio", { name: "Thread s" }))
    .toHaveAttribute("aria-checked", "true");
});

it("restores an archived Thread when the ticket has no active Threads", async () => {
  setup();
  const onOpenThread = vi.fn();
  await using screen = await render(
    <Harness threads={[]} archived={[thread("x")]} onOpenThread={onOpenThread} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /Archived/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Restore and open Thread x" }));

  expect(onOpenThread).toHaveBeenCalledExactlyOnceWith(ThreadId.make("x"));
});

it("does not replay a focus request when the primary Thread changes and changes back", async () => {
  setup();
  const threads = [thread("a"), thread("b")];
  await using screen = await render(
    <Harness threads={threads} primaryThreadId={ThreadId.make("a")} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
  await expect.element(screen.getByLabelText("Composer for a")).toHaveFocus();

  await screen.rerender(<Harness threads={threads} primaryThreadId={ThreadId.make("b")} />);
  await expect.element(screen.getByLabelText("Composer for b")).not.toHaveFocus();
  await screen.rerender(<Harness threads={threads} primaryThreadId={ThreadId.make("a")} />);

  await expect.element(screen.getByLabelText("Composer for a")).toBeInTheDocument();
  await expect.element(screen.getByLabelText("Composer for a")).not.toHaveFocus();
});

it("focuses the expanded composer again for a new request, such as the palette action", async () => {
  setup();
  await using screen = await render(<Harness threads={[thread("a")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads: Thread a" }));
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByLabelText("Composer for a")).not.toHaveFocus();

  await act(() => useWorkbenchFloatingChatStore.getState().expand());

  await expect.element(screen.getByLabelText("Composer for a")).toHaveFocus();
});

it("opens the full Thread when the user opens a right-panel surface from the embed", async () => {
  setup();
  const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("a"));
  // The full Thread left a file open earlier; mounting the embed is not a new request.
  useRightPanelStore.getState().open(threadRef, "diff");
  useRightPanelStore.getState().openFile(threadRef, "src/earlier.ts");
  const onOpenThread = vi.fn();
  await using screen = await render(
    <Harness threads={[thread("a")]} onOpenThread={onOpenThread} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await act(() => useRightPanelStore.getState().reconcileFileSurfaces(threadRef, false));
  expect(onOpenThread).not.toHaveBeenCalled();

  await act(() => useRightPanelStore.getState().openFile(threadRef, "src/index.ts"));

  expect(onOpenThread).toHaveBeenCalledExactlyOnceWith(ThreadId.make("a"));
});

it("opens a pull request link from the embed in the page's preview, not the full Thread", async () => {
  setup();
  const onOpenThread = vi.fn();
  await using screen = await render(
    <Harness threads={[thread("a")]} onOpenThread={onOpenThread} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await userEvent.click(screen.getByRole("link", { name: "acme/app #42" }));

  expect(openPullRequest).toHaveBeenCalledExactlyOnceWith({
    environmentId: EnvironmentId.make("environment"),
    reference: { projectId: ProjectId.make("repo"), repository: "acme/app", number: 42 },
  });
  expect(onOpenThread).not.toHaveBeenCalled();
});

it("focuses a requested Thread's composer once it appears, such as a Thread just created", async () => {
  setup();
  await using screen = await render(
    <Harness threads={[thread("a")]} primaryThreadId={ThreadId.make("a")} />,
  );

  await act(() => useWorkbenchFloatingChatStore.getState().expand(ThreadId.make("b")));
  await expect.element(screen.getByLabelText("Composer for a")).not.toHaveFocus();

  await screen.rerender(
    <Harness threads={[thread("a"), thread("b")]} primaryThreadId={ThreadId.make("b")} />,
  );

  await expect.element(screen.getByLabelText("Composer for b")).toHaveFocus();
});

it("starts a new Thread from the Thread menu", async () => {
  setup();
  const onNewThread = vi.fn();
  await using screen = await render(<Harness threads={[thread("a")]} onNewThread={onNewThread} />);

  await userEvent.click(screen.getByRole("button", { name: /^Ticket Threads/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "New Thread" }));

  expect(onNewThread).toHaveBeenCalledOnce();
});

it("resizes from the top-left corner and keeps the size for the next ticket", async () => {
  setup();
  localStorage.removeItem("t3code:workbench-floating-chat-size");
  // The panel sizes itself within the ticket it floats over.
  const ticket = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) => (
    <div style={{ position: "relative", width: 1200, height: 900 }}>
      <Harness threads={threads} />
    </div>
  );
  const pointer = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }),
    );
  let resized = { width: 0, height: 0 };
  {
    await using screen = await render(ticket([thread("a")]));
    await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
    const panel = screen.getByRole("region", { name: "PAY-1 chat" }).element() as HTMLElement;
    const before = panel.getBoundingClientRect();
    const corner = panel.querySelector('[data-resize-edge="top-left"]');
    if (!corner) throw new Error("The expanded chat has no corner handle.");

    pointer(corner, "pointerdown", 500, 500);
    pointer(corner, "pointermove", 440, 260);
    pointer(corner, "pointerup", 440, 260);

    resized = { width: before.width + 60, height: before.height + 240 };
    await expect.element(panel).toHaveStyle({ width: `${resized.width}px` });
    await expect.element(panel).toHaveStyle({ height: `${resized.height}px` });
  }
  await using screen = await render(ticket([thread("b")]));
  await expect
    .element(screen.getByRole("region", { name: "PAY-1 chat" }))
    .toHaveStyle({ width: `${resized.width}px`, height: `${resized.height}px` });
});
