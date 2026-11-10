import { Extension, InputRule, Node, type JSONContent } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { Node as ProseMirrorNode, type Mark } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import type {
  BlockContent,
  DefinitionContent,
  Link,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import {
  ComposerBoldExtension,
  ComposerBoldSelectionOnlyExtension,
  ComposerCodeBlockExtension,
  ComposerCodeExtension,
  ComposerItalicExtension,
  ComposerStrikeExtension,
} from "~/composer-rich-text-doc";

import { parseDescriptionHref } from "./workbenchReferences.logic";

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

/** A link to a Reference with its plain-text title, shown as the chip the saved description uses. */
export const ReferenceChip = Node.create({
  name: "referenceChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ href: { default: "" }, title: { default: null } }),
  parseHTML: () => [{ tag: "span[data-reference-chip]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-reference-chip": "", ...HTMLAttributes }],
  // Copied text carries the chip as its Markdown link, which pastes back as the chip.
  renderText: ({ node }) =>
    stringifier
      .stringify({
        type: "root",
        children: [
          { type: "paragraph", children: [chipToMdast(node.attrs.href, node.attrs.title)] },
        ],
      })
      .trim(),
  addInputRules() {
    const chip = (href: string, title: string | null) => this.type.create({ href, title });
    return [
      // `[title](href)`, with `<href>` for a path with spaces.
      new InputRule({
        find: /\[([^\[\]\n]+)\]\((<[^<>\n]+>|[^()\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const href = match[2]!.replace(/^<(.*)>$/, "$1");
          if (parseDescriptionHref(href) === null) return null;
          state.tr.replaceWith(range.from, range.to, chip(href, match[1]!));
        },
      }),
      // A URL or an absolute path with a folder, finished with a space.
      new InputRule({
        find: /(?:^|\s)(https?:\/\/\S+|\/[^\s/]+\/\S+)\s$/,
        handler: ({ state, range, match }) => {
          const href = match[1]!.replace(/[.,:;!?'"]+$/, "");
          if (parseDescriptionHref(href) === null) return null;
          const start = range.from + match[0].indexOf(match[1]!);
          // The rule consumes the typed space, so put it back after the chip and any punctuation.
          state.tr
            .replaceWith(start, start + href.length, chip(href, null))
            .insertText(match[0].slice(-1), range.to - href.length + 1);
        },
      }),
    ];
  },
});

/** A loaded top-level block's place in the source, so an untouched block keeps its own bytes. */
const SourceIndex = Extension.create({
  name: "sourceIndex",
  addGlobalAttributes: () => [
    {
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "bulletList",
        "orderedList",
        "taskList",
        "markdownSource",
      ],
      attributes: { sourceIndex: { default: null, rendered: false, keepOnSplit: false } },
    },
  ],
});

// Fences open and close on Enter in the editor's key handler, as in the composer.
export const DescriptionCodeBlock = ComposerCodeBlockExtension.extend({ addInputRules: () => [] });

export const descriptionEditorExtensions = [
  StarterKit.configure({
    // Reference links are chips; other links (such as `mailto:`) stay link text.
    link: { openOnClick: false, enableClickSelection: true, autolink: false, linkOnPaste: false },
    // Markdown has no underline, and a trailing paragraph would change the doc on mount.
    underline: false,
    trailingNode: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    codeBlock: false,
  }),
  // The composer's typing rules, so formatting behaves as it does in the chat composer.
  ComposerBoldExtension,
  ComposerItalicExtension,
  ComposerStrikeExtension,
  ComposerCodeExtension,
  ComposerBoldSelectionOnlyExtension,
  DescriptionCodeBlock,
  TaskList,
  TaskItem.configure({ nested: true }),
  MarkdownSource,
  ReferenceChip,
  SourceIndex,
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

/** A Reference link as the chip `chipToMdast` writes back, or null to keep it link text. */
function referenceChipJson(node: Link, marks: MarkJson[]): JSONContent[] | null {
  const [only] = node.children;
  // A chip carries no marks, so a formatted link stays link text.
  if (marks.length > 0 || node.title || node.children.length !== 1 || only?.type !== "text") {
    return null;
  }
  const reference = parseDescriptionHref(node.url);
  if (reference === null) return null;
  // Untitled only when `chipToMdast` writes the same text back.
  const untitled = only.value === (reference.kind === "file" ? reference.label : node.url);
  return [
    { type: "referenceChip", attrs: { href: node.url, title: untitled ? null : only.value } },
  ];
}

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
        return (
          referenceChipJson(node, marks) ??
          inlineToJson(node.children, [
            ...marks,
            { type: "link", attrs: { href: node.url, title: node.title ?? null } },
          ])
        );
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
        attrs: { language: node.lang ?? "" },
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
 * editable Markdown source.
 */
function blockOrSource(node: RootContent, source: string): JSONContent {
  try {
    return blockToJson(node);
  } catch (error) {
    if (!(error instanceof Unsupported)) throw error;
    return sourceBlock(source);
  }
}

export function parseDescription(source: string): ParsedDescription {
  const tree = parser.parse(source);
  const blocks: Array<{ source: string; gapBefore: string }> = [];
  const content: JSONContent[] = [];
  let offset = 0;
  for (const node of tree.children) {
    const start = node.position?.start.offset ?? offset;
    const end = node.position?.end.offset ?? start;
    const block = source.slice(start, end);
    const sourceIndex = blocks.length;
    blocks.push({ source: block, gapBefore: source.slice(offset, start) });
    offset = end;
    const json = blockOrSource(node, block);
    content.push({ ...json, attrs: { ...json.attrs, sourceIndex } });
  }
  return { source, doc: { type: "doc", content }, blocks, trailing: source.slice(offset) };
}

/** Pasted Markdown as editor blocks: links become chips and unsupported syntax stays source. */
export const descriptionPasteContent = (text: string): JSONContent => ({
  type: "doc",
  // Pasted blocks are new, not the loaded blocks at those indexes.
  content: (parseDescription(text).doc.content ?? []).map(({ attrs, ...block }) => {
    const { sourceIndex: _, ...rest } = attrs ?? {};
    return { ...block, attrs: rest };
  }),
});

export const descriptionEditorContent = (parsed: ParsedDescription): JSONContent =>
  parsed.doc.content?.length ? parsed.doc : { type: "doc", content: [{ type: "paragraph" }] };

/** GFM links a bare URL back unchanged when nothing at its end would be read as punctuation. */
const isBareUrl = (href: string) => /^https?:\/\/[^\s<>()]*[^\s<>().,:;!?'"*_~\]]$/.test(href);

function chipToMdast(href: string, title: string | null): PhrasingContent {
  if (title === null && isBareUrl(href)) return { type: "html", value: href };
  const reference = parseDescriptionHref(href);
  const text = title ?? (reference?.kind === "file" ? reference.label : href);
  return { type: "link", url: href, title: null, children: [{ type: "text", value: text }] };
}

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
    // A bare URL stays bare only as plain, untitled text that GFM links back unchanged.
    if (
      link.children.length === 1 &&
      only?.type === "text" &&
      only.value === href &&
      link.mark.attrs.title == null &&
      isBareUrl(href)
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
    if (child.type.name === "referenceChip") {
      result.push(chipToMdast(String(child.attrs.href), child.attrs.title as string | null));
      return;
    }
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
  return result.map((child, index) =>
    child.type === "html" && !bareUrlStandsAlone(result[index - 1], result[index + 1])
      ? {
          type: "link",
          url: child.value,
          title: null,
          children: [{ type: "text", value: child.value }],
        }
      : child,
  );
}

/** GFM links a bare URL only after a space and up to a space, or punctuation then a space. */
const bareUrlStandsAlone = (before?: PhrasingContent, after?: PhrasingContent) =>
  (before === undefined || (before.type === "text" && /\s$/.test(before.value))) &&
  (after === undefined || (after.type === "text" && /^[.,:;!?]*(?:\s|$)/.test(after.value)));

/** Markdown ignores spaces at a line's ends, and remark-stringify would write them as `&#x20;`. */
function trimmedInline(node: ProseMirrorNode): PhrasingContent[] {
  const children = inlineToMdast(node);
  const first = children[0];
  if (first?.type === "text") first.value = first.value.trimStart();
  const last = children.at(-1);
  if (last?.type === "text") last.value = last.value.trimEnd();
  return children.filter((child) => child.type !== "text" || child.value !== "");
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
      return { type: "heading", depth: node.attrs.level, children: trimmedInline(node) };
    case "blockquote":
      return { type: "blockquote", children: blocksToMdast(node) };
    case "codeBlock":
      return { type: "code", lang: node.attrs.language || null, value: node.textContent };
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
      return { type: "paragraph", children: trimmedInline(node) };
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
  const used = new Set<number>();
  const loadedIndex = (node: ProseMirrorNode): number | null => {
    const index: unknown = node.attrs.sourceIndex;
    if (typeof index !== "number" || used.has(index) || index >= original.childCount) return null;
    if (!original.child(index).eq(node)) return null;
    used.add(index);
    return index;
  };
  const parts: string[] = [];
  let previous: number | null = null;
  doc.forEach((node) => {
    const matched = loadedIndex(node);
    if (matched === null && isEmptyParagraph(node)) return;
    const first = parts.length === 0;
    const gap =
      matched !== null && (first ? matched === 0 : previous === matched - 1)
        ? parsed.blocks[matched]!.gapBefore
        : first
          ? ""
          : "\n\n";
    parts.push(gap, matched === null ? serializeBlock(node) : parsed.blocks[matched]!.source);
    previous = matched;
  });
  if (parts.length === 0) return parsed.blocks.length === 0 ? parsed.source : "";
  return parts.join("") + parsed.trailing;
}
