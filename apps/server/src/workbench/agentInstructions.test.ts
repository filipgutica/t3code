import { describe, expect, it } from "vite-plus/test";

import { workstreamInstruction } from "./agentInstructions.ts";

describe("workstreamInstruction", () => {
  it("carries only the brief's opening and points to the read tool for the rest", () => {
    const brief = `## Goal\n${"Expire stale invitations. ".repeat(200)}`;
    const instruction = workstreamInstruction({ id: "ticket-1", title: "Invites", brief });

    expect(instruction).toContain("## Goal\nExpire stale invitations.");
    expect(instruction).toContain("… (read the full brief with workbench_workstream_read)");
    expect(instruction.length).toBeLessThan(1_200);
  });
});
