import type {
  ProjectId,
  WorkbenchEpic,
  WorkbenchEpicId,
  WorkbenchJiraBinding,
  WorkbenchTicketDraftFields,
  WorkbenchTicketKind,
} from "@t3tools/contracts";
import type { Dispatch, SetStateAction } from "react";

import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { Project } from "../types";
import {
  WorkbenchCreateTicketDestination,
  WorkbenchCreateTicketEpic,
  WorkbenchCreateTicketKind,
  WorkbenchCreateTicketRepositories,
  WorkbenchTicketDescriptionEditor,
  getWorkbenchCreateTicketDestination,
  getWorkbenchCreateTicketJiraPresentation,
  getWorkbenchCreateTicketRepositories,
} from "./WorkbenchForms";

interface DraftFieldContext {
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly jiraEpics: ReadonlyArray<WorkbenchEpic>;
  readonly jiraBinding: WorkbenchJiraBinding | null;
  readonly localOnlySupported: boolean;
  readonly jiraOwnershipKnown: boolean;
}

const getCreateBlocker = ({
  title,
  jiraOwnershipKnown,
  localOnlyUnavailable,
  hasRepository,
  creationBinding,
  hasSprint,
}: {
  readonly title: string;
  readonly jiraOwnershipKnown: boolean;
  readonly localOnlyUnavailable: boolean;
  readonly hasRepository: boolean;
  readonly creationBinding: WorkbenchJiraBinding | null;
  readonly hasSprint: boolean;
}): string | null => {
  if (!jiraOwnershipKnown) return "Checking Jira connection details.";
  if (localOnlyUnavailable) return "Update this environment before creating local-only tickets.";
  if (title.trim().length === 0) return "Add a title to create the ticket.";
  if (!hasRepository) return "Select a repository to create the ticket.";
  if (creationBinding && !creationBinding.active) {
    return "Resume the Jira connection before creating a ticket.";
  }
  if (creationBinding && !hasSprint) return "Select a Jira sprint to create the ticket.";
  return null;
};

/**
 * Applies the manual form's destination, repository, and sprint defaults to stored fields.
 * `fields` keeps only what the person chose, so the assistant never reads a default as a
 * decision; `effectiveFields` is what Create ticket sends. `blocker` explains a disabled
 * Create ticket.
 */
export const getTicketDraftCreateState = ({
  fields,
  linkedProjects,
  epics,
  jiraEpics,
  jiraBinding,
  localOnlySupported,
  jiraOwnershipKnown,
}: DraftFieldContext & { readonly fields: WorkbenchTicketDraftFields }) => {
  const destination = getWorkbenchCreateTicketDestination({
    localOnly: fields.localOnly,
    localOnlySupported,
    jiraBinding,
    epics,
    jiraEpics,
    epicId: fields.epicId,
  });
  const repositories = getWorkbenchCreateTicketRepositories({
    linkedProjects,
    repositoryProjectIds: fields.repositoryProjectIds,
    primaryProjectId: fields.primaryT3ProjectId,
  });
  const jira = getWorkbenchCreateTicketJiraPresentation({
    jiraBinding: destination.creationBinding,
    jiraSprintId: fields.jiraSprintId,
    pending: false,
  });
  const { creationBinding } = destination;
  const blocker = getCreateBlocker({
    title: fields.title,
    jiraOwnershipKnown,
    localOnlyUnavailable: destination.localOnlyUnavailable,
    hasRepository: repositories.selectedProjectId !== null,
    creationBinding,
    hasSprint: jira.selectedSprintId !== undefined,
  });
  const effectiveFields: WorkbenchTicketDraftFields = {
    ...fields,
    epicId: destination.selectedEpicId,
    repositoryProjectIds: repositories.selectedRepositoryProjectIds,
    primaryT3ProjectId: repositories.selectedProjectId,
    jiraSprintId: jira.selectedSprintId ?? null,
  };
  return {
    destination,
    repositories,
    jira,
    blocker,
    effectiveFields,
    createsInJira: creationBinding !== null,
  };
};

/** Adapts a patch callback to the `Dispatch<SetStateAction>` setters the manual form's fields expect. */
const asSetter =
  <Value,>(current: Value, set: (value: Value) => void): Dispatch<SetStateAction<Value>> =>
  (action) =>
    set(typeof action === "function" ? (action as (previous: Value) => Value)(current) : action);

export function WorkbenchTicketDraftFieldsForm({
  fields,
  disabled,
  onChange,
  onCreateEpic,
  ...context
}: DraftFieldContext & {
  readonly fields: WorkbenchTicketDraftFields;
  readonly disabled: boolean;
  readonly onChange: (patch: Partial<WorkbenchTicketDraftFields>) => void;
  readonly onCreateEpic: (onCreated: (epicId: WorkbenchEpicId) => void) => void;
}) {
  const { destination, repositories, jira } = getTicketDraftCreateState({ fields, ...context });
  const { creationBinding } = destination;
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
        onChange={(markdown) => onChange({ markdown })}
      />
      <WorkbenchCreateTicketKind
        kind={fields.kind}
        markdown={fields.markdown}
        setKind={asSetter<WorkbenchTicketKind>(fields.kind, (kind) => onChange({ kind }))}
        setMarkdown={asSetter(fields.markdown, (markdown) => onChange({ markdown }))}
      />
      <WorkbenchCreateTicketEpic
        jiraBinding={creationBinding}
        onCreateEpic={onCreateEpic}
        epics={destination.availableEpics}
        pending={disabled}
        epicId={destination.selectedEpicId}
        setEpicId={asSetter(destination.selectedEpicId, (epicId) => onChange({ epicId }))}
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
      <WorkbenchCreateTicketDestination
        jiraBinding={context.jiraBinding}
        localOnlySupported={context.localOnlySupported}
        localOnly={fields.localOnly}
        pending={disabled}
        setLocalOnly={(localOnly) => onChange({ localOnly })}
        sprintSelection={{
          jiraSprints: jira.jiraSprints,
          selectedSprintId: jira.selectedSprintId,
          setJiraSprintId: asSetter(fields.jiraSprintId, (jiraSprintId) =>
            onChange({ jiraSprintId }),
          ),
        }}
      />
    </fieldset>
  );
}
