import { ArrowUpIcon, SparklesIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Popover, PopoverPopup } from "../components/ui/popover";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import type { useMarkdownAskForChange } from "./useMarkdownAskForChange";

type MarkdownAsk = ReturnType<typeof useMarkdownAskForChange>;

/** The outlined blocks' frame and, while a rewrite runs, their dimming. */
export const askForChangeTargetClassName = ({
  wholeMarked,
  running,
}: Pick<MarkdownAsk, "wholeMarked" | "running">) =>
  wholeMarked
    ? [
        "rounded-md bg-info/4 outline-1 -outline-offset-1 outline-info/70 outline-dashed",
        running && "opacity-60",
      ]
    : [
        "[&_[data-marked]]:rounded-sm [&_[data-marked]]:bg-info/4 [&_[data-marked]]:outline-1 [&_[data-marked]]:-outline-offset-1 [&_[data-marked]]:outline-info/70 [&_[data-marked]]:outline-dashed",
        running && "[&_[data-marked]]:opacity-60",
      ];

const anchorFor = (container: HTMLElement | null) => {
  if (container === null) return null;
  const marked = [...container.querySelectorAll("[data-marked]")];
  if (marked.length === 0) return container;
  return {
    contextElement: marked[0],
    getBoundingClientRect: () => {
      const rects = marked.map((element) => element.getBoundingClientRect());
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return DOMRect.fromRect({ x: left, y: top, width: right - left, height: bottom - top });
    },
  };
};

/**
 * The Ask for change pill beside a selection, its prompt, and the running state with Cancel.
 * Enter sends, Shift+Enter starts a new line, and Esc closes.
 */
export function WorkbenchAskForChange({ ask }: { readonly ask: MarkdownAsk }) {
  const { popover } = ask;
  if (popover === null) return null;
  const { phase } = popover;
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) popover.close();
      }}
    >
      <PopoverPopup
        anchor={() => anchorFor(ask.containerRef.current)}
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
