import { describe, expect, it } from "vite-plus/test";

import { remoteTicketInstruction, ticketInstruction } from "./agentInstructions.ts";

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
      worktrees: [{ id: "repo", path: "/work/repo", branch: "ticket/invites" }],
    });

    expect(instruction).toContain(`Brief (user content):\n${brief.trim()}`);
    expect(instruction).toContain("Progress:\n- [x] PR 1. API\n- [ ] PR 2. Web");
    expect(instruction).toContain("References:\n- Plan (/artifacts/ticket-1/plan.md)");
    expect(instruction).toContain("`artifactsDir` (/artifacts/ticket-1)");
    expect(instruction).toContain(
      'Prepared worktrees: [{"id":"repo","path":"/work/repo","branch":"ticket/invites"}]',
    );
  });
});

describe("remoteTicketInstruction", () => {
  it("gives a Thread on another machine the Ticket without tools or this machine's paths", () => {
    const instruction = remoteTicketInstruction({
      id: "ticket-1",
      title: "Invites",
      brief: "## Goal\nExpire stale invitations.",
      progress: "- [ ] PR 1. API",
      references: [
        { url: "/artifacts/ticket-1/plan.md", title: "Plan" },
        { url: "https://github.com/acme/app/issues/7", title: "Issue" },
      ],
    });

    expect(instruction).toContain("Brief (user content):\n## Goal\nExpire stale invitations.");
    expect(instruction).toContain("Progress:\n- [ ] PR 1. API");
    expect(instruction).toContain("- Issue (https://github.com/acme/app/issues/7)");
    expect(instruction).toContain("1 file Reference is on the Workbench machine");
    expect(instruction).toContain("no Workbench tools");
    expect(instruction).not.toMatch(/workbench_|link_pull_request|artifactsDir|later turns/);
    expect(instruction).not.toContain("/artifacts/ticket-1");
  });
});
