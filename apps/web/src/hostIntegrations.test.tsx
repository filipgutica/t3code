import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

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
let renderer: ReactTestRenderer | undefined;

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

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
  await act(() => {
    renderer = create(<NativeList />);
  });
  expect(observe).toHaveBeenLastCalledWith(threads);
  expect(observe.mock.calls[0]?.[0]).toBe(threads);
  expect(renderer!.root.findAllByType("button").map((button) => button.children)).toEqual([
    ["one"],
    ["two"],
  ]);
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
  await act(() => {
    renderer = create(view(one));
  });
  await act(() =>
    renderer!.root.findByType("input").props.onChange({ target: { value: "Native prompt" } }),
  );
  await act(() => renderer!.update(view(two)));
  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(send).toHaveBeenCalledWith("Native prompt");
});
