import { page } from "vite-plus/test/browser";
import { act, render as renderBrowser } from "../../test/render";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchSnapshot,
} from "@t3tools/contracts";
import { use, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ChatMarkdownCodeBlock } from "../components/ChatMarkdown";
import type { Project } from "../types";
import type { WorkbenchSuggestionMessage } from "./workbenchTicketDraft.logic";

const state = vi.hoisted(() => ({
  messages: [] as WorkbenchSuggestionMessage[],
  snapshot: null as WorkbenchSnapshot | null,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ availableEditors: [], revealInFileManagerLabel: "Show in file manager" }),
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/session")>();
  return {
    ...actual,
    useEnvironmentScope: () => false,
    readEnvironmentScope: () => false,
    usePreparedConnection: () => ({ _tag: "Loading" }),
  };
});
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectOnChangeRequestHost: () => undefined,
  parseChangeRequestUrl: () => null,
  resolvePullRequestPreviewTarget: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => null,
  useServerConfigs: () => new Map(),
  useThreadProjection: () => ({ projection: { messages: state.messages } }),
  useProjects: () => projects,
}));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: state.snapshot }) }));
vi.mock("./state", () => ({ workbenchEnvironment: { snapshot: vi.fn() } }));

import ChatMarkdown, { ChatMarkdownCodeBlockRendererContext } from "../components/ChatMarkdown";
import {
  WorkbenchTicketProposalHistory,
  WorkbenchTicketProposalRenderer,
} from "./WorkbenchTicketProposal";

const environmentId = EnvironmentId.make("environment");
const repo = ProjectId.make("repository");
const projects: Project[] = [
  {
    id: repo,
    environmentId,
    title: "Beacon CLI",
    workspaceRoot: "/tmp/beacon-cli",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  },
];
const payload = {
  title: "Add retry",
  markdown: "## Goal\nRetry failed requests.\n\n- Preserve existing behavior.",
  repositoryProjectIds: [repo],
  primaryT3ProjectId: repo,
};
const code = JSON.stringify(payload);
const text = `\`\`\`workbench-ticket-draft\n${code}\n\`\`\``;
const block: ChatMarkdownCodeBlock = {
  messageId: "assistant",
  language: "workbench-ticket-draft",
  code,
  sourceOffset: 0,
  isStreaming: false,
  isComplete: true,
};
const defaultBlocks = [block];

function NativeBlock({ block }: { readonly block: ChatMarkdownCodeBlock }) {
  const render = use(ChatMarkdownCodeBlockRendererContext);
  return render?.(block) ?? <pre>{block.code}</pre>;
}

function Harness({
  blocks = defaultBlocks,
  ticketCreated = false,
  canApply = true,
}: {
  readonly blocks?: ReadonlyArray<ChatMarkdownCodeBlock>;
  readonly ticketCreated?: boolean;
  readonly canApply?: boolean;
}) {
  const [fields, setFields] = useState({
    title: "My draft",
    markdown: "My original description",
    repositoryProjectIds: [repo],
    primaryT3ProjectId: repo,
  });
  return (
    <WorkbenchTicketProposalRenderer
      environmentId={environmentId}
      threadId={ThreadId.make("thread")}
      linkedProjects={projects}
      fields={fields}
      ticketCreated={ticketCreated}
      canApply={canApply}
      onApply={(suggestion) =>
        setFields({ ...suggestion, repositoryProjectIds: [...suggestion.repositoryProjectIds] })
      }
    >
      {blocks.map((item) => (
        <NativeBlock key={`${item.messageId}:${item.sourceOffset}:${item.language}`} block={item} />
      ))}
      <output aria-label="Draft title">{fields.title}</output>
    </WorkbenchTicketProposalRenderer>
  );
}

