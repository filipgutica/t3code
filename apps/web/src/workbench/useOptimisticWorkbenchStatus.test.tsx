import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  WorkbenchProjectId,
  WorkbenchTicketId,
  type WorkbenchTicket,
} from "@t3tools/contracts";

import {
  useOptimisticWorkbenchStatus,
  type UseOptimisticWorkbenchStatusOptions,
} from "./useOptimisticWorkbenchStatus";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const projectId = WorkbenchProjectId.make("project-1");
const repositoryId = ProjectId.make("repository-1");
const ticketAId = WorkbenchTicketId.make("ticket-a");
const ticketBId = WorkbenchTicketId.make("ticket-b");
const initialUpdatedAt = "2026-09-11T12:00:00.000Z";

const makeTicket = (
  id: WorkbenchTicket["id"],
  status: WorkbenchTicket["status"] = "todo",
  revision = 1,
): WorkbenchTicket => ({
  id,
  projectId,
  epicId: null,
  title: id,
  kind: "story",
  markdown: "",
  primaryT3ProjectId: repositoryId,
  repositoryProjectIds: [],
  status,
  blocked: false,
  revision,
  createdAt: initialUpdatedAt,
  updatedAt: initialUpdatedAt,
});

type HookResult = ReturnType<typeof useOptimisticWorkbenchStatus>;

let result: HookResult | undefined;
let renderer: ReactTestRenderer | undefined;

function Probe(options: UseOptimisticWorkbenchStatusOptions) {
  const value = useOptimisticWorkbenchStatus(options);
  useLayoutEffect(() => {
    result = value;
  });
  return null;
}

const render = async (options: UseOptimisticWorkbenchStatusOptions) => {
  await act(() => {
    if (renderer) renderer.update(<Probe {...options} />);
    else renderer = create(<Probe {...options} />);
  });
  if (!result) throw new Error("Hook did not render");
  return result;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  result = undefined;
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

const begin = async (input: Parameters<HookResult["begin"]>[0]) => {
  let token: ReturnType<HookResult["begin"]> = false;
  await act(() => {
    token = result!.begin(input);
  });
  if (typeof token !== "symbol") throw new Error("Expected a status token");
  return token;
};

describe("useOptimisticWorkbenchStatus", () => {
  it("moves immediately, blocks only that ticket, and retains local status until its snapshot arrives", async () => {
    const tickets = [makeTicket(ticketAId), makeTicket(ticketBId)];
    await render({ environmentId: environmentA, tickets });
    const token = await begin({ ticketId: ticketAId, status: "in_progress" });
    expect(result?.tickets[0]?.status).toBe("in_progress");
    expect(result?.begin({ ticketId: ticketAId, status: "done" })).toBe(false);
    await begin({ ticketId: ticketBId, status: "done" });
    expect(result?.pendingTicketIds).toEqual(new Set([ticketAId, ticketBId]));
    await act(() => result?.succeed({ token, revision: 2 }));
    expect(result?.tickets.map((ticket) => ticket.status)).toEqual(["in_progress", "done"]);
    await render({
      environmentId: environmentA,
      tickets: [makeTicket(ticketAId, "in_progress", 2), tickets[1]!],
    });
    expect(result?.pendingTicketIds).toEqual(new Set([ticketBId]));
  });

  it("rolls back to the latest snapshot on failure", async () => {
    const ticket = makeTicket(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket] });
    const token = await begin({ ticketId: ticketAId, status: "done" });
    const latestTicket = { ...ticket, title: "Updated while saving", revision: 2 };
    await render({ environmentId: environmentA, tickets: [latestTicket] });
    expect(result?.tickets[0]?.status).toBe("done");
    await act(() => result?.fail(token));
    expect(result?.tickets).toEqual([latestTicket]);
    expect(result?.pendingTicketIds.size).toBe(0);
  });

  it("isolates environments and ignores late completions", async () => {
    const ticket = makeTicket(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket] });
    const oldToken = await begin({ ticketId: ticketAId, status: "in_progress" });
    await render({ environmentId: environmentB, tickets: [ticket] });
    expect(result?.pendingTicketIds.size).toBe(0);
    await begin({ ticketId: ticketAId, status: "done" });
    await act(() => {
      result?.succeed({ token: oldToken, revision: 2 });
      result?.fail(oldToken);
    });
    expect(result?.tickets[0]?.status).toBe("done");
    expect(result?.pendingTicketIds.has(ticketAId)).toBe(true);
  });

  it("does not resurrect an operation after an environment round trip", async () => {
    const ticket = makeTicket(ticketAId);
    const options = { environmentId: environmentA, tickets: [ticket] };
    await render(options);
    const token = await begin({ ticketId: ticketAId, status: "done" });
    await render({ ...options, environmentId: environmentB });
    await render(options);
    expect(result?.pendingTicketIds.size).toBe(0);
    expect(result?.tickets[0]?.status).toBe("todo");
    await act(() => result?.succeed({ token, revision: 2 }));
    expect(result?.pendingTicketIds.size).toBe(0);
  });

  it("clears removed tickets", async () => {
    const ticket = makeTicket(ticketAId);
    await render({ environmentId: environmentA, tickets: [ticket] });
    await begin({ ticketId: ticketAId, status: "done" });
    await render({ environmentId: environmentA, tickets: [] });
    expect(result?.pendingTicketIds.size).toBe(0);
  });
});
