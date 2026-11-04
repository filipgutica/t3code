import { describe, expect, it } from "vite-plus/test";

import {
  coverMarkdownBlocks,
  describeMarkdownReview,
  diffMarkdownBlocks,
  diffWords,
  markdownBlocks,
} from "./markdownReview";

const brief = [
  "## Goal",
  "",
  "Help a new team finish setup.",
  "",
  "- Save progress",
  "- Show the next step",
].join("\n");

describe("markdownBlocks", () => {
  it("keeps each top-level block's exact source range", () => {
    const blocks = markdownBlocks(brief);
    expect(blocks.map((block) => [block.kind, block.source])).toEqual([
      ["heading", "## Goal"],
      ["paragraph", "Help a new team finish setup."],
      ["list", "- Save progress\n- Show the next step"],
    ]);
    for (const block of blocks) expect(brief.slice(block.start, block.end)).toBe(block.source);
  });
});

describe("diffWords", () => {
  it.each([
    {
      name: "a sentence edit inside the text",
      base: "an invitation but still have no clear indication of what is ready",
      current: "an invitation but can't tell what is ready",
      segments: [
        { kind: "same", text: "an invitation but " },
        { kind: "del", text: "still have no clear indication of" },
        { kind: "ins", text: "can't tell" },
        { kind: "same", text: " what is ready" },
      ],
    },
    {
      name: "a leading word replaced",
      base: "Create the welcome checklist",
      current: "Build the welcome checklist",
      segments: [
        { kind: "del", text: "Create" },
        { kind: "ins", text: "Build" },
        { kind: "same", text: " the welcome checklist" },
      ],
    },
  ])("reads $name as removed words followed by added words", ({ base, current, segments }) => {
    expect(diffWords(base, current)).toEqual(segments);
  });
});

describe("diffMarkdownBlocks", () => {
  it("has no changes for the same text", () => {
    const review = diffMarkdownBlocks(brief, brief);
    expect(review.entries).toMatchObject([{ kind: "unchanged", source: brief }]);
    expect(review.changedBlocks).toBe(0);
  });

  it("pairs an edited block with a word diff and keeps the unchanged runs as source", () => {
    const current = brief.replace("finish setup", "finish setup quickly");
    const review = diffMarkdownBlocks(brief, current);
    expect(review.entries).toMatchObject([
      { kind: "unchanged", source: "## Goal" },
      {
        kind: "changed",
        blockKind: "paragraph",
        words: [
          { kind: "same", text: "Help a new team finish " },
          { kind: "del", text: "setup." },
          { kind: "ins", text: "setup quickly." },
        ],
      },
      { kind: "unchanged", source: "- Save progress\n- Show the next step" },
    ]);
    expect(describeMarkdownReview({ titleChanged: false, review })).toEqual({
      heading: "Unreviewed change",
      detail: "1 paragraph",
    });
  });

  it("shows added and removed blocks whole", () => {
    const added = diffMarkdownBlocks(brief, `${brief}\n\nA new closing note.`);
    expect(added.entries.at(-1)).toMatchObject({
      kind: "added",
      block: { kind: "paragraph", source: "A new closing note." },
    });
    const removed = diffMarkdownBlocks(brief, brief.replace("## Goal\n\n", ""));
    expect(removed.entries[0]).toMatchObject({
      kind: "removed",
      block: { kind: "heading", source: "## Goal" },
    });
    expect(
      describeMarkdownReview({ titleChanged: true, review: diffMarkdownBlocks(brief, "Other.") }),
    ).toEqual({ heading: "Unreviewed changes", detail: "title and 3 blocks" });
  });

  it("shows a block pair too large for a word diff as a removal and an addition", () => {
    const paragraph = (prefix: string) =>
      Array.from({ length: 150 }, (_, index) => `${prefix}${index}`).join(" ");
    const review = diffMarkdownBlocks(
      `## Goal\n\n${paragraph("a")}`,
      `## Goal\n\n${paragraph("b")}`,
    );
    expect(review.entries.map((entry) => entry.kind)).toEqual(["unchanged", "removed", "added"]);
    expect(review.changedBlocks).toBe(1);
  });
});

describe("coverMarkdownBlocks", () => {
  it("covers the whole blocks a selection touches", () => {
    const [, paragraph, list] = markdownBlocks(brief);
    expect(coverMarkdownBlocks(brief, [list!, paragraph!])).toEqual({
      start: paragraph!.start,
      end: list!.end,
      blockSource: "Help a new team finish setup.\n\n- Save progress\n- Show the next step",
    });
    expect(coverMarkdownBlocks(brief, [])).toBeNull();
  });
});
