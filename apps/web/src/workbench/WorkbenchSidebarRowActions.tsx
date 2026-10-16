import { EllipsisIcon, type LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";

type RowAction = (position: { x: number; y: number }, trigger: HTMLButtonElement) => void;

function selectAtTrigger(trigger: HTMLButtonElement, action: RowAction) {
  trigger.focus({ preventScroll: true });
  const bounds = trigger.getBoundingClientRect();
  action({ x: bounds.left, y: bounds.bottom }, trigger);
}

export function handleWorkbenchSidebarMenuKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  openMenu: RowAction,
) {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  selectAtTrigger(event.currentTarget, openMenu);
}

export function WorkbenchSidebarQuickAction({
  label,
  Icon,
  onSelect,
  disabled = false,
}: {
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly onSelect: RowAction;
  readonly disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-workbench-sidebar-quick-action=""
            aria-label={label}
            disabled={disabled}
            onClick={(event) => selectAtTrigger(event.currentTarget, onSelect)}
          />
        }
      >
        <Icon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function WorkbenchSidebarRowActions({
  label,
  openMenu,
}: {
  readonly label: string;
  readonly openMenu: RowAction;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      data-workbench-sidebar-row-actions=""
      onKeyDown={(event) => handleWorkbenchSidebarMenuKeyDown(event, openMenu)}
      onClick={(event) => selectAtTrigger(event.currentTarget, openMenu)}
    >
      <EllipsisIcon aria-hidden className="size-4" />
    </button>
  );
}
