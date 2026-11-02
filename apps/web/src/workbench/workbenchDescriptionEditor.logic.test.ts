import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vite-plus/test";

import {
  descriptionEditorExtensions,
  parseDescription,
  serializeDescription,
} from "./workbenchDescriptionEditor.logic";

const schema = getSchema(descriptionEditorExtensions);

/** Saves `source` after `edit` changes the editor document it loads as. */
function save(source: string, edit?: (content: JSONContent[]) => JSONContent[], jira = false) {
  const parsed = parseDescription(source, jira);
  const content = edit ? edit(structuredClone(parsed.doc.content ?? [])) : parsed.doc.content;
  return serializeDescription(ProseMirrorNode.fromJSON(schema, { type: "doc", content }), parsed);
}

const doc = (json: JSONContent) => ProseMirrorNode.fromJSON(schema, json);

const blockTypes = (source: string, jira = false) =>
  parseDescription(source, jira).doc.content?.map((block) => block.type);

const chip = (href: string, title: string | null = null): JSONContent => ({
  type: "referenceChip",
  attrs: { href, title },
});

const link = (href: string, title: string | null = null) => ({
  type: "link",
  attrs: { href, title },
});

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("description editor Markdown", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "  \n\n"],
    ["GFM table", "| a | b |\n|:--|--:|\n| 1 | 2 |\n"],
    ["task list", "- [x] Done\n- [ ] Next\n  - [ ] Nested\n"],
    [
      "Jira wiki markup",
      'h2. Observed\n\n# Sends {{POST /v4}}.\n# See [request|https://example.com].\n\n||a||b||\n|1|2|\n\n{code:json}\n{ "a": 1 }\n{code}\n\n*bold* and _em_\n',
    ],
    ["mixed bullet markers", "* one\n* two\n\n+ three\n\n- four"],
    ["setext heading", "Title\n=====\n\nBody"],
    ["HTML block", "<details>\n<summary>More</summary>\n\nHidden\n</details>\n"],
    ["reference link", 'See [the plan][plan].\n\n[plan]: /tmp/plan.md "Plan"\n'],
    ["CRLF", "# Goal\r\n\r\n- a\r\n- b\r\n"],
    ["no trailing newline", "Line one\nline two"],
    ["leading blank lines", "\n\n\nStart here\n"],
    ["extra spacing", "One\n\n\n\nTwo\n\n> Quote\n>\n> more\n\n```ts\nconst a = 1;\n```\n\n***\n"],
    ["escapes and emphasis styles", "a\\_b, __strong__, _em_, 1) first\n2) second\n"],
    ["bare URLs and links", "Docs at https://example.com and [plan](/tmp/plan.md).\n"],
  ])("saves an unchanged %s byte for byte", (_name, source) => {
    expect(save(source)).toBe(source);
    expect(save(source, undefined, true)).toBe(source);
  });

  it("keeps a table and Jira markup as Markdown source", () => {
    expect(blockTypes("Intro\n\n| a |\n|---|\n| 1 |\n")).toEqual(["paragraph", "markdownSource"]);
    expect(blockTypes("h2. Observed\n\n- item\n", true)).toEqual(["markdownSource", "bulletList"]);
    expect(blockTypes("h2. Observed\n", false)).toEqual(["paragraph"]);
  });

  it("re-serializes only the block you edit", () => {
    const source = "Intro\n\n\n| a |\n|---|\n| 1 |\n\n* keep\n* this\n";
    expect(save(source, ([, table, list]) => [paragraph("New intro"), table!, list!])).toBe(
      "New intro\n\n| a |\n|---|\n| 1 |\n\n* keep\n* this\n",
    );
  });

  it("writes new blocks as Markdown", () => {
    const added: JSONContent = {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        {
          type: "text",
          text: "the plan",
          marks: [{ type: "link", attrs: { href: "/tmp/plan.md" } }],
        },
        { type: "text", text: ", " },
        {
          type: "text",
          text: "https://example.com",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
        { type: "text", text: " and " },
        { type: "text", text: "1 * 2", marks: [{ type: "bold" }] },
      ],
    };
    expect(save("# Goal\n", (content) => [...content, added])).toBe(
      "# Goal\n\nSee [the plan](/tmp/plan.md), https://example.com and **1 \\* 2**\n",
    );
  });

  it.each([
    [
      "bold",
      {
        type: "text",
        text: "https://example.com/a",
        marks: [{ type: "bold" }, link("https://example.com/a")],
      },
    ],
    [
      "titled",
      {
        type: "text",
        text: "https://example.com/a",
        marks: [link("https://example.com/a", "Spec")],
      },
    ],
    ["chip ending in a period", chip("https://example.com/a.")],
    ["file chip with spaces", chip("/Users/me/My Plan.md")],
    ["titled chip", chip("https://example.com/a", "the spec")],
  ])("keeps a %s when its paragraph changes", (_name, inline) => {
    const edited = { type: "paragraph", content: [{ type: "text", text: "See " }, inline] };
    const reloaded = parseDescription(
      save("Old\n", () => [edited]),
      false,
    ).doc;
    expect(doc(reloaded).eq(doc({ type: "doc", content: [edited] }))).toBe(true);
  });

  it("shows Reference links as chips and keeps other links as link text", () => {
    const [paragraph] = parseDescription(
      "See [plan](/Users/me/plan.md), https://example.com and [mail](mailto:a@example.com).",
      false,
    ).doc.content!;
    expect(paragraph!.content!.filter((node) => node.type === "referenceChip")).toEqual([
      chip("/Users/me/plan.md", "plan"),
      chip("https://example.com"),
    ]);
    expect(paragraph!.content!.at(-2)!.marks).toEqual([link("mailto:a@example.com")]);
  });

  it("writes a new untitled file chip as a link named by the file", () => {
    expect(
      save("# Goal\n", (content) => [
        ...content,
        { type: "paragraph", content: [chip("/Users/me/plan.md")] },
      ]),
    ).toBe("# Goal\n\n[plan.md](/Users/me/plan.md)\n");
  });

  it("writes an edited task list with its checkboxes", () => {
    expect(
      save("- [ ] Ship\n", ([list]) => {
        list!.content![0]!.attrs = { checked: true };
        return [list!];
      }),
    ).toBe("- [x] Ship\n");
  });

  it("writes an edited Markdown source block as typed", () => {
    expect(
      save("| a |\n|---|\n", () => [
        { type: "markdownSource", content: [{ type: "text", text: "| a |\n|---|\n| *1* |" }] },
      ]),
    ).toBe("| a |\n|---|\n| *1* |\n");
  });

  it("drops empty paragraphs and saves a cleared description as empty", () => {
    expect(save("Text\n", () => [{ type: "paragraph" }])).toBe("");
    expect(save("A\n\nB\n", ([a, b]) => [a!, { type: "paragraph" }, b!])).toBe("A\n\nB\n");
  });
});
