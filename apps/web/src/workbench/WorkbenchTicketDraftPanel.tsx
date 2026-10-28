import type {
  ProjectId,
  WorkbenchEpic,
  WorkbenchEpicId,
  WorkbenchTicketDraftFields,
  WorkbenchTicketKind,
} from "@t3tools/contracts";
import type { Dispatch, SetStateAction } from "react";

import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { Project } from "../types";
import {
  WorkbenchCreateTicketEpic,
  WorkbenchCreateTicketKind,
  WorkbenchCreateTicketRepositories,
  WorkbenchTicketDescriptionEditor,
  getWorkbenchCreateTicketRepositories,
} from "./WorkbenchForms";

interface DraftFieldContext {
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
}

const getCreateBlocker = ({
  title,
  hasRepository,
}: {
  readonly title: string;
  readonly hasRepository: boolean;
}): string | null => {
  if (title.trim().length === 0) return "Add a title to create the ticket.";
  if (!hasRepository) return "Select a repository to create the ticket.";
  return null;
};

/**
 * Applies the manual form's epic and repository defaults to stored fields.
 * `fields` keeps only what the person chose, so the assistant never reads a default as a
 * decision; `effectiveFields` is what Create ticket sends. `blocker` explains a disabled
 * Create ticket.
 */
export const getTicketDraftCreateState = ({
  fields,
  linkedProjects,
  epics,
}: DraftFieldContext & { readonly fields: WorkbenchTicketDraftFields }) => {
  const selectedEpicId = epics.some((epic) => epic.id === fields.epicId) ? fields.epicId : null;
  const repositories = getWorkbenchCreateTicketRepositories({
    linkedProjects,
    repositoryProjectIds: fields.repositoryProjectIds,
    primaryProjectId: fields.primaryT3ProjectId,
  });
  const blocker = getCreateBlocker({
    title: fields.title,
    hasRepository: repositories.selectedProjectId !== null,
  });
  const effectiveFields: WorkbenchTicketDraftFields = {
    ...fields,
    epicId: selectedEpicId,
    repositoryProjectIds: repositories.selectedRepositoryProjectIds,
    primaryT3ProjectId: repositories.selectedProjectId,
  };
  return { selectedEpicId, repositories, blocker, effectiveFields };
};

/** Adapts a patch callback to the `Dispatch<SetStateAction>` setters the manual form's fields expect. */
const asSetter =
  <Value,>(current: Value, set: (value: Value) => void): Dispatch<SetStateAction<Value>> =>
  (action) =>
    set(typeof action === "function" ? (action as (previous: Value) => Value)(current) : action);

export function WorkbenchTicketDraftFieldsForm({
  fields,
  disabled,
  updatedBy,
  onChange,
  onCreateEpic,
  ...context
}: DraftFieldContext & {
  readonly fields: WorkbenchTicketDraftFields;
  readonly disabled: boolean;
  /** The agent Thread that last wrote the title or brief, if one did. */
  readonly updatedBy: string | null;
  readonly onChange: (patch: Partial<WorkbenchTicketDraftFields>) => void;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
}) {
  const { selectedEpicId, repositories } = getTicketDraftCreateState({ fields, ...context });
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="workbench-draft-title">Title</Label>
        <Input
          id="workbench-draft-title"
          placeholder="What needs doing?"
          value={fields.title}
          onChange={(event) => onChange({ title: event.currentTarget.value })}
        />
      </div>
      <WorkbenchTicketDescriptionEditor
        id="workbench-draft-description"
        markdown={fields.markdown}
        jira={false}
        updatedBy={updatedBy}
        onChange={(markdown) => onChange({ markdown })}
      />
      <WorkbenchCreateTicketKind
        kind={fields.kind}
        markdown={fields.markdown}
        setKind={asSetter<WorkbenchTicketKind>(fields.kind, (kind) => onChange({ kind }))}
        setMarkdown={asSetter(fields.markdown, (markdown) => onChange({ markdown }))}
      />
      <WorkbenchCreateTicketEpic
        onCreateEpic={onCreateEpic}
        epics={context.epics}
        pending={disabled}
        epicId={selectedEpicId}
        setEpicId={asSetter(selectedEpicId, (epicId) => onChange({ epicId }))}
      />
      <WorkbenchCreateTicketRepositories
        linkedProjects={context.linkedProjects}
        selectedRepositoryProjectIds={repositories.selectedRepositoryProjectIds}
        selectedProjectId={repositories.selectedProjectId}
        setRepositoryProjectIds={asSetter<ReadonlyArray<ProjectId>>(
          repositories.selectedRepositoryProjectIds,
          (ids) => onChange({ repositoryProjectIds: ids }),
        )}
        setPrimaryProjectId={asSetter(repositories.selectedProjectId, (id) =>
          onChange({ primaryT3ProjectId: id }),
        )}
      />
    </fieldset>
  );
}
