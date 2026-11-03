import type { RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

// LCS tables are rows × columns; past this, a changed span shows as removed text, then added text.
const WORD_DIFF_CELL_CAP = 40_000;
const BLOCK_DIFF_CELL_CAP = 250_000;

/** A top-level Markdown block and the source range it came from. */
export interface MarkdownBlock {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly kind: RootContent["type"];
}

export const markdownBlocks = (markdown: string): ReadonlyArray<MarkdownBlock> =>
  parser.parse(markdown).children.flatMap((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined
      ? []
      : [{ start, end, source: markdown.slice(start, end), kind: node.type }];
  });

type DiffStep =
  | { readonly op: "same"; readonly a: number; readonly b: number }
  | { readonly op: "del"; readonly a: number }
  | { readonly op: "ins"; readonly b: number };

/** How many leading and trailing items `a` and `b` share, without overlapping. */
function commonEnds(a: ReadonlyArray<string>, b: ReadonlyArray<string>) {
  const shorter = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shorter && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shorter - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1;
  }
  return { prefix, suffix };
}

interface DiffWindow {
  readonly offset: number;
  readonly rows: number;
  readonly columns: number;
}

/** `lengths[row * (columns + 1) + column]` is the LCS length of `a[row..]` and `b[column..]`. */
function lcsLengths(a: ReadonlyArray<string>, b: ReadonlyArray<string>, window: DiffWindow) {
  const { offset, rows, columns } = window;
  const width = columns + 1;
  const lengths = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[row * width + column] =
        a[offset + row] === b[offset + column]
          ? lengths[(row + 1) * width + column + 1]! + 1
          : Math.max(lengths[(row + 1) * width + column]!, lengths[row * width + column + 1]!);
    }
  }
  return lengths;
}

/** LCS steps over `a[offset..offset+rows]` and `b[offset..offset+columns]`. */
function lcsSteps(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
  window: DiffWindow,
): DiffStep[] {
  const { offset, rows, columns } = window;
  const width = columns + 1;
  const lengths = lcsLengths(a, b, window);
  // At a tie, the deletion goes first, so a change reads as removed text, then added text.
  const nextOp = (row: number, column: number): DiffStep["op"] => {
    if (row < rows && column < columns && a[offset + row] === b[offset + column]) return "same";
    if (row === rows) return "ins";
    if (column === columns) return "del";
    return lengths[(row + 1) * width + column]! >= lengths[row * width + column + 1]!
      ? "del"
      : "ins";
  };
  const steps: DiffStep[] = [];
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    const op = nextOp(row, column);
    steps.push(
      op === "same"
        ? { op, a: offset + row, b: offset + column }
        : op === "del"
          ? { op, a: offset + row }
          : { op, b: offset + column },
    );
    if (op !== "ins") row += 1;
    if (op !== "del") column += 1;
  }
  return steps;
}

/**
 * Longest-common-subsequence steps from `a` to `b`, after trimming their common ends.
 * `capped` means the middle was too large to compare and shows as deleted, then inserted.
 */
function diffSequences(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
  cap: number,
): { readonly steps: ReadonlyArray<DiffStep>; readonly capped: boolean } {
  const { prefix, suffix } = commonEnds(a, b);
  const rows = a.length - prefix - suffix;
  const columns = b.length - prefix - suffix;
  const capped = rows * columns > cap;
  const middle: DiffStep[] = capped
    ? [
        ...Array.from({ length: rows }, (_, row): DiffStep => ({ op: "del", a: prefix + row })),
        ...Array.from({ length: columns }, (_, column): DiffStep => ({
          op: "ins",
          b: prefix + column,
        })),
      ]
    : lcsSteps(a, b, { offset: prefix, rows, columns });
  const steps: DiffStep[] = [
    ...Array.from({ length: prefix }, (_, index): DiffStep => ({ op: "same", a: index, b: index })),
    ...middle,
    ...Array.from({ length: suffix }, (_, index): DiffStep => ({
      op: "same",
      a: a.length - suffix + index,
      b: b.length - suffix + index,
    })),
  ];
  return { steps, capped };
}

