import { useRef, useState } from "react";

import { coverMarkdownBlocks } from "./markdownReview";

/** The whole top-level blocks an Ask for change rewrites, in the exact saved Markdown. */
export interface MarkdownAskTarget {
  readonly markdown: string;
  readonly start: number;
  readonly end: number;
  readonly blockSource: string;
  readonly selectedText: string;
  /** The selected text, which the UI marks; null for the header action's whole document. */
  readonly range: Range | null;
  /** The header action's whole document, rather than the blocks a selection touched. */
  readonly whole: boolean;
}

export interface MarkdownAskRequest {
  readonly start: number;
  readonly end: number;
  readonly blockSource: string;
  readonly selectedText: string;
  readonly instruction: string;
  /** Aborted by Cancel; the request must then stop and write nothing. */
  readonly signal: AbortSignal;
}

/** Whether `element` holds any of `range`'s text; a range ending at a block's start does not. */
const rangeTouches = (range: Range, element: Element) => {
  const part = element.ownerDocument.createRange();
  part.selectNodeContents(element);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }
  return !part.collapsed && part.toString().trim() !== "";
};

/**
 * Maps the document selection inside `container`, which renders `markdown` with source offsets
 * on its top-level blocks, to the whole blocks it touches.
 */
function readMarkdownBlockSelection(
  container: HTMLElement,
  markdown: string,
): MarkdownAskTarget | null {
  const selection = container.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const blocks = [...container.querySelectorAll<HTMLElement>("[data-source-start]")].flatMap(
    (element) => {
      const start = Number(element.dataset.sourceStart);
      const end = Number(element.dataset.sourceEnd);
      return Number.isInteger(start) && Number.isInteger(end) && rangeTouches(range, element)
        ? [{ start, end }]
        : [];
    },
  );
  const covered = coverMarkdownBlocks(markdown, blocks);
  return covered === null
    ? null
    : {
        ...covered,
        markdown,
        selectedText: selection.toString(),
        // The selection's own range follows later selections, so keep a copy.
        range: range.cloneRange(),
        whole: false,
      };
}

type AskPhase =
  | { readonly kind: "pill" }
  | { readonly kind: "prompt"; readonly error: string | null }
  | { readonly kind: "running"; readonly controller: AbortController };

/**
 * Selecting rendered Markdown offers Ask for change on the selected text. The request carries
 * the whole blocks it touches, since only whole blocks splice safely, and asks the model to
 * change only the selection; `askWhole` targets the entire document. A target holds until it is sent, dismissed, or the
 * Markdown changes under it. `enabled` is false where offsets would not match the saved text.
 */
export function useMarkdownAskForChange({
  markdown,
  enabled,
  onAsk,
}: {
  readonly markdown: string;
  readonly enabled: boolean;
  /** Resolves with an error to show, or null once the change is written or cancelled. */
  readonly onAsk: (request: MarkdownAskRequest) => Promise<string | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [target, setTarget] = useState<MarkdownAskTarget | null>(null);
  const [phase, setPhase] = useState<AskPhase>({ kind: "pill" });
  const [instruction, setInstruction] = useState("");
  const running = phase.kind === "running";
  // A selection over older text no longer names these blocks; an open prompt keeps its target
  // so a send can report that instead of vanishing.
  const current = target !== null && target.markdown === markdown;
  const live = target !== null && (current || phase.kind !== "pill") ? target : null;

  const close = () => {
    if (running) return;
    setTarget(null);
    setPhase({ kind: "pill" });
  };
  // The pill opens after the second click of a triple-click, so that gesture's third click is a
  // press outside it. Presses in the text are the selection's to decide on release instead.
  const dismiss = (pressTarget: EventTarget | null) => {
    const container = containerRef.current;
    const pressedText = pressTarget instanceof Node && container?.contains(pressTarget) === true;
    if (phase.kind === "pill" && pressedText) return;
    close();
  };
  const capture = () => {
    const container = containerRef.current;
    if (!enabled || running || phase.kind === "prompt" || container === null) return;
    // A press that collapses the selection, such as a click in the text, drops the pill.
    setTarget(readMarkdownBlockSelection(container, markdown));
  };
  const send = async () => {
    const text = instruction.trim();
    if (live === null || text === "" || running) return;
    const controller = new AbortController();
    setPhase({ kind: "running", controller });
    const error = await onAsk({
      start: live.start,
      end: live.end,
      blockSource: live.blockSource,
      selectedText: live.selectedText,
      instruction: text,
      signal: controller.signal,
    });
    if (controller.signal.aborted || error !== null) {
      setPhase({ kind: "prompt", error: controller.signal.aborted ? null : error });
      return;
    }
    setTarget(null);
    setInstruction("");
    setPhase({ kind: "pill" });
  };

  return {
    containerRef,
    /** Spread on the element that renders the Markdown with source offsets. */
    selectionHandlers: { onPointerUp: capture, onKeyUp: capture },
    /** The selected text to mark, while the rendered text is still the one it was taken from. */
    selection: live !== null && current ? live.range : null,
    wholeMarked: live?.whole === true,
    available: enabled,
    running,
    askWhole: () => {
      if (!enabled || running) return;
      setTarget({
        markdown,
        start: 0,
        end: markdown.length,
        blockSource: markdown,
        selectedText: "",
        range: null,
        whole: true,
      });
      setPhase({ kind: "prompt", error: null });
    },
    popover:
      live === null
        ? null
        : {
            phase,
            scope: live.whole ? "Rewrites all of it" : "Edits the selected text",
            instruction,
            setInstruction,
            openPrompt: () => setPhase({ kind: "prompt", error: null }),
            send: () => void send(),
            cancel: () => {
              if (phase.kind === "running") phase.controller.abort();
            },
            dismiss,
          },
  };
}