async function setup() {
  state.messages = [{ id: "assistant", role: "assistant", text, streaming: false }];
  state.snapshot = null;
  const screen = await renderBrowser(null);
  const container = screen.container;
  return {
    screen,
    container,
    button: (label: string) =>
      [...container.querySelectorAll("button")].find((item) => item.textContent === label),
    render: (props: Parameters<typeof Harness>[0] = {}) => screen.rerender(<Harness {...props} />),
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

describe("inline ticket proposal", () => {
  it.each(["```", "````", "~~~"])(
    "applies the proposal rendered by native Markdown with a %s fence",
    async (fence) => {
      await using context = await setup();
      const withCode = { ...payload, markdown: "## Work\n```ts\nconst retry = true;\n```" };
      const message = `Intro\n\n${fence}workbench-ticket-draft\n${JSON.stringify(withCode)}\n${fence}`;
      state.messages = [{ id: "assistant", role: "assistant", text: message, streaming: false }];
      const apply = vi.fn();
      await act(async () =>
        context.screen.rerender(
          <WorkbenchTicketProposalRenderer
            environmentId={environmentId}
            threadId={ThreadId.make("thread")}
            linkedProjects={projects}
            fields={{ title: "", markdown: "", repositoryProjectIds: [], primaryT3ProjectId: null }}
            ticketCreated={false}
            canApply
            onApply={apply}
          >
            <ChatMarkdown cwd="/tmp/beacon-cli" messageId="assistant" text={message} />
          </WorkbenchTicketProposalRenderer>,
        ),
      );
      expect(context.container.textContent).not.toContain('"repositoryProjectIds"');
      expect(context.container.querySelector("h2")?.textContent).toBe("Work");
      expect(context.button("Apply to draft")?.disabled).toBe(false);
      await page.elementLocator(context.button("Apply to draft")!).click();
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ title: withCode.title, markdown: withCode.markdown }),
      );
    },
  );

  it("shows a readable proposal and updates the draft only when Apply is chosen", async () => {
    await using context = await setup();
    await context.render();
    const description = context.container.querySelector("details")!;
    expect(description.open).toBe(false);
    await page.elementLocator(description.querySelector("summary")!).click();
    expect(description.open).toBe(true);
    expect(context.container.querySelector("pre")).toBeNull();
    expect(context.container.querySelector("h2")?.textContent).toBe("Goal");
    expect(context.container.textContent).toContain("Beacon CLI");
    expect(context.container.querySelector("output")?.textContent).toBe("My draft");
    await page.elementLocator(context.button("Apply to draft")!).click();
    expect(context.container.querySelector("output")?.textContent).toBe("Add retry");
    expect(context.button("Apply to draft")).toBeUndefined();
    expect(context.container.textContent).toContain("Applied to draft");
    expect(description.open).toBe(true);
  });

  it("dismisses a proposal without changing the draft or removing conversation history", async () => {
    await using context = await setup();
    await context.render();
    await page.elementLocator(context.button("Dismiss")!).click();
    expect(context.container.querySelector("output")?.textContent).toBe("My draft");
    expect(context.container.textContent).toContain("Dismissed");
    expect(context.container.textContent).toContain("Retry failed requests.");
  });

  it("never offers Apply for streaming, incomplete, or invalid proposals", async () => {
    await using context = await setup();
    for (const item of [
      { ...block, isStreaming: true },
      { ...block, isComplete: false },
      { ...block, code: "{ bad json" },
      { ...block, code: JSON.stringify({ ...payload, repositoryProjectIds: ["unknown"] }) },
    ]) {
      await context.render({ blocks: [item] });
      expect(context.button("Apply to draft")).toBeUndefined();
      expect(context.container.querySelector("pre")).toBeNull();
      expect(context.container.querySelector("output")?.textContent).toBe("My draft");
    }
  });

  it("only lets the last proposal in the newest completed assistant message be applied", async () => {
    await using context = await setup();
    const nextCode = JSON.stringify({ ...payload, title: "New proposal" });
    const nextText = `\`\`\`workbench-ticket-draft\n${nextCode}\n\`\`\``;
    state.messages = [
      { id: "assistant", role: "assistant", text: `${text}\n${nextText}`, streaming: false },
    ];
    await context.render({
      blocks: [block, { ...block, code: nextCode, sourceOffset: text.length + 1 }],
    });
    expect(
      [...context.container.querySelectorAll("button")].filter(
        (item) => item.textContent === "Apply to draft",
      ),
    ).toHaveLength(1);
    await page.elementLocator(context.button("Apply to draft")!).click();
    expect(context.container.querySelector("output")?.textContent).toBe("New proposal");
  });

  it("disables changes without permission and retains the card after ticket creation", async () => {
    await using context = await setup();
    await context.render({ canApply: false });
    expect(context.button("Apply to draft")?.disabled).toBe(true);
    await act(async () => context.button("Apply to draft")!.click());
    expect(context.container.querySelector("output")?.textContent).toBe("My draft");
    await context.render({ ticketCreated: true });
    expect(context.button("Apply to draft")).toBeUndefined();
    expect(context.container.textContent).toContain("Ticket already created");
    expect(context.container.textContent).toContain("Retry failed requests.");
  });

  it("keeps ordinary code and user-quoted proposals in the native renderer", async () => {
    await using context = await setup();
    await context.render({
      blocks: [
        { ...block, language: "json" },
        { ...block, messageId: undefined },
      ],
    });
    expect(context.container.querySelectorAll("pre")).toHaveLength(2);
    expect(context.button("Apply to draft")).toBeUndefined();
  });

  it("keeps saved proposals readable in their owning environment without remounting the native conversation", async () => {
    await using context = await setup();
    const workspaceId = WorkbenchProjectId.make("workspace");
    const ticketId = WorkbenchTicketId.make("ticket");
    const timestamp = projects[0]!.createdAt;
    const threadRef = { environmentId, threadId: ThreadId.make("thread") };
    const history = (ref = threadRef) => (
      <WorkbenchTicketProposalHistory threadRef={ref}>
        <NativeBlock block={block} />
        <input aria-label="Native composer" defaultValue="Unsent message" />
      </WorkbenchTicketProposalHistory>
    );
    await act(async () => context.screen.rerender(history()));
    const composer = context.container.querySelector("input");
    expect(context.container.querySelector("pre")).not.toBeNull();
    state.snapshot = {
      projects: [
        {
          id: workspaceId,
          title: "Workbench",
          linkedProjectIds: [repo],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      tickets: [
        {
          ...payload,
          id: ticketId,
          projectId: workspaceId,
          primaryT3ProjectId: repo,
          epicId: null,
          kind: "story",
          status: "in_progress",
          blocked: false,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      assignments: [
        {
          id: WorkbenchAssignmentId.make("assignment"),
          ticketId,
          threadId: threadRef.threadId,
          supersededAt: null,
          createdAt: timestamp,
        },
      ],
      epics: [],
      reservedThreadIds: [],
      ticketWorkspaces: [],
    };
    await act(async () => context.screen.rerender(history()));
    expect(context.container.querySelector("input")).toBe(composer);
    expect(context.container.querySelector("pre")).toBeNull();
    expect(context.container.textContent).toContain("Ticket already created");
    expect(context.button("Apply to draft")).toBeUndefined();
    // The same repository and thread IDs in a different environment cannot supply this card's scope.
    await act(async () =>
      context.screen.rerender(
        history({ ...threadRef, environmentId: EnvironmentId.make("other-environment") }),
      ),
    );
    expect(context.container.querySelector("pre")).not.toBeNull();
    expect(context.container.querySelector("input")).toBe(composer);
  });
});
