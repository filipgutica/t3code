import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../test/render";

import {
  HostThreadRouteContent,
  filterVisibleThreads,
  useVisibleThreads,
} from "./hostIntegrations";

const one = EnvironmentId.make("one");
const two = EnvironmentId.make("two");
const threadId = ThreadId.make("same-id");
const threads = [
  { environmentId: one, id: threadId },
  { environmentId: two, id: threadId },
];

it("keeps native records and ordering unchanged without a provider", async () => {
  const observe = vi.fn();
  function NativeList() {
    const visible = useVisibleThreads(threads);
    observe(visible);
    return (
      <>
        {visible.map((thread) => (
          <button key={thread.environmentId}>{thread.environmentId}</button>
        ))}
      </>
    );
  }
  await using screen = await render(<NativeList />, { router: false });
  expect(observe).toHaveBeenLastCalledWith(threads);
  expect(observe.mock.calls[0]?.[0]).toBe(threads);
  expect(
    [...screen.container.querySelectorAll("button")].map((button) => button.textContent),
  ).toEqual(["one", "two"]);
  expect(filterVisibleThreads(threads, null)).toBe(threads);
});

it("keeps a native conversation mounted when its route reference changes", async () => {
  const send = vi.fn();
  function NativeConversation() {
    const [prompt, setPrompt] = useState("");
    return (
      <>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <button onClick={() => send(prompt)}>Send</button>
      </>
    );
  }
  const view = (environmentId: EnvironmentId) => (
    <HostThreadRouteContent threadRef={{ environmentId, threadId }}>
      <NativeConversation />
    </HostThreadRouteContent>
  );
  await using screen = await render(view(one), { router: false });
  await screen.getByRole("textbox").fill("Native prompt");
  await screen.rerender(view(two));
  await screen.getByRole("button", { name: "Send" }).click();
  expect(send).toHaveBeenCalledWith("Native prompt");
});
