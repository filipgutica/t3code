import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
// A standard client session, so environment-owned file links can open.
vi.mock(import("../../state/session"), async (original) => {
  const { AuthStandardClientScopes } = await import("@t3tools/contracts");
  const granted = new Set<string>(AuthStandardClientScopes);
  const hasScope = (environmentId: unknown, scope: string) =>
    environmentId !== null && granted.has(scope);
  return {
    ...(await original()),
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
  };
});
vi.mock(import("../../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
// A rendered diagram is an SVG; real Mermaid layout is not what these tests exercise.
vi.mock(import("../../components/chat/MermaidDiagram"), async (original) => ({
  ...(await original()),
  MermaidDiagram: () => <svg aria-label="Diagram" />,
}));

import ChatMarkdown, { ChatMarkdownCodeBlockRendererContext } from "../../components/ChatMarkdown";

it("renders opted-in assistant blocks while preserving surrounding text and ordinary code", async () => {
  const text =
    "Before.\n\n```proposal\nstructured payload\n```\n\nAfter.\n\n```text\nordinary code\n```";
  const message = (messageId?: string, isStreaming = false) => (
    <ChatMarkdownCodeBlockRendererContext
      value={(block) =>
        block.messageId === "assistant" && block.language === "proposal" ? (
          <section aria-label="Proposal">
            {block.isStreaming || !block.isComplete ? "Preparing proposal" : block.code}
          </section>
        ) : undefined
      }
    >
      <ChatMarkdown
        cwd="/tmp/project"
        text={text}
        messageId={messageId}
        isStreaming={isStreaming}
      />
    </ChatMarkdownCodeBlockRendererContext>
  );
  await using screen = await render(message("assistant", true));
  const { container, rerender } = screen;
  expect(container.querySelector("section")?.textContent).toBe("Preparing proposal");
  await rerender(message("assistant"));
  expect(container.querySelector("section")?.textContent).toBe("structured payload\n");
  expect([...container.querySelectorAll("p")].map((node) => node.textContent)).toEqual([
    "Before.",
    "After.",
  ]);
  expect(container.querySelectorAll("pre")).toHaveLength(1);
  await rerender(message());
  expect(container.querySelectorAll("section")).toHaveLength(0);
  expect(container.querySelectorAll("pre")).toHaveLength(2);
});
