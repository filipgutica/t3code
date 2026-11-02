import { Node, type JSONContent } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Node as ProseMirrorNode, type Mark } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import { workbenchDescriptionMarkdown } from "./workbenchDescription.logic";

/** Markdown the editor can't show as rich text without losing it, kept as editable source. */
const MarkdownSource = Node.create({
  name: "markdownSource",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  parseHTML: () => [{ tag: "pre[data-markdown-source]", preserveWhitespace: "full" }],
  renderHTML: () => ["pre", { "data-markdown-source": "" }, 0],
});

export const descriptionEditorExtensions = [
  StarterKit.configure({
    link: { openOnClick: false, enableClickSelection: true },
    // Markdown has no underline, and a trailing paragraph would change the doc on mount.
    underline: false,
    trailingNode: false,
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  MarkdownSource,
];

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifier = unified()
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", emphasis: "*", rule: "-", listItemIndent: "one" });

class Unsupported extends Error {}

type MdastBlock = BlockContent | DefinitionContent;

type MarkJson = NonNullable<JSONContent["marks"]>[number];

const textJson = (text: string, marks: MarkJson[]): JSONContent[] =>
  text === "" ? [] : [{ type: "text", text, ...(marks.length > 0 ? { marks } : {}) }];

function inlineToJson(nodes: ReadonlyArray<PhrasingContent>, marks: MarkJson[]): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    switch (node.type) {
      case "text":
        return textJson(node.value, marks);
      case "inlineCode":
        return textJson(node.value, [...marks, { type: "code" }]);
      case "emphasis":
        return inlineToJson(node.children, [...marks, { type: "italic" }]);
      case "strong":
        return inlineToJson(node.children, [...marks, { type: "bold" }]);
      case "delete":
        return inlineToJson(node.children, [...marks, { type: "strike" }]);
      case "link":
        return inlineToJson(node.children, [
          ...marks,
          { type: "link", attrs: { href: node.url, title: node.title ?? null } },
        ]);
      case "break":
        return [{ type: "hardBreak" }];
      default:
        throw new Unsupported(node.type);
    }
  });
}

const withInline = (type: string, children: ReadonlyArray<PhrasingContent>, attrs?: object) => {
  const content = inlineToJson(children, []);
  return { type, ...(attrs ? { attrs } : {}), ...(content.length > 0 ? { content } : {}) };
};

function listItemToJson(item: ListItem, task: boolean): JSONContent {
  const [first, ...rest] = item.children;
  if (first?.type !== "paragraph") throw new Unsupported("listItem");
  return {
    type: task ? "taskItem" : "listItem",
    ...(task ? { attrs: { checked: item.checked === true } } : {}),
    content: [blockToJson(first), ...rest.map(blockToJson)],
  };
}

function blockToJson(node: RootContent | MdastBlock): JSONContent {
  switch (node.type) {
    case "paragraph":
      return withInline("paragraph", node.children);
    case "heading":
      return withInline("heading", node.children, { level: node.depth });
    case "blockquote":
      return { type: "blockquote", content: node.children.map(blockToJson) };
    case "code":
      if (node.meta) throw new Unsupported("code meta");
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null },
        ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
      };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "list": {
      const tasks = node.children.filter((item) => typeof item.checked === "boolean").length;
      const task = tasks > 0;
      if (task && (node.ordered || tasks < node.children.length))
        throw new Unsupported("task list");
      const content = node.children.map((item) => listItemToJson(item, task));
      if (task) return { type: "taskList", content };
      if (node.ordered) return { type: "orderedList", attrs: { start: node.start ?? 1 }, content };
      return { type: "bulletList", content };
    }
    default:
      throw new Unsupported(node.type);
  }
}

const sourceBlock = (source: string): JSONContent => ({
  type: "markdownSource",
  ...(source ? { content: [{ type: "text", text: source }] } : {}),
});

/** A description as editor content, with the source each top-level block came from. */
export interface ParsedDescription {
  readonly source: string;
  readonly doc: JSONContent;
  readonly blocks: ReadonlyArray<{ readonly source: string; readonly gapBefore: string }>;
  readonly trailing: string;
}

/**
 * Tables, HTML, reference definitions, and anything else rich text would lose stay
 * editable Markdown source. With `jira`, so does every block in Jira wiki markup.
 */
export function parseDescription(source: string, jira: boolean): ParsedDescription {
  const tree = parser.parse(source);
  const blocks: Array<{ source: string; gapBefore: string }> = [];
  const content: JSONContent[] = [];
  let offset = 0;
  for (const node of tree.children) {
    const start = node.position?.start.offset ?? offset;
    const end = node.position?.end.offset ?? start;
    const block = source.slice(start, end);
    blocks.push({ source: block, gapBefore: source.slice(offset, start) });
    offset = end;
    if (jira && workbenchDescriptionMarkdown(block, true) !== block) {
      content.push(sourceBlock(block));
      continue;
    }
    try {
      content.push(blockToJson(node));
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error;
      content.push(sourceBlock(block));
    }
  }
  return { source, doc: { type: "doc", content }, blocks, trailing: source.slice(offset) };
}

/** Whether the description uses Jira wiki markup, which reads best as source. */
export const descriptionUsesJiraMarkup = (source: string, jira: boolean) =>
  jira && workbenchDescriptionMarkdown(source, true) !== source;

export const descriptionEditorContent = (parsed: ParsedDescription): JSONContent =>
  parsed.doc.content?.length ? parsed.doc : { type: "doc", content: [{ type: "paragraph" }] };

