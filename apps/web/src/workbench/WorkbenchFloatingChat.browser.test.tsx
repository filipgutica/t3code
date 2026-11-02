import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId, WorkbenchTicketId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../test/render";
import { ComposerHandleContext } from "../composerHandleContext";
import { useRightPanelStore } from "../rightPanelStore";
import { WorkbenchFloatingChat } from "./WorkbenchFloatingChat";
import { WorkbenchPageRow } from "./WorkbenchPagePanel";
import {
  resolveWorkbenchFloatingChat,
  type WorkbenchFloatingChatThread,
} from "./workbenchFloatingChat.logic";
import { resolveWorkbenchThreadExecutionStatusPresentation } from "./WorkbenchThreadExecutionStatus.logic";
import type { WorkbenchThreadExecutionStatus } from "./workbenchThreadStatus.logic";
import { useWorkbenchFloatingChatStore } from "./workbenchFloatingChatState";

const { openPullRequest, panelClick, chatMount, pageComposer } = vi.hoisted(() => ({
  openPullRequest: vi.fn(),
  panelClick: vi.fn(),
  chatMount: vi.fn(),
  // The page's shared composer handle, which the command palette focuses when it closes.
  pageComposer: { current: null },
}));
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

// The real ChatView needs a connected environment. Like ChatView, the stand-in focuses the
// composer per focus request, opens PR links through the native handler, renders an open panel
// into the page's panel host, and names the composer handle context it would register in.
vi.mock("../components/ChatView", async () => {
  const { useEffect, useRef } = await import("react");
  const { createPortal } = await import("react-dom");
  const { useOpenChangeRequestLink } = await import("../lib/openPullRequestLink");
  const { useComposerHandleContext } = await import("../composerHandleContext");
  const { selectThreadRightPanelState, useRightPanelStore } = await import("../rightPanelStore");
  return {
    default: function ChatViewStub(props: {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      workbenchEmbed?: { composerFocusRequest: number | null; panelHost?: HTMLElement | null };
    }) {
      const ref = useRef<HTMLTextAreaElement>(null);
      const composerHandle = useComposerHandleContext();
      const request = props.workbenchEmbed?.composerFocusRequest ?? null;
      const threadRef = scopeThreadRef(props.environmentId, props.threadId);
      const openChangeRequest = useOpenChangeRequestLink(threadRef);
      const panelOpen = useRightPanelStore(
        (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).isOpen,
      );
      const panelHost = props.workbenchEmbed?.panelHost ?? null;
      useEffect(() => {
        if (request !== null) ref.current?.focus();
      }, [request]);
      useEffect(() => chatMount(props.threadId), [props.threadId]);
      return (
        <>
          {panelOpen && panelHost
            ? createPortal(
                <button type="button" onClick={panelClick}>
                  Panel for {props.threadId}
                </button>,
                panelHost,
              )
            : null}
          <textarea
            ref={ref}
            aria-label={`Composer for ${props.threadId}`}
            data-composer-handle={composerHandle === pageComposer ? "page" : "own"}
          />
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
    shownThread: null,
    pickedThreads: {},
    boardHandoff: null,
  });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  openPullRequest.mockReset();
  panelClick.mockReset();
  chatMount.mockReset();
};

const thread = (
  id: string,
  kind: WorkbenchThreadExecutionStatus["kind"] | null = null,
  recap: string | null = null,
): WorkbenchFloatingChatThread => ({
  threadId: ThreadId.make(id),
  title: `Thread ${id}`,
  unread: false,
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
  settledAt: null,
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
        pick:
          explicitThreadId === null
            ? null
            : {
                threadId: explicitThreadId,
                settledAt:
                  (props.settled ?? []).find((thread) => thread.threadId === explicitThreadId)
                    ?.settledAt ?? null,
              },
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

it("opens on the first other Thread waiting on the user, above the working ones", async () => {
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
  const working = screen.getByRole("menuitem", { name: "Working, 1 Thread" });
  await expect.element(working).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(working);
  await expect.element(screen.getByText("Added the board chat picker.")).toBeVisible();
});

it("opens a collapsed section to focus its waiting Thread from the pill", async () => {
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
  const attention = screen.getByRole("menuitem", { name: "Unread, 1 Thread" });
  await userEvent.click(attention);
  await expect.element(attention).toHaveAttribute("aria-expanded", "false");
  await userEvent.keyboard("{Escape}");

  const pill = screen.getByRole("button", { name: "1 other Thread needs you" });
  await expect.element(pill).toHaveTextContent("1 needs you");
  await userEvent.click(pill);

  await expect.element(screen.getByRole("menuitemradio", { name: /Thread c/ })).toHaveFocus();
});

it("scrolls to the showing Thread whenever the menu opens, even after its section was collapsed", async () => {
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
  const showing = screen.getByRole("menuitemradio", { name: "PAY-19 Thread t19" });

  await userEvent.click(menu);
  await expect.element(showing).toBeInViewport();

  await userEvent.click(screen.getByRole("menuitem", { name: "Idle, 20 Threads" }));
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

  const showing = screen.getByRole("menuitemradio", { name: "PAY-1 Thread t4" });
  await expect.element(showing).toHaveFocus();
  await expect.element(showing).toBeInViewport();
});

it("collapses a section in search results, and forgets it with the search", async () => {
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
  const group = screen.getByRole("menuitem", { name: "Idle, 8 Threads" });
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

it("collapses on a page click, but not for clicks in the chat or its menus", async () => {
  setup();
  await using screen = await render(
    <div data-workbench-page-column="">
      <button type="button">Page action</button>
      <Harness threads={[thread("a"), thread("b")]} />
    </div>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
  await userEvent.click(screen.getByRole("button", { name: "Ticket Threads: Thread a" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Thread b/ }));
  await expect.element(screen.getByLabelText("Composer for b")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Page action" }));
  const expand = screen.getByRole("button", { name: "Expand ticket chat" });
  await expect.element(expand).toBeVisible();
  await expect.element(screen.getByLabelText("Composer for b")).not.toBeInTheDocument();
  // Collapsing on a page click leaves focus where the user clicked.
  await expect.element(screen.getByRole("button", { name: "Page action" })).toHaveFocus();

  // A collapsed chat stays collapsed; only its minimize control hides it.
  await userEvent.click(screen.getByRole("button", { name: "Page action" }));
  await expect.element(expand).toBeVisible();

  await userEvent.click(expand);
  await expect.element(screen.getByLabelText("Composer for b")).toBeInTheDocument();
});

it("keeps the page's composer handle for native chats", async () => {
  setup();
  await using screen = await render(
    <ComposerHandleContext value={pageComposer}>
      <Harness threads={[thread("a")]} />
    </ComposerHandleContext>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await expect
    .element(screen.getByLabelText("Composer for a"))
    .toHaveAttribute("data-composer-handle", "own");
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

/** A sized page row, with the chat inside a positioned page column as on the Ticket page. */
function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ display: "flex", height: 600 }}>
      <WorkbenchPageRow>
        <div style={{ position: "relative", flex: 1 }}>{children}</div>
      </WorkbenchPageRow>
    </div>
  );
}

it("opens a file from the embed in the page's panel and keeps it through collapse and minimize", async () => {
  setup();
  await page.viewport(1280, 800);
  const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("a"));
  const onOpenThread = vi.fn();
  await using screen = await render(
    <Page>
      <Harness threads={[thread("a")]} onOpenThread={onOpenThread} />
    </Page>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await act(() => useRightPanelStore.getState().openFile(threadRef, "src/index.ts"));

  const panel = screen.getByRole("button", { name: "Panel for a" });
  await expect.element(panel).toBeVisible();
  expect(panel.element().closest("[data-workbench-panel-host]")).not.toBeNull();
  expect(onOpenThread).not.toHaveBeenCalled();
  await expect.element(screen.getByRole("button", { name: "Thread details" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Collapse ticket chat" }));
  await expect.element(panel).toBeVisible();
  await expect.element(screen.getByLabelText("Composer for a")).not.toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Thread details" }))
    .not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Minimize ticket chat" }));
  await expect.element(panel).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Show PAY-1 chat" })).toBeVisible();
});

it("floats the chat over a maximized panel without covering the panel's controls", async () => {
  setup();
  await page.viewport(1280, 800);
  const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("a"));
  await using screen = await render(
    <Page>
      <p>Ticket brief</p>
      <Harness threads={[thread("a")]} />
    </Page>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));
  await act(() => {
    useRightPanelStore.getState().openFile(threadRef, "src/index.ts");
    useRightPanelStore.getState().setMaximized(threadRef, true);
  });

  await expect.element(screen.getByText("Ticket brief")).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Panel for a" }));
  expect(panelClick).toHaveBeenCalledOnce();

  await userEvent.click(screen.getByRole("button", { name: "Collapse ticket chat" }));
  await expect.element(screen.getByRole("button", { name: "Expand ticket chat" })).toBeVisible();
});

it("minimizes the chat while a narrow window shows the panel as a sheet, and the chat closes it", async () => {
  setup();
  await page.viewport(900, 800);
  const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("a"));
  await using screen = await render(
    <Page>
      <Harness threads={[thread("a")]} />
    </Page>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await act(() => useRightPanelStore.getState().openFile(threadRef, "src/index.ts"));
  await expect.element(screen.getByRole("button", { name: "Show PAY-1 chat" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Panel for a" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Show PAY-1 chat" }));
  await expect.element(screen.getByLabelText("Composer for a")).toBeVisible();
  expect(useRightPanelStore.getState().byThreadKey).toMatchObject({
    [scopedThreadKey(threadRef)]: { isOpen: false },
  });
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

/** A Board chat expanded on Thread t, as the user leaves the Board. */
const renderBoardShowing = async (threads: ReadonlyArray<WorkbenchFloatingChatThread>) => {
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(
    await render(
      <div data-workbench-page-column="">
        <Harness key="board" kind="board" threads={threads} />
      </div>,
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand board chat" }));
  await userEvent.click(screen.getByRole("button", { name: /^Board Threads: / }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Thread t/ }));
  await expect.element(screen.getByLabelText("Composer for t")).toBeInTheDocument();
  const environment = stack.move();
  return Object.assign(screen, { [Symbol.asyncDispose]: () => environment.disposeAsync() });
};

const ticketChat = (threads: ReadonlyArray<WorkbenchFloatingChatThread>) => (
  <div data-workbench-page-column="">
    <Harness key="ticket" threads={threads} primaryThreadId={ThreadId.make("p")} />
  </div>
);

it("keeps the Board's Thread and mode when its Ticket opens", async () => {
  setup();
  await using screen = await renderBoardShowing([thread("a"), thread("t")]);
  chatMount.mockReset();

  await screen.rerender(ticketChat([thread("p"), thread("t")]));

  await expect.element(screen.getByLabelText("Composer for t")).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Collapse ticket chat" })).toBeVisible();
  expect(chatMount).not.toHaveBeenCalledWith(ThreadId.make("p"));
});

it("collapses, without showing it, when the opened Ticket lacks the Board's Thread", async () => {
  setup();
  await using screen = await renderBoardShowing([thread("a"), thread("t")]);
  chatMount.mockReset();

  await screen.rerender(ticketChat([thread("p")]));

  await expect.element(screen.getByRole("button", { name: "Message Thread p…" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Expand ticket chat" })).toBeVisible();
  // The Ticket's own Thread never mounted expanded, so it is not marked read.
  expect(chatMount).not.toHaveBeenCalled();
});

it("keeps a minimized chat minimized and on the Board's Thread when its Ticket opens", async () => {
  setup();
  await using screen = await renderBoardShowing([thread("a"), thread("t")]);
  await userEvent.click(screen.getByRole("button", { name: "Minimize board chat" }));

  await screen.rerender(ticketChat([thread("p"), thread("t")]));

  await userEvent.click(screen.getByRole("button", { name: "Show PAY-1 chat" }));
  await expect.element(screen.getByLabelText("Composer for t")).toBeInTheDocument();
});

it("lets an explicit request to show a Thread outrank the Board's handoff", async () => {
  setup();
  await using screen = await renderBoardShowing([thread("a"), thread("t")]);
  // Leaving the Board for a full-page draft, whose new Ticket asks to show its Thread.
  await screen.rerender(<div />);
  await act(() => useWorkbenchFloatingChatStore.getState().expand(ThreadId.make("p")));

  await screen.rerender(ticketChat([thread("p")]));

  await expect.element(screen.getByLabelText("Composer for p")).toBeInTheDocument();
});

it("leaves the chat expanded for a page control that opens a Ticket", async () => {
  setup();
  await using screen = await render(
    <div data-workbench-page-column="">
      <button type="button" data-workbench-opens-ticket="">
        Open PAY-2
      </button>
      <Harness threads={[thread("a")]} />
    </div>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand ticket chat" }));

  await userEvent.click(screen.getByRole("button", { name: "Open PAY-2" }));

  await expect.element(screen.getByLabelText("Composer for a")).toBeInTheDocument();
});
