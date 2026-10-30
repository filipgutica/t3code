import { describe, expect, it } from "@effect/vitest";

import {
  getDraftBriefPreview,
  getDraftProgressPreview,
  getInitialDraftCardMode,
} from "./workbenchDraftCard.logic";

describe("getInitialDraftCardMode", () => {
  it("starts compact in the default chat of a 900px window and collapsed in a 720px one", () => {
    expect(getInitialDraftCardMode(540)).toBe("compact");
    expect(getInitialDraftCardMode(504)).toBe("collapsed");
  });
});

describe("getDraftBriefPreview", () => {
  it("previews list items without headings, keeping which are checkboxes", () => {
    const brief = [
      "## Goal",
      "- New users can run a first check.",
      "",
      "## Work",
      "- [ ] Install section",
      "  - [x] Profile setup",
      "1. Errors",
    ].join("\n");
    expect(getDraftBriefPreview(brief, 2)).toEqual({
      lines: [
        { line: 1, text: "New users can run a first check.", checkbox: false },
        { line: 4, text: "Install section", checkbox: true },
      ],
      remaining: 2,
    });
  });

  it("previews plain lines when the brief has no list", () => {
    expect(getDraftBriefPreview("# Title\nFirst line\nSecond line", 1)).toEqual({
      lines: [{ line: 1, text: "First line", checkbox: false }],
      remaining: 1,
    });
  });
});

describe("getDraftProgressPreview", () => {
  it("keeps the goal and counts all Progress items while previewing only the first two", () => {
    const brief =
      "# Ticket\n\n## Goal\nMake the first check reliable.\n\n## Acceptance\n- [ ] Old brief checklist";
    const progress =
      "- [x] PR 1. Install\n- [ ] PR 2. First check\n- [X] PR 3. Errors\n- [ ] PR 4. Proxy";
    expect(getDraftProgressPreview({ markdown: brief, progress, limit: 2 })).toEqual({
      goal: "Make the first check reliable.",
      done: 2,
      total: 4,
      remaining: 2,
    });
  });

  it("uses a goal bullet without exposing brief checkboxes as Progress", () => {
    expect(
      getDraftProgressPreview({
        markdown: "## Goal\n- First passing check\n- [ ] A criterion",
        progress: "* [ ] PR 1",
        limit: 2,
      }),
    ).toEqual({
      goal: "First passing check",
      done: 0,
      total: 1,
      remaining: 0,
    });
  });

  it("keeps the existing brief preview when Progress has no checklist", () => {
    expect(
      getDraftProgressPreview({ markdown: "A goal\n- [ ] A criterion", progress: "", limit: 2 }),
    ).toBeNull();
    expect(
      getDraftProgressPreview({ markdown: "A goal", progress: "Planning is underway", limit: 2 }),
    ).toBeNull();
    expect(
      getDraftProgressPreview({
        markdown: "## Work\n- [ ] A criterion",
        progress: "- [x] PR 1",
        limit: 2,
      })?.goal,
    ).toBe("");
  });
});
