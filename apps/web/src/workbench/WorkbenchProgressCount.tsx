import { cn } from "../lib/utils";

export function WorkbenchProgressCount({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  return (
    <span
      aria-label={`Progress: ${done} of ${total}`}
      className={cn(
        "shrink-0 text-xs font-normal tabular-nums",
        done === total ? "text-success" : "text-muted-foreground",
      )}
    >
      {done} of {total}
    </span>
  );
}
