import { workbenchProgressCounts } from "@t3tools/contracts";
import { CheckSquareIcon, SquareIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { WorkbenchProgressCount } from "./WorkbenchProgressCount";
import { WorkbenchDescription } from "./WorkbenchDescription";
import { getWorkbenchProgressItems } from "./workbenchProgress.logic";

export function WorkbenchProgressChecklist({
  progress,
  limit,
}: {
  progress: string;
  limit?: number;
}) {
  const items = getWorkbenchProgressItems(progress);
  return (
    <ul aria-label="Progress" className="space-y-1.5">
      {items.slice(0, limit).map((item) => (
        <li key={item.line} className="flex items-start gap-2">
          {item.done ? (
            <CheckSquareIcon className="mt-1 size-3.5 shrink-0 text-success" aria-hidden />
          ) : (
            <SquareIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="sr-only">{item.done ? "Done: " : "To do: "}</span>
          <div className={cn("min-w-0", item.done && "text-muted-foreground line-through")}>
            <WorkbenchDescription markdown={item.text} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WorkbenchProgress({ progress }: { progress: string }) {
  const { done, total } = workbenchProgressCounts(progress);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Progress</h3>
        <WorkbenchProgressCount done={done} total={total} />
      </div>
      <WorkbenchProgressChecklist progress={progress} />
    </div>
  );
}