export interface WordDiffSegment {
  readonly kind: "same" | "del" | "ins";
  readonly text: string;
}

const tokenize = (text: string) => text.match(/\s+|\S+/gu) ?? [];

/** A space between two changes belongs to both sides of one change rather than splitting it. */
const isSharedSpace = (tokens: ReadonlyArray<WordDiffSegment>, index: number) => {
  const next = tokens[index + 1];
  return /^\s+$/u.test(tokens[index]!.text) && next !== undefined && next.kind !== "same";
};

/** The removed and added text of the change starting at `start`, and the index after it. */
function collectChange(tokens: ReadonlyArray<WordDiffSegment>, start: number) {
  let removed = "";
  let added = "";
  let end = start;
  for (; end < tokens.length; end += 1) {
    const { kind, text } = tokens[end]!;
    if (kind === "same" && !isSharedSpace(tokens, end)) break;
    if (kind !== "ins") removed += text;
    if (kind !== "del") added += text;
  }
  return { removed, added, end };
}

/**
 * A word diff of two strings. Each change reads as the removed text followed by the added text.
 * Returns null when the strings are too large to compare word by word.
 */
export function diffWords(base: string, current: string): ReadonlyArray<WordDiffSegment> | null {
  const a = tokenize(base);
  const b = tokenize(current);
  const { steps, capped } = diffSequences(a, b, WORD_DIFF_CELL_CAP);
  if (capped) return null;
  const tokens: ReadonlyArray<WordDiffSegment> = steps.map((step) =>
    step.op === "ins" ? { kind: "ins", text: b[step.b]! } : { kind: step.op, text: a[step.a]! },
  );
  const segments: Array<{ kind: WordDiffSegment["kind"]; text: string }> = [];
  const append = (kind: WordDiffSegment["kind"], text: string) => {
    if (text === "") return;
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += text;
    else segments.push({ kind, text });
  };
  let index = 0;
  while (index < tokens.length) {
    if (tokens[index]!.kind === "same") {
      append("same", tokens[index]!.text);
      index += 1;
      continue;
    }
    const change = collectChange(tokens, index);
    append("del", change.removed);
    append("ins", change.added);
    index = change.end;
  }
  return segments;
}

/** `key` is stable across renders of the same pair of texts. */
export type MarkdownReviewEntry =
  /** Consecutive unchanged blocks, as the current source between the first and the last. */
  | { readonly kind: "unchanged"; readonly key: string; readonly source: string }
  | {
      readonly kind: "changed";
      readonly key: string;
      readonly blockKind: MarkdownBlock["kind"];
      readonly words: ReadonlyArray<WordDiffSegment>;
    }
  | { readonly kind: "added" | "removed"; readonly key: string; readonly block: MarkdownBlock };

export interface MarkdownReview {
  readonly entries: ReadonlyArray<MarkdownReviewEntry>;
  /** Changed, added, and removed blocks, each counted once. */
  readonly changedBlocks: number;
  /** The block kind when exactly one block changed. */
  readonly onlyChangedKind: MarkdownBlock["kind"] | null;
  /**
   * The current text's link and footnote definitions. Each entry renders as its own document,
   * so one needs these appended to resolve a reference whose definition is in another block.
   */
  readonly definitions: string;
}

/**
 * Pairs the base and current top-level blocks; an unpaired removal and addition in the same
 * place is one changed block with a word diff of its source.
 */
