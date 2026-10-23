import type { ProjectId, WorkbenchTicketWorkspace } from "@t3tools/contracts";
import {
  FolderGit2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  StarIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import type { Project } from "../types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../components/ui/combobox";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import type { WorkbenchRepositoryScope } from "./workbenchRepositoryScope";

type WorkspaceRepository = WorkbenchTicketWorkspace["repositories"][number];
type RepositoryOption = Pick<Project, "id" | "title">;

const getWorkbenchTicketRepositoryStatusLabel = (repository: WorkspaceRepository | undefined) => {
  switch (repository?.status) {
    case "failed":
      return "Preparation failed";
    case "pending":
      return "Pending preparation";
    case "released":
      return "Released";
    case "ready":
      return null;
    default:
      return "Not prepared";
  }
};

export function WorkbenchTicketRepositoryStatus({
  repository,
}: {
  readonly repository: WorkspaceRepository | undefined;
}) {
  const label = getWorkbenchTicketRepositoryStatusLabel(repository);
  if (label === null) return null;
  return (
    <Badge size="sm" variant={repository?.status === "failed" ? "warning" : "outline"}>
      {label}
    </Badge>
  );
}

const UNLINKED = "No longer linked to this Workspace.";

const getUnavailableRepositoryMessage = ({
  isPrimary,
  isLocked,
  hasLinkedRepositories,
}: {
  readonly isPrimary: boolean;
  readonly isLocked: boolean;
  readonly hasLinkedRepositories: boolean;
}) => {
  if (!hasLinkedRepositories)
    return "Link a repository to this Workbench Workspace before preparing this ticket.";
  if (isLocked) return `${UNLINKED} Link it again with Edit Workspace.`;
  if (isPrimary)
    return `${UNLINKED} Make another repository primary, or link it again with Edit Workspace.`;
  return `${UNLINKED} Remove it, or link it again with Edit Workspace.`;
};

/**
 * Edits a ticket's repository scope as a visible list. `savedScope` is the persisted scope, so
 * pending additions and removals stay labelled until the caller saves. With `lockedScope`, its
 * repositories and the primary are fixed and only new repositories can be added or removed.
 */
export function WorkbenchRepositoryScopeFields({
  projects,
  value,
  savedScope,
  workspace,
  onChange,
  disabled = false,
  lockedScope,
}: {
  readonly projects: readonly RepositoryOption[];
  readonly value: WorkbenchRepositoryScope;
  readonly savedScope: WorkbenchRepositoryScope;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly onChange: (value: WorkbenchRepositoryScope) => void;
  readonly disabled?: boolean;
  readonly lockedScope?: WorkbenchRepositoryScope | undefined;
}) {
  const selectedIds = value.repositoryProjectIds;
  const removedIds = savedScope.repositoryProjectIds.filter((id) => !selectedIds.includes(id));
  const rowIds = [
    value.primaryT3ProjectId,
    ...selectedIds.filter((id) => id !== value.primaryT3ProjectId),
    ...removedIds,
  ];
  const candidates = projects.filter(
    (project) => !selectedIds.includes(project.id) && !removedIds.includes(project.id),
  );
  // Saved repositories keep their saved order so undoing a removal restores an unchanged scope.
  const include = (id: ProjectId) => {
    const ids = new Set([...selectedIds, id]);
    onChange({
      ...value,
      repositoryProjectIds: [
        ...savedScope.repositoryProjectIds.filter((savedId) => ids.has(savedId)),
        ...[...ids].filter((selectedId) => !savedScope.repositoryProjectIds.includes(selectedId)),
      ],
    });
  };
  const remove = (id: ProjectId) =>
    onChange({
      ...value,
      repositoryProjectIds: selectedIds.filter((selectedId) => selectedId !== id),
    });
  const primaryTitle =
    projects.find((project) => project.id === value.primaryT3ProjectId)?.title ??
    "The current primary";
  const rows = rowIds.map((id): RepositoryRow => {
    const isRemoved = removedIds.includes(id);
    return {
      id,
      title: projects.find((project) => project.id === id)?.title,
      isPrimary: id === value.primaryT3ProjectId,
      change: isRemoved
        ? "removing"
        : savedScope.repositoryProjectIds.includes(id)
          ? null
          : "adding",
      isLocked: lockedScope?.repositoryProjectIds.includes(id) ?? false,
      workspaceRepository: workspace?.repositories.find(
        (repository) => repository.projectId === id,
      ),
    };
  });
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="sr-only">Workspace repositories</legend>
      <ul aria-label="Work area repositories" className="divide-y divide-border/50">
        {rows.map((row) => (
          <li key={row.id} className="flex min-w-0 items-start gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {row.title ? (
                  <FolderGit2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
                )}
                <span
                  className={
                    row.change === "removing"
                      ? "break-words font-medium text-muted-foreground line-through [overflow-wrap:anywhere]"
                      : "break-words font-medium [overflow-wrap:anywhere]"
                  }
                >
                  {getRepositoryRowLabel(row)}
                </span>
                {row.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                <RepositoryRowState row={row} showWorkspaceStatus={workspace !== undefined} />
              </div>
              <RepositoryRowMessages row={row} hasLinkedRepositories={projects.length > 0} />
            </div>
            <RepositoryRowAction
              row={row}
              locked={lockedScope !== undefined}
              primaryTitle={primaryTitle}
              disabled={disabled}
              onInclude={include}
              onRemove={remove}
              onMakePrimary={(id) => onChange({ ...value, primaryT3ProjectId: id })}
            />
          </li>
        ))}
      </ul>
      {projects.length > 0 ? (
        <WorkbenchAddRepositoryPicker candidates={candidates} disabled={disabled} onAdd={include} />
      ) : null}
      {lockedScope ? (
        <p className="text-xs text-muted-foreground">
          Add repositories here. To change the primary or remove a prepared repository, edit the
          ticket’s Work area.
        </p>
      ) : null}
    </fieldset>
  );
}

