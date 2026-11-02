import type { ProjectId, WorkbenchTicketWorkspace } from "@t3tools/contracts";
import {
  FolderGit2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  getWorkbenchTicketRepositoryStatusLabel,
  type WorkbenchRepositoryScope,
} from "./workbenchRepositoryScope";

type WorkspaceRepository = WorkbenchTicketWorkspace["repositories"][number];
type RepositoryOption = Pick<Project, "id" | "title">;

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

const getUnavailableRepositoryMessage = (hasLinkedRepositories: boolean) =>
  hasLinkedRepositories
    ? `${UNLINKED} Remove it, or link it again with Edit Workspace.`
    : "Link a repository to this Workbench Workspace before preparing this ticket.";

/**
 * Edits a ticket's repository scope as a visible list. `savedScope` is the persisted scope, so
 * pending additions and removals stay labelled until the caller saves.
 */
export function WorkbenchRepositoryScopeFields({
  projects,
  value,
  savedScope,
  workspace,
  onChange,
  disabled = false,
}: {
  readonly projects: readonly RepositoryOption[];
  readonly value: WorkbenchRepositoryScope;
  readonly savedScope: WorkbenchRepositoryScope;
  readonly workspace: WorkbenchTicketWorkspace | undefined;
  readonly onChange: (value: WorkbenchRepositoryScope) => void;
  readonly disabled?: boolean;
}) {
  const selectedIds = value.repositoryProjectIds;
  const removedIds = savedScope.repositoryProjectIds.filter((id) => !selectedIds.includes(id));
  const rowIds = [...selectedIds, ...removedIds];
  const candidates = projects.filter(
    (project) => !selectedIds.includes(project.id) && !removedIds.includes(project.id),
  );
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const focusRowIdRef = useRef<ProjectId | null>(null);
  // Removing or restoring a row replaces its action control, so focus moves to the row's current
  // control, or to Add repository when the row is gone.
  const getRowFocusTarget = (id: ProjectId) => {
    const fieldset = fieldsetRef.current;
    const row = [...(fieldset?.querySelectorAll<HTMLElement>("[data-repository-id]") ?? [])].find(
      (candidate) => candidate.dataset.repositoryId === id,
    );
    return (
      row?.querySelector<HTMLElement>("button") ??
      fieldset?.querySelector<HTMLElement>("[data-repository-add]") ??
      null
    );
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores DOM focus after adding/removing a repository replaces its action control
  useEffect(() => {
    const id = focusRowIdRef.current;
    if (id === null) return;
    focusRowIdRef.current = null;
    getRowFocusTarget(id)?.focus();
  });
  // An already open menu or picker outlives its disabled trigger, so mutations check here too.
  const change = (next: WorkbenchRepositoryScope, focusRowId: ProjectId | null = null) => {
    if (disabled) return;
    focusRowIdRef.current = focusRowId;
    onChange(next);
  };
  // Saved repositories keep their saved order so undoing a removal restores an unchanged scope.
  const include = (id: ProjectId, focusRowId: ProjectId | null = null) => {
    const ids = new Set([...selectedIds, id]);
    change(
      {
        ...value,
        repositoryProjectIds: [
          ...savedScope.repositoryProjectIds.filter((savedId) => ids.has(savedId)),
          ...[...ids].filter((selectedId) => !savedScope.repositoryProjectIds.includes(selectedId)),
        ],
      },
      focusRowId,
    );
  };
  const remove = (id: ProjectId) =>
    change(
      { ...value, repositoryProjectIds: selectedIds.filter((selectedId) => selectedId !== id) },
      id,
    );
  const rows = rowIds.map((id): RepositoryRow => {
    const isRemoved = removedIds.includes(id);
    return {
      id,
      title: projects.find((project) => project.id === id)?.title,
      change: isRemoved
        ? "removing"
        : savedScope.repositoryProjectIds.includes(id)
          ? null
          : "adding",
      workspaceRepository: workspace?.repositories.find(
        (repository) => repository.projectId === id,
      ),
    };
  });
  return (
    <fieldset ref={fieldsetRef} className="min-w-0 space-y-2">
      <legend className="sr-only">Workspace repositories</legend>
      <ul aria-label="Work area repositories" className="divide-y divide-border/50">
        {rows.map((row) => (
          <li
            key={row.id}
            data-repository-id={row.id}
            className="flex min-w-0 items-start gap-2 py-2 text-sm"
          >
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
                <RepositoryRowState row={row} showWorkspaceStatus={workspace !== undefined} />
              </div>
              <RepositoryRowMessages row={row} hasLinkedRepositories={projects.length > 0} />
            </div>
            <RepositoryRowAction
              row={row}
              disabled={disabled}
              onUndo={(id) => include(id, id)}
              getMenuFinalFocus={(id) => {
                // A callback overrides Base UI's check for focus that already moved elsewhere, so
                // a click on another control keeps its focus.
                const active = document.activeElement;
                const movedOutside =
                  active instanceof HTMLElement &&
                  active !== document.body &&
                  active.closest('[role="menu"]') === null;
                if (movedOutside || focusRowIdRef.current !== null) return false;
                return getRowFocusTarget(id) ?? true;
              }}
              onRemove={remove}
            />
          </li>
        ))}
      </ul>
      {projects.length > 0 ? (
        <WorkbenchAddRepositoryPicker
          candidates={candidates}
          disabled={disabled}
          onAdd={(id) => include(id)}
        />
      ) : null}
    </fieldset>
  );
}

type RepositoryRow = {
  readonly id: ProjectId;
  readonly title: string | undefined;
  readonly change: "adding" | "removing" | null;
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
            {getUnavailableRepositoryMessage(hasLinkedRepositories)}
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
  disabled,
  onUndo,
  getMenuFinalFocus,
  onRemove,
}: {
  readonly row: RepositoryRow;
  readonly disabled: boolean;
  readonly onUndo: (id: ProjectId) => void;
  readonly getMenuFinalFocus: (id: ProjectId) => HTMLElement | boolean;
  readonly onRemove: (id: ProjectId) => void;
}) {
  const label = getRepositoryRowLabel(row);
  if (row.change === "removing")
    return (
      <Button
        disabled={disabled}
        onClick={() => onUndo(row.id)}
        size="xs"
        type="button"
        variant="ghost"
      >
        Undo
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
      {/* The menu closes while its trigger unmounts, so it defers to the row's pending focus. */}
      <MenuPopup align="end" finalFocus={() => getMenuFinalFocus(row.id)}>
        <MenuItem disabled={disabled} onClick={() => onRemove(row.id)}>
          <XIcon />
          Remove from ticket
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
      <ComboboxTrigger
        aria-label="Add repository"
        data-repository-add=""
        render={<Button size="xs" type="button" variant="ghost" />}
      >
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
            <ComboboxItem key={project.id} value={project} disabled={disabled}>
              <FolderGit2Icon />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
