import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, WorkbenchReference } from "@t3tools/contracts";
import { LibraryIcon } from "lucide-react";

import { WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useRightPanelStore } from "../rightPanelStore";
import { WorkbenchReferenceKindIcon } from "./WorkbenchReferenceKindIcon";
import {
  listWorkbenchTicketReferences,
  type WorkbenchDescriptionLink,
} from "./workbenchReferences.logic";

export function WorkbenchThreadReferencesMenu({
  environmentId,
  threadId,
  references,
  descriptionLinks,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly references: ReadonlyArray<WorkbenchReference>;
  readonly descriptionLinks: ReadonlyArray<WorkbenchDescriptionLink>;
}) {
  const files = listWorkbenchTicketReferences(references, descriptionLinks).listed.filter(
    ({ parsed }) => parsed.kind === "file",
  );
  if (files.length === 0) return null;

  return (
    <WorkspaceBreadcrumbItem className="shrink-0">
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="compact"
                    aria-label={`References, ${files.length}`}
                  />
                }
              />
            }
          >
            <LibraryIcon />
            {files.length}
          </TooltipTrigger>
          <TooltipPopup>References</TooltipPopup>
        </Tooltip>
        <MenuPopup align="start">
          {files.map((item) => {
            const { parsed } = item;
            const title = item.source === "saved" ? item.reference.title : item.title;
            return (
              <Tooltip key={parsed.url}>
                <TooltipTrigger
                  render={
                    <MenuItem
                      aria-description={parsed.url}
                      onClick={() =>
                        useRightPanelStore
                          .getState()
                          .openFile(scopeThreadRef(environmentId, threadId), parsed.url)
                      }
                    />
                  }
                >
                  <WorkbenchReferenceKindIcon kind={parsed.kind} url={parsed.url} />
                  <MenuItemLabel>{title ?? parsed.label}</MenuItemLabel>
                </TooltipTrigger>
                <TooltipPopup>{parsed.url}</TooltipPopup>
              </Tooltip>
            );
          })}
        </MenuPopup>
      </Menu>
    </WorkspaceBreadcrumbItem>
  );
}
