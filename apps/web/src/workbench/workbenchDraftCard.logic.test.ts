import { describe, expect, it } from "@effect/vitest";

import { getDraftBriefPreview, getInitialDraftCardMode } from "./workbenchDraftCard.logic";

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