/** Innermost first; links group across text nodes in `inlineToMdast`. */
const wrappingMarks = [
  ["italic", "emphasis"],
  ["bold", "strong"],
  ["strike", "delete"],
] as const;

function phrasing(text: string, marks: ReadonlyArray<Mark>): PhrasingContent {
  const has = (name: string) => marks.some((mark) => mark.type.name === name);
  let node: PhrasingContent = has("code")
    ? { type: "inlineCode", value: text }
    : { type: "text", value: text };
  for (const [mark, type] of wrappingMarks) {
    if (has(mark)) node = { type, children: [node] };
  }
  return node;
}

function inlineToMdast(node: ProseMirrorNode): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let link: { mark: Mark; children: PhrasingContent[] } | null = null;
  const flush = () => {
    if (link === null) return;
    const href = String(link.mark.attrs.href ?? "");
    const [only] = link.children;
    // A bare URL stays bare when GFM would link it back unchanged: plain text, no title, and
    // no trailing punctuation for autolinking to drop.
    if (
      link.children.length === 1 &&
      only?.type === "text" &&
      only.value === href &&
      link.mark.attrs.title == null &&
      /^https?:\/\/[^\s<>()]*[^\s<>().,:;!?'"*_~]$/.test(href)
    ) {
      result.push({ type: "html", value: href });
    } else {
      result.push({
        type: "link",
        url: href,
        title: (link.mark.attrs.title as string | null) ?? null,
        children: link.children,
      });
    }
    link = null;
  };
  node.forEach((child) => {
    const linkMark = child.marks.find((mark) => mark.type.name === "link") ?? null;
    if (link !== null && (linkMark === null || !linkMark.eq(link.mark))) flush();
    const content: PhrasingContent =
      child.type.name === "hardBreak" ? { type: "break" } : phrasing(child.text ?? "", child.marks);
    if (linkMark === null) {
      result.push(content);
      return;
    }
    link ??= { mark: linkMark, children: [] };
    link.children.push(content);
  });
  flush();
  return result;
}

function blocksToMdast(node: ProseMirrorNode): BlockContent[] {
  const children: BlockContent[] = [];
  node.forEach((child) => children.push(blockToMdast(child)));
  return children;
}

function listItemToMdast(item: ProseMirrorNode, checked: boolean | null): ListItem {
  return { type: "listItem", spread: false, checked, children: blocksToMdast(item) };
}

function blockToMdast(node: ProseMirrorNode): BlockContent {
  switch (node.type.name) {
    case "heading":
      return { type: "heading", depth: node.attrs.level, children: inlineToMdast(node) };
    case "blockquote":
      return { type: "blockquote", children: blocksToMdast(node) };
    case "codeBlock":
      return { type: "code", lang: node.attrs.language ?? null, value: node.textContent };
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const items: ListItem[] = [];
      node.forEach((item) =>
        items.push(
          listItemToMdast(item, node.type.name === "taskList" ? Boolean(item.attrs.checked) : null),
        ),
      );
      return {
        type: "list",
        ordered: node.type.name === "orderedList",
        start: node.type.name === "orderedList" ? node.attrs.start : null,
        spread: false,
        children: items,
      };
    }
    case "markdownSource":
      return { type: "html", value: node.textContent };
    default:
      return { type: "paragraph", children: inlineToMdast(node) };
  }
}

function serializeBlock(node: ProseMirrorNode): string {
  if (node.type.name === "markdownSource") return node.textContent;
  const root: Root = { type: "root", children: [blockToMdast(node)] };
  return stringifier.stringify(root).replace(/\n$/, "");
}

const isEmptyParagraph = (node: ProseMirrorNode) =>
  node.type.name === "paragraph" && node.childCount === 0;

const originals = new WeakMap<ParsedDescription, ProseMirrorNode>();

/** The loaded document in the editor's schema, since nodes are equal only within one schema. */
function originalDoc(doc: ProseMirrorNode, parsed: ParsedDescription): ProseMirrorNode {
  const cached = originals.get(parsed);
  if (cached?.type.schema === doc.type.schema) return cached;
  const original = ProseMirrorNode.fromJSON(doc.type.schema, parsed.doc);
  originals.set(parsed, original);
  return original;
}

/**
 * Markdown for `doc`. Blocks equal to one the editor loaded keep their source byte for byte,
 * with their original spacing, so only edited blocks are re-serialized.
 */
export function serializeDescription(doc: ProseMirrorNode, parsed: ParsedDescription): string {
  const original = originalDoc(doc, parsed);
  const parts: string[] = [];
  let next = 0;
  let previous: number | null = null;
  doc.forEach((node) => {
    let matched: number | null = null;
    for (let index = next; index < original.childCount; index += 1) {
      if (original.child(index).eq(node)) {
        matched = index;
        break;
      }
    }
    if (matched === null && isEmptyParagraph(node)) return;
    const first = parts.length === 0;
    const gap =
      matched !== null && (first ? matched === 0 : previous === matched - 1)
        ? parsed.blocks[matched]!.gapBefore
        : first
          ? ""
          : "\n\n";
    parts.push(gap, matched === null ? serializeBlock(node) : parsed.blocks[matched]!.source);
    if (matched !== null) next = matched + 1;
    previous = matched;
  });
  if (parts.length === 0) return parsed.blocks.length === 0 ? parsed.source : "";
  return parts.join("") + parsed.trailing;
}
