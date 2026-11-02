import type { ProjectId, WorkbenchTicketWorkspace } from "@t3tools/contracts";
import { FolderGit2Icon, PlusIcon } from "lucide-react";

import { ComposerControl, ComposerControlIcon } from "../components/chat/ComposerControl";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../components/ui/menu";
import type { Project } from "../types";
import { getWorkbenchTicketRepositoryStatusLabel } from "./workbenchRepositoryScope";

type RepositoryOption = Pick<Project, "id" | "title">;

export const getWorkbenchRepositoryTitle = (
  projects: readonly RepositoryOption[],
  id: ProjectId | null,
) => projects.find((project) => project.id === id)?.title ?? "Repository unavailable";

/**
 * Chooses the repository a new Thread works in: one of the Ticket's repositories, or a Workspace
 * repository the Ticket does not link yet, which the caller links when the Thread is created.
 */
export function WorkbenchThreadRepositoryPicker({
  ticketRepositoryIds,
  projects,
  workspace,
  value,
  disabled,
  onChange,
}: {
  readonly ticketRepositoryIds: readonly ProjectId[];
  /** The Workspace's linked repositories. */
  readonly projects: readonly RepositoryOption[];
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly value: ProjectId | null;
  readonly disabled: boolean;
  readonly onChange: (id: ProjectId) => void;
}) {
  const candidates = projects.filter((project) => !ticketRepositoryIds.includes(project.id));
  const title = getWorkbenchRepositoryTitle(projects, value);
  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl aria-label={`Thread repository: ${title}`} disabled={disabled} />}
      >
        <ComposerControlIcon icon={FolderGit2Icon} />
        <span data-composer-control-label>{title}</span>
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuGroupLabel>Ticket repositories</MenuGroupLabel>
          <MenuRadioGroup value={value} onValueChange={(id: ProjectId) => onChange(id)}>
            {ticketRepositoryIds.map((id) => {
              const checkout = workspace?.repositories.find(
                (repository) => repository.projectId === id,
              );
              return (
                <MenuRadioItem
                  key={id}
                  value={id}
                  closeOnClick
                  disabled={disabled || !projects.some((project) => project.id === id)}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <FolderGit2Icon aria-hidden className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {getWorkbenchRepositoryTitle(projects, id)}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {getWorkbenchTicketRepositoryStatusLabel(checkout) ?? "Prepared"}
                    </span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuGroup>
        {candidates.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger disabled={disabled}>
                <PlusIcon />
                Add repository
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuGroup>
                  <MenuGroupLabel>Workspace repositories</MenuGroupLabel>
                  {candidates.map((project) => (
                    <MenuItem
                      key={project.id}
                      disabled={disabled}
                      onClick={() => onChange(project.id)}
                    >
                      <FolderGit2Icon />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{project.title}</span>
                        <span className="text-muted-foreground/80 text-xs">
                          Links to this ticket and prepares a worktree
                        </span>
                      </span>
                    </MenuItem>
                  ))}
                </MenuGroup>
              </MenuSubPopup>
            </MenuSub>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
