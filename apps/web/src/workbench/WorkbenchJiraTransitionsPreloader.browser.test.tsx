import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  WorkbenchTicketId,
  WorkbenchJiraBindingId,
  type WorkbenchJiraIssueLink,
  type WorkbenchJiraGetTicketTransitionsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, fakeTimers, render } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

const mocked = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./state", () => ({ workbenchEnvironment: { jiraGetTicketTransitions: mocked.query } }));
import { WorkbenchJiraTransitionsPreloader } from "./WorkbenchJiraTransitionsPreloader";

const environmentId = EnvironmentId.make("preloader-environment");
const timestamp = "2026-09-11T12:00:00.000Z";
const makeLink = (id: string): WorkbenchJiraIssueLink => ({
  ticketId: WorkbenchTicketId.make(id),
  bindingId: WorkbenchJiraBindingId.make("binding"),
  active: true,
  linkedAt: timestamp,
  lastSeenAt: timestamp,
  issue: {
    issueId: id,
    key: id,
    url: "https://example.com",
    summary: id,
    issueType: { id: "story", name: "Story" },
    status: { id: "todo", name: "To Do" },
    epic: null,
    flagged: false,
    rank: 0,
    remoteUpdatedAt: timestamp,
  },
});
describe("WorkbenchJiraTransitionsPreloader", () => {
  it("bounds background requests, preserves refresh timing, and shares cached rows with interactive queries", async () => {
    mocked.query.mockReset();
    using _timers = fakeTimers();
    const starts: string[] = [];
    const pending = new Map<string, (value: WorkbenchJiraGetTicketTransitionsResult) => void>();
    const atoms = new Map<
      string,
      Atom.Atom<
        import("effect/reactivity/AsyncResult").AsyncResult<WorkbenchJiraGetTicketTransitionsResult>
      >
    >();
    mocked.query.mockImplementation(({ input }: { input: { ticketId: string } }) => {
      let atom = atoms.get(input.ticketId);
      if (!atom) {
        atom = Atom.make(
          Effect.promise(
            () =>
              new Promise<WorkbenchJiraGetTicketTransitionsResult>((resolve) => {
                starts.push(input.ticketId);
                pending.set(input.ticketId, resolve);
              }),
          ),
        );
        atoms.set(input.ticketId, atom);
      }
      return atom;
    });
    const currentRegistry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => currentRegistry.dispose() };
    const links = [makeLink("ticket-1"), makeLink("ticket-2"), makeLink("ticket-3")];
    const view = (paused = false) => (
      <RegistryContext.Provider value={currentRegistry}>
        <WorkbenchJiraTransitionsPreloader
          environmentId={environmentId}
          issueLinks={links.map((link) => ({ ...link }))}
          paused={paused}
        />
      </RegistryContext.Provider>
    );
    const settle = async (id: string) => {
      const resolve = pending.get(id);
      if (!resolve) throw new Error(`No pending request for ${id}`);
      await act(async () => {
        resolve({ remoteUpdatedAt: timestamp, transitions: [] });
      });
    };
    await using screen = await render(view());
    expect(starts).toEqual(["ticket-1", "ticket-2"]);
    // An interactive request is not placed behind the background queue.
    const interactive = mocked.query({ input: { ticketId: "interactive" } });
    const stopInteractive = currentRegistry.mount(interactive);
    expect(starts).toContain("interactive");
    await settle("interactive");
    stopInteractive();
    await settle("ticket-1");
    expect(starts).toContain("ticket-3");
    await settle("ticket-2");
    await settle("ticket-3");
    const loaded = atoms.get("ticket-1");
    if (!loaded) throw new Error("Missing cached query");
    const stopMenu = currentRegistry.mount(loaded);
    expect(currentRegistry.get(loaded)._tag).toBe("Success");
    expect(starts.filter((id) => id === "ticket-1")).toHaveLength(1);
    stopMenu();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await screen.rerender(view());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(starts.filter((id) => id === "ticket-1")).toHaveLength(2);
    expect(starts.filter((id) => id === "ticket-2")).toHaveLength(2);
    expect(starts.filter((id) => id === "ticket-3")).toHaveLength(1);
    await screen.rerender(view(true));
    await settle("ticket-1");
    await settle("ticket-2");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(starts.filter((id) => id === "ticket-3")).toHaveLength(1);
  });
});
