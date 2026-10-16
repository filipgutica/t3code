import type { ReactNode, Ref } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { handleWorkbenchSidebarMenuKeyDown } from "./WorkbenchSidebarRowActions";

export function WorkbenchSidebarRowNavigation({
  label,
  isActive,
  onSelect,
  openMenu,
  preview,
  children,
  compact = false,
  ref,
}: {
  readonly label: string;
  readonly isActive: boolean;
  readonly onSelect: () => void;
  readonly openMenu?: (position: { x: number; y: number }, trigger: HTMLButtonElement) => void;
  readonly preview?: ReactNode;
  readonly children: ReactNode;
  readonly compact?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}) {
  const button = (
    <button
      type="button"
      ref={ref}
      data-workbench-sidebar-navigation={compact ? "compact" : "detail"}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      onClick={onSelect}
      onKeyDown={
        openMenu ? (event) => handleWorkbenchSidebarMenuKeyDown(event, openMenu) : undefined
      }
      onContextMenu={
        openMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus({ preventScroll: true });
              openMenu({ x: event.clientX, y: event.clientY }, event.currentTarget);
            }
          : undefined
      }
    >
      {children}
    </button>
  );
  if (!preview) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup align="start" side="right" variant="glass" className="text-left">
        {preview}
      </TooltipPopup>
    </Tooltip>
  );
}
