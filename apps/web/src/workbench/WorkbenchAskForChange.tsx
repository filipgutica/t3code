import { ArrowUpIcon, SparklesIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../components/ui/button";
import { Popover, PopoverPopup } from "../components/ui/popover";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import type { useMarkdownAskForChange } from "./useMarkdownAskForChange";
import "./WorkbenchAskForChange.css";

type MarkdownAsk = ReturnType<typeof useMarkdownAskForChange>;

const SELECTION_HIGHLIGHT = "workbench-ask-for-change";

/**
 * The whole brief's frame and its dimming while it runs. The padding keeps the dashes off the
 * text, and the matching negative margin keeps the brief from moving when the frame appears.
 */
export const askForChangeTargetClassName = ({
  wholeMarked,
  running,
}: Pick<MarkdownAsk, "wholeMarked" | "running">) =>
  wholeMarked && [
    "-m-2 rounded-md p-2 outline-1 -outline-offset-1 outline-info/70 outline-dashed",
    running && "opacity-60",
  ];

/** Paints `range` until the returned cleanup runs; without CSS highlights it stays unpainted. */
function paintSelection(range: Range) {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") {
    return undefined;
  }
  // Shared by every brief on the page, so each removes only its own range.
  const highlight = CSS.highlights.get(SELECTION_HIGHLIGHT) ?? new Highlight();
  CSS.highlights.set(SELECTION_HIGHLIGHT, highlight);
  highlight.add(range);
  return () => {
    highlight.delete(range);
    if (highlight.size === 0) CSS.highlights.delete(SELECTION_HIGHLIGHT);
  };
}

const anchorFor = (container: HTMLElement | null, selection: Range | null) =>
  container !== null && selection !== null
    ? { contextElement: container, getBoundingClientRect: () => selection.getBoundingClientRect() }
    : container;

/**
 * The Ask for change pill beside a selection, its prompt, and the running state with Cancel.
 * Enter sends, Shift+Enter starts a new line, and Esc closes.
 */
export function WorkbenchAskForChange({ ask }: { readonly ask: MarkdownAsk }) {
  const { popover, selection } = ask;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the selection's entry in the browser's CSS highlight registry until it changes or unmounts
  useEffect(() => (selection === null ? undefined : paintSelection(selection)), [selection]);
  if (popover === null) return null;
  const { phase } = popover;
  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return;
        popover.dismiss(details.reason === "outside-press" ? details.event.target : null);
      }}
    >
      <PopoverPopup
        anchor={() => anchorFor(ask.containerRef.current, selection)}
        side="bottom"
        align={phase.kind === "pill" ? "end" : "start"}
        sideOffset={8}
        padding={phase.kind === "pill" ? "none" : "compact"}
        width={phase.kind === "pill" ? "auto" : "lg"}
        // The pill must not take focus, or the selection it describes would collapse.
        initialFocus={phase.kind !== "pill"}
        finalFocus={false}
      >
        {phase.kind === "pill" ? (
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={popover.openPrompt}
          >
            <SparklesIcon /> Ask for change
          </Button>
        ) : phase.kind === "running" ? (
          <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner size="sm" aria-hidden />
            <span className="flex-1">Rewriting…</span>
            <Button size="xs" type="button" variant="ghost" onClick={popover.cancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              popover.send();
            }}
          >
            <Textarea
              aria-label="Describe the edit"
              placeholder="Describe the edit…"
              size="sm"
              autoFocus
              maxLength={4_000}
              value={popover.instruction}
              onChange={(event) => popover.setInstruction(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                popover.send();
              }}
            />
            {phase.error ? (
              <p role="alert" className="text-xs text-destructive">
                {phase.error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {popover.scope} with the text generation model.
              </p>
              <Button
                aria-label="Send"
                size="icon-sm"
                type="submit"
                disabled={popover.instruction.trim() === ""}
              >
                <ArrowUpIcon />
              </Button>
            </div>
          </form>
        )}
      </PopoverPopup>
    </Popover>
  );
}
