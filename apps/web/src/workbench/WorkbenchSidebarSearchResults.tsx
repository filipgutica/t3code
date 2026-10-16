import { BlocksIcon, BookOpenIcon, FilePenLineIcon, MessageSquareIcon } from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import type { WorkbenchSidebarSearchResult } from "./workbenchSidebarSearch.logic";

const RESULT_KINDS = {
  workspace: { label: "Workspace", Icon: BlocksIcon },
  ticket: { label: "Ticket", Icon: BookOpenIcon },
  thread: { label: "Thread", Icon: MessageSquareIcon },
  draft: { label: "Draft", Icon: FilePenLineIcon },
};

export function WorkbenchSidebarSearchResults({
  results,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: {
  readonly results: ReadonlyArray<WorkbenchSidebarSearchResult>;
  readonly activeIndex: number;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onSelect: (result: WorkbenchSidebarSearchResult) => void;
}) {
  return (
    <SidebarMenu
      aria-label="Workbench search results"
      id="workbench-sidebar-search-results"
      role="listbox"
    >
      {results.map((result, index) => {
        const { label, Icon } = RESULT_KINDS[result.kind];
        return (
          <SidebarMenuItem key={result.key} role="presentation">
            <SidebarMenuButton
              aria-selected={index === activeIndex}
              className="h-auto min-h-12 items-start"
              id={`workbench-sidebar-search-result-${index}`}
              isActive={index === activeIndex}
              onClick={() => onSelect(result)}
              onFocus={() => onActiveIndexChange(index)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActiveIndexChange(index)}
              role="option"
              size="lg"
              type="button"
            >
              <Icon aria-hidden className="mt-0.5 size-4" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{result.title}</span>
                  <span className="shrink-0 text-xs text-sidebar-muted-foreground">{label}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-sidebar-muted-foreground">
                  {result.subtitle}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
