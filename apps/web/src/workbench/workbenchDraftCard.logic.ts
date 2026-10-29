export type WorkbenchDraftCardMode = "collapsed" | "compact" | "full";

// The default chat is 540px tall in a 900px window; shorter chats leave the transcript too little room.
const COMPACT_MIN_CHAT_HEIGHT = 520;

export const getInitialDraftCardMode = (chatHeight: number): WorkbenchDraftCardMode =>
  chatHeight >= COMPACT_MIN_CHAT_HEIGHT ? "compact" : "collapsed";

export interface DraftBriefPreviewLine {
  /** The line's index in the brief, unique within it. */
  readonly line: number;
  readonly text: string;
  readonly checkbox: boolean;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

/** The brief's first list items, or its first lines when it has no list, and how many follow. */
export const getDraftBriefPreview = (markdown: string, limit: number) => {
  const lines = markdown.split("\n").flatMap((raw, line) => {
    const text = raw.trim();
    return text.length > 0 && !text.startsWith("#") ? [{ line, text }] : [];
  });
  const items = lines.flatMap(({ line, text }) => {
    const match = LIST_ITEM.exec(text);
    return match?.[2] ? [{ line, text: match[2], checkbox: match[1] !== undefined }] : [];
  });
  const source: ReadonlyArray<DraftBriefPreviewLine> =
    items.length > 0 ? items : lines.map((entry) => ({ ...entry, checkbox: false }));
  return { lines: source.slice(0, limit), remaining: Math.max(0, source.length - limit) };
};