type RepositoryRow = {
  readonly id: ProjectId;
  readonly title: string | undefined;
  readonly isPrimary: boolean;
  readonly change: "adding" | "removing" | null;
  readonly isLocked: boolean;
  readonly workspaceRepository: WorkspaceRepository | undefined;
};

const getRepositoryRowLabel = (row: RepositoryRow) => row.title ?? "Repository unavailable";

function RepositoryRowState({
  row,
  showWorkspaceStatus,
}: {
  readonly row: RepositoryRow;
  readonly showWorkspaceStatus: boolean;
}) {
  if (row.change === "removing")
    return (
      <Badge size="sm" variant="secondary">
        Removing
      </Badge>
    );
  if (row.change === "adding")
    return (
      <Badge size="sm" variant="info">
        Adding
      </Badge>
    );
  if (!showWorkspaceStatus) return null;
  if (row.isLocked && row.workspaceRepository?.status === "ready")
    return <span className="text-xs text-muted-foreground">Prepared</span>;
  return <WorkbenchTicketRepositoryStatus repository={row.workspaceRepository} />;
}

function RepositoryRowMessages({
  row,
  hasLinkedRepositories,
}: {
  readonly row: RepositoryRow;
  readonly hasLinkedRepositories: boolean;
}) {
  if (row.change === "removing") return null;
  const errorMessage = row.workspaceRepository?.errorMessage;
  return (
    <>
      {row.title === undefined ? (
        <>
          <p className="ps-5.5 font-mono text-xs break-all text-muted-foreground">{row.id}</p>
          <p className="ps-5.5 text-xs text-destructive" role="alert">
            {getUnavailableRepositoryMessage({
              isPrimary: row.isPrimary,
              isLocked: row.isLocked,
              hasLinkedRepositories,
            })}
          </p>
        </>
      ) : null}
      {errorMessage ? (
        <p className="ps-5.5 text-xs break-words text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}

function RepositoryRowAction({
  row,
  locked,
  primaryTitle,
  disabled,
  onInclude,
  onRemove,
  onMakePrimary,
}: {
  readonly row: RepositoryRow;
  readonly locked: boolean;
  readonly primaryTitle: string;
  readonly disabled: boolean;
  readonly onInclude: (id: ProjectId) => void;
  readonly onRemove: (id: ProjectId) => void;
  readonly onMakePrimary: (id: ProjectId) => void;
}) {
  const label = getRepositoryRowLabel(row);
  if (row.change === "removing")
    return (
      <Button
        disabled={disabled}
        onClick={() => onInclude(row.id)}
        size="xs"
        type="button"
        variant="ghost"
      >
        Undo
      </Button>
    );
  if (locked)
    return row.isLocked ? null : (
      <Button
        aria-label={`Remove ${label}`}
        disabled={disabled}
        onClick={() => onRemove(row.id)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
    );
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Actions for ${label}`}
            disabled={disabled}
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {row.isPrimary ? null : (
          <>
            <MenuItem disabled={row.title === undefined} onClick={() => onMakePrimary(row.id)}>
              <StarIcon />
              <span className="flex flex-col">
                Make primary
                <span className="text-xs text-muted-foreground">
                  {primaryTitle} stays as an additional repository
                </span>
              </span>
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem disabled={row.isPrimary} onClick={() => onRemove(row.id)}>
          <XIcon />
          <span className="flex flex-col">
            Remove from ticket
            {row.isPrimary ? (
              <span className="text-xs text-muted-foreground">
                Make another repository primary first
              </span>
            ) : null}
          </span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function WorkbenchAddRepositoryPicker({
  candidates,
  disabled,
  onAdd,
}: {
  readonly candidates: readonly RepositoryOption[];
  readonly disabled: boolean;
  readonly onAdd: (id: ProjectId) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filteredItems = needle
    ? candidates.filter((project) => project.title.toLowerCase().includes(needle))
    : candidates;
  return (
    <Combobox<RepositoryOption>
      items={candidates}
      filteredItems={filteredItems}
      autoHighlight
      itemToStringLabel={(project) => project.title}
      isItemEqualToValue={(a, b) => a.id === b.id}
      value={null}
      disabled={disabled}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      onValueChange={(project) => {
        if (project) onAdd(project.id);
      }}
    >
      <ComboboxTrigger render={<Button size="xs" type="button" variant="ghost" />}>
        <PlusIcon />
        Add repository
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="w-72">
        <ComboboxSearchInput
          aria-label="Search repositories"
          placeholder="Search repositories"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>
          {candidates.length === 0
            ? "All linked repositories are already added."
            : "No repositories match."}
        </ComboboxEmpty>
        <ComboboxList>
          {(project: RepositoryOption) => (
            <ComboboxItem key={project.id} value={project}>
              <FolderGit2Icon />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