export function diffMarkdownBlocks(base: string, current: string): MarkdownReview {
  const baseBlocks = markdownBlocks(base);
  const currentBlocks = markdownBlocks(current);
  const { steps } = diffSequences(
    baseBlocks.map((block) => block.source),
    currentBlocks.map((block) => block.source),
    BLOCK_DIFF_CELL_CAP,
  );
  const entries: MarkdownReviewEntry[] = [];
  const changedKinds: Array<MarkdownBlock["kind"]> = [];
  // The current-source range of the unchanged blocks since the last change.
  const unchanged: { range: { start: number; end: number } | null } = { range: null };
  let removed: MarkdownBlock[] = [];
  let added: MarkdownBlock[] = [];
  const flushUnchanged = () => {
    const { range } = unchanged;
    if (range !== null) {
      entries.push({
        kind: "unchanged",
        key: `unchanged:${range.start}`,
        source: current.slice(range.start, range.end),
      });
    }
    unchanged.range = null;
  };
  const flushChanges = () => {
    const pairs = Math.min(removed.length, added.length);
    const extraRemoved = removed.slice(pairs);
    const extraAdded = added.slice(pairs);
    for (let index = 0; index < pairs; index += 1) {
      const before = removed[index]!;
      const after = added[index]!;
      const words = diffWords(before.source, after.source);
      changedKinds.push(after.kind);
      if (words === null) {
        entries.push(
          { kind: "removed", key: `removed:${before.start}`, block: before },
          { kind: "added", key: `added:${after.start}`, block: after },
        );
      } else {
        entries.push({
          kind: "changed",
          key: `changed:${before.start}:${after.start}`,
          blockKind: after.kind,
          words,
        });
      }
    }
    for (const block of extraRemoved) {
      changedKinds.push(block.kind);
      entries.push({ kind: "removed", key: `removed:${block.start}`, block });
    }
    for (const block of extraAdded) {
      changedKinds.push(block.kind);
      entries.push({ kind: "added", key: `added:${block.start}`, block });
    }
    removed = [];
    added = [];
  };
  for (const step of steps) {
    if (step.op === "same") {
      flushChanges();
      const block = currentBlocks[step.b]!;
      unchanged.range = { start: unchanged.range?.start ?? block.start, end: block.end };
    } else {
      flushUnchanged();
      if (step.op === "del") removed.push(baseBlocks[step.a]!);
      else added.push(currentBlocks[step.b]!);
    }
  }
  flushChanges();
  flushUnchanged();
  return {
    entries,
    changedBlocks: changedKinds.length,
    onlyChangedKind: changedKinds.length === 1 ? changedKinds[0]! : null,
    definitions: currentBlocks
      .filter((block) => block.kind === "definition" || block.kind === "footnoteDefinition")
      .map((block) => block.source)
      .join("\n\n"),
  };
}

const BLOCK_KIND_LABELS: Partial<Record<MarkdownBlock["kind"], string>> = {
  paragraph: "paragraph",
  heading: "heading",
  list: "list",
  code: "code block",
  table: "table",
  blockquote: "quote",
  thematicBreak: "divider",
};

/** A block kind as prose, such as "paragraph" or "code block". */
export const markdownBlockLabel = (kind: MarkdownBlock["kind"]) =>
  BLOCK_KIND_LABELS[kind] ?? "block";

/** "Unreviewed changes" and "title and 2 blocks", or "Unreviewed change" and "1 paragraph". */
export function describeMarkdownReview({
  titleChanged,
  review,
}: {
  readonly titleChanged: boolean;
  readonly review: MarkdownReview;
}): { readonly heading: string; readonly detail: string | null } {
  const blocks =
    review.changedBlocks === 0
      ? null
      : review.changedBlocks === 1
        ? `1 ${review.onlyChangedKind === null ? "block" : markdownBlockLabel(review.onlyChangedKind)}`
        : `${review.changedBlocks} blocks`;
  const parts = [titleChanged ? "title" : null, blocks].filter((part) => part !== null);
  const count = (titleChanged ? 1 : 0) + review.changedBlocks;
  return {
    heading: count > 1 ? "Unreviewed changes" : "Unreviewed change",
    detail: parts.length === 0 ? null : parts.join(" and "),
  };
}

/** The whole blocks a selection touches, as an Ask for change range in `markdown`. */
export function coverMarkdownBlocks(
  markdown: string,
  ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): { readonly start: number; readonly end: number; readonly blockSource: string } | null {
  if (ranges.length === 0) return null;
  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  return { start, end, blockSource: markdown.slice(start, end) };
}
