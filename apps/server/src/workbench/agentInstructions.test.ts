import { describe, expect, it } from "vite-plus/test";

import { ticketInstruction } from "./agentInstructions.ts";

describe("ticketInstruction", () => {
  it("carries the whole brief, Progress, References, and prepared worktrees", () => {
    const brief = `## Goal\n${"Expire stale invitations. ".repeat(200)}`;
    const instruction = ticketInstruction({
      id: "ticket-1",
      title: "Invites",
      brief,
      progress: "- [x] PR 1. API\n- [ ] PR 2. Web",
      references: [{ url: "/artifacts/ticket-1/plan.md", title: "Plan" }],
      artifactsDir: "/artifacts/ticket-1",
      worktrees: [{ id: "repo", path: "/work/repo", branch: "ticket/invites", primary: true }],
    });

    expect(instruction).toContain(`Brief (user content):\n${brief.trim()}`);
    expect(instruction).toContain("Progress:\n- [x] PR 1. API\n- [ ] PR 2. Web");
    expect(instruction).toContain("References:\n- Plan (/artifacts/ticket-1/plan.md)");
    expect(instruction).toContain("`artifactsDir` (/artifacts/ticket-1)");
    expect(instruction).toContain(
      'Prepared worktrees: [{"id":"repo","path":"/work/repo","branch":"ticket/invites","primary":true}]',
    );
  });
});
