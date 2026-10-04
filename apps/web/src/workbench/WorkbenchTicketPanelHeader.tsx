import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { Button } from "../components/ui/button";

export function useWorkbenchTicketPanelCollapsed(panel: "attention" | "threads" | "pull-requests") {
  return useLocalStorage(`t3code:workbench:ticket-panel:${panel}:collapsed`, false, Schema.Boolean);
}

export function WorkbenchTicketPanelHeader({
  title,
  count,
  description,
  collapsed,
  onToggle,
  contentId,
  actions,
  heading,
  toggleDisabled,
}: {
  title: string;
  count?: number | undefined;
  description?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  contentId: string;
  actions?: ReactNode;
  heading?: ReactNode;
  toggleDisabled?: boolean | undefined;
}) {
  const label = count === undefined ? title : `${title} (${count})`;
  return (
    <div className="flex items-start gap-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        {heading ?? (
          <h2 aria-label={label} className="text-sm font-semibold leading-6">
            {title}
            {count !== undefined ? (
              <span className="ml-2 font-normal tabular-nums text-muted-foreground">{count}</span>
            ) : null}
          </h2>
        )}
        {description ? (
          <span
            id={`${contentId}-description`}
            className="mt-1 block truncate text-xs font-normal leading-5 text-muted-foreground"
          >
            {description}
          </span>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      <Button
        type="button"
        aria-label={`Toggle ${label}`}
        aria-describedby={description ? `${contentId}-description` : undefined}
        aria-controls={contentId}
        aria-expanded={!collapsed}
        onClick={onToggle}
        disabled={toggleDisabled}
        size="icon-xs"
        variant="ghost"
      >
        <ChevronDownIcon
          aria-hidden
          data-expanded={!collapsed}
          className="data-[expanded=true]:rotate-180"
        />
      </Button>
    </div>
  );
}
