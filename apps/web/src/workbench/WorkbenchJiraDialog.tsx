import { WorkbenchRepositorySelectOptions } from "./WorkbenchRepositorySelectOptions";
import {
  ProjectId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraBoard,
  type WorkbenchJiraBoardConfiguration,
  type WorkbenchJiraConnection,
  WorkbenchJiraConnectionId,
  type WorkbenchJiraLocalEpicMigrationItem,
  type WorkbenchJiraLocalTicketMigrationItem,
  type WorkbenchJiraProject,
  type WorkbenchJiraSprint,
  type WorkbenchJiraStatusMapping,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon, LinkIcon } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Radio, RadioGroup } from "../components/ui/radio-group";
import type { Project } from "../types";
import { WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import {
  getWorkbenchJiraBindingSprints,
  reconcileWorkbenchJiraStatusMappings,
  suggestWorkbenchJiraStatusMappings,
} from "./workbenchJira.logic";

type JiraSetupStep = "existing" | "site" | "project" | "board" | "configure";

export interface WorkbenchJiraCreateDraft {
  readonly connectionId: WorkbenchJiraConnectionId;
  readonly jiraProject: WorkbenchJiraProject;
  readonly board: WorkbenchJiraBoard;
  readonly sprints: ReadonlyArray<WorkbenchJiraSprint>;
  readonly defaultPrimaryT3ProjectId: ProjectId;
  readonly defaultRepositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
  readonly followActiveSprint: boolean;
  readonly boardMode: "mapped" | "mirror_jira";
  readonly localDataAction: "publish" | "delete" | "none";
  readonly localTickets: ReadonlyArray<WorkbenchJiraLocalTicketMigrationItem>;
  readonly localEpics: ReadonlyArray<WorkbenchJiraLocalEpicMigrationItem>;
}

export interface WorkbenchJiraUpdateDraft {
  readonly binding: WorkbenchJiraBinding;
  readonly sprints: ReadonlyArray<WorkbenchJiraSprint>;
  readonly defaultPrimaryT3ProjectId: ProjectId;
  readonly defaultRepositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
  readonly followActiveSprint: boolean;
  readonly boardMode: "mapped" | "mirror_jira";
  readonly localDataAction: "publish" | "delete" | "none";
  readonly localTickets: ReadonlyArray<WorkbenchJiraLocalTicketMigrationItem>;
  readonly localEpics: ReadonlyArray<WorkbenchJiraLocalEpicMigrationItem>;
}

const formatLastSynced = (value: string | null) =>
  value === null ? "Not synced yet" : `Last synced ${new Date(value).toLocaleString()}`;

export function WorkbenchJiraDialog({
  open,
  connections,
  existingBinding,
  linkedProjects,
  localTickets,
  localEpics,
  pending,
  error,
  onOpenChange,
  onBeginAuth,
  onListProjects,
  onListBoards,
  onListSprints,
  onGetBoardConfiguration,
  onCreate,
  onUpdate,
  onSetActive,
}: {
  readonly open: boolean;
  readonly connections: ReadonlyArray<WorkbenchJiraConnection>;
  readonly existingBinding: WorkbenchJiraBinding | null;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly localTickets: ReadonlyArray<WorkbenchJiraLocalTicketMigrationItem>;
  readonly localEpics: ReadonlyArray<WorkbenchJiraLocalEpicMigrationItem>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onBeginAuth: () => Promise<void>;
  readonly onListProjects: (
    connectionId: WorkbenchJiraConnectionId,
  ) => Promise<ReadonlyArray<WorkbenchJiraProject> | null>;
  readonly onListBoards: (
    connectionId: WorkbenchJiraConnectionId,
    projectKeyOrId: string,
  ) => Promise<ReadonlyArray<WorkbenchJiraBoard> | null>;
  readonly onListSprints: (
    connectionId: WorkbenchJiraConnectionId,
    boardId: number,
  ) => Promise<ReadonlyArray<WorkbenchJiraSprint> | null>;
  readonly onGetBoardConfiguration: (
    connectionId: WorkbenchJiraConnectionId,
    boardId: number,
  ) => Promise<WorkbenchJiraBoardConfiguration | null>;
  readonly onCreate: (draft: WorkbenchJiraCreateDraft) => Promise<boolean>;
  readonly onUpdate: (draft: WorkbenchJiraUpdateDraft) => Promise<boolean>;
  readonly onSetActive: (binding: WorkbenchJiraBinding, active: boolean) => Promise<boolean>;
}) {
  return (
    <JiraDialogController
      context={{ existingBinding, connections, linkedProjects, localTickets, localEpics }}
      presentation={{ open, onOpenChange, pending, error }}
      discovery={{
        onBeginAuth,
        onListProjects,
        onListBoards,
        onListSprints,
        onGetBoardConfiguration,
      }}
      commands={{ onCreate, onUpdate, onSetActive }}
    />
  );
}

function JiraConfigureFields({
  sprintSelection,
  localData,
  repositoryScope,
  statusConfiguration,
  actions,
}: {
  sprintSelection: Pick<
    JiraConfigureFieldProps,
    | "followActiveSprint"
    | "setFollowActiveSprint"
    | "setSprintIds"
    | "sprints"
    | "selectableSprints"
    | "selectedSprints"
    | "sprintIds"
  >;
  localData: Pick<
    JiraConfigureFieldProps,
    | "localDataCount"
    | "localTicketCount"
    | "localEpicCount"
    | "existingBinding"
    | "localDataAction"
    | "setLocalDataAction"
  >;
  repositoryScope: Pick<
    JiraConfigureFieldProps,
    | "linkedProjects"
    | "selectedRepositoryProjectIds"
    | "setRepositoryProjectIds"
    | "selectedPrimaryProjectId"
    | "setPrimaryProjectId"
  >;
  statusConfiguration: Pick<
    JiraConfigureFieldProps,
    "boardMode" | "setBoardMode" | "configuration" | "statusMappings" | "updateStatusMapping"
  >;
  actions: Pick<
    JiraConfigureFieldProps,
    "saving" | "setStep" | "pending" | "jiraStatusCount" | "resolvedLocalDataAction" | "save"
  >;
}) {
  const {
    followActiveSprint,
    setFollowActiveSprint,
    setSprintIds,
    sprints,
    selectableSprints,
    selectedSprints,
    sprintIds,
  } = sprintSelection;
  const {
    localDataCount,
    localTicketCount,
    localEpicCount,
    existingBinding,
    localDataAction,
    setLocalDataAction,
  } = localData;
  const {
    linkedProjects,
    selectedRepositoryProjectIds,
    setRepositoryProjectIds,
    selectedPrimaryProjectId,
    setPrimaryProjectId,
  } = repositoryScope;
  const { boardMode, setBoardMode, configuration, statusMappings, updateStatusMapping } =
    statusConfiguration;
  const { saving, setStep, pending, jiraStatusCount, resolvedLocalDataAction, save } = actions;
  return (
    <div className="space-y-5">
      <JiraFollowSprintToggle
        followActiveSprint={followActiveSprint}
        setFollowActiveSprint={setFollowActiveSprint}
        setSprintIds={setSprintIds}
        sprints={sprints}
      />
      <p className="text-xs text-muted-foreground">
        Checks every five minutes while the server is running. Keeps the current board between
        sprints; asks you to choose when replacement sprints are ambiguous.
      </p>
      {localDataCount > 0 ? (
        <JiraLocalDataChoice
          localTicketCount={localTicketCount}
          localEpicCount={localEpicCount}
          existingBinding={existingBinding}
          localDataAction={localDataAction}
          setLocalDataAction={setLocalDataAction}
        />
      ) : null}
      <JiraSprintSelection
        followActiveSprint={followActiveSprint}
        selectableSprints={selectableSprints}
        selectedSprints={selectedSprints}
        setSprintIds={setSprintIds}
        sprintIds={sprintIds}
      />

      <JiraRepositoryScope
        linkedProjects={linkedProjects}
        selectedRepositoryProjectIds={selectedRepositoryProjectIds}
        setRepositoryProjectIds={setRepositoryProjectIds}
        selectedPrimaryProjectId={selectedPrimaryProjectId}
        setPrimaryProjectId={setPrimaryProjectId}
      />

      <JiraStatusMappings
        boardMode={boardMode}
        setBoardMode={setBoardMode}
        configuration={configuration}
        statusMappings={statusMappings}
        updateStatusMapping={updateStatusMapping}
      />

      {saving ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Saving the mirror and importing Jira tickets…
        </p>
      ) : null}

      <JiraConfigureActions
        setStep={setStep}
        existingBinding={existingBinding}
        pending={pending}
        saving={saving}
        selectedSprints={selectedSprints}
        selectedPrimaryProjectId={selectedPrimaryProjectId}
        selectedRepositoryProjectIds={selectedRepositoryProjectIds}
        statusMappings={statusMappings}
        jiraStatusCount={jiraStatusCount}
        resolvedLocalDataAction={resolvedLocalDataAction}
        save={save}
      />
    </div>
  );
}

type JiraConfigureFieldProps = {
  followActiveSprint: boolean;
  setFollowActiveSprint: Dispatch<SetStateAction<boolean>>;
  setSprintIds: Dispatch<SetStateAction<ReadonlyArray<number>>>;
  sprints: ReadonlyArray<WorkbenchJiraSprint>;
  localDataCount: number;
  localTicketCount: number;
  localEpicCount: number;
  existingBinding: WorkbenchJiraBinding | null;
  localDataAction: "publish" | "delete" | null;
  setLocalDataAction: Dispatch<SetStateAction<"publish" | "delete" | null>>;
  selectableSprints: ReadonlyArray<WorkbenchJiraSprint>;
  selectedSprints: ReadonlyArray<WorkbenchJiraSprint>;
  sprintIds: ReadonlyArray<number>;
  linkedProjects: ReadonlyArray<Project>;
  selectedRepositoryProjectIds: ReadonlyArray<ProjectId>;
  setRepositoryProjectIds: Dispatch<SetStateAction<ReadonlyArray<ProjectId>>>;
  selectedPrimaryProjectId: ProjectId | null;
  setPrimaryProjectId: Dispatch<SetStateAction<ProjectId | null>>;
  boardMode: "mapped" | "mirror_jira";
  setBoardMode: Dispatch<SetStateAction<"mapped" | "mirror_jira">>;
  configuration: WorkbenchJiraBoardConfiguration;
  statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
  updateStatusMapping: (jiraStatusId: string, workbenchStatus: WorkbenchTicketStatus) => void;
  saving: boolean;
  setStep: Dispatch<SetStateAction<JiraSetupStep>>;
  pending: boolean;
  jiraStatusCount: number;
  resolvedLocalDataAction: "publish" | "delete" | "none" | null;
  save: ({ allowDelete }?: { readonly allowDelete?: boolean }) => Promise<void>;
};

function JiraExistingBindingPanel({
  existingBinding,
  onOpenChange,
  pending,
  saving,
  onSetActive,
  loadBoardSetup,
}: {
  existingBinding: WorkbenchJiraBinding;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  saving: boolean;
  onSetActive: (binding: WorkbenchJiraBinding, active: boolean) => Promise<boolean>;
  loadBoardSetup: ({
    targetConnectionId,
    targetBoardId,
    existingMappings,
    targetSprintIds,
  }: {
    readonly targetConnectionId: WorkbenchJiraConnectionId;
    readonly targetBoardId: number;
    readonly existingMappings?: ReadonlyArray<WorkbenchJiraStatusMapping>;
    readonly targetSprintIds?: ReadonlyArray<number>;
  }) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/25 p-4">
        <div className="flex items-center gap-2">
          <LinkIcon className="size-4 text-muted-foreground" />
          <p className="font-medium">{existingBinding.jiraProjectName}</p>
          <Badge size="sm" variant="outline">
            {existingBinding.jiraProjectKey}
          </Badge>
          <Badge size="sm" variant={existingBinding.active ? "secondary" : "outline"}>
            {existingBinding.active ? "Active" : "Paused"}
          </Badge>
          {existingBinding.localMigrationPending === true ? (
            <Badge size="sm" variant="outline">
              Migration pending
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {existingBinding.boardName} ·{" "}
          {getWorkbenchJiraBindingSprints(existingBinding)
            .map((sprint) => sprint.name)
            .join(" · ")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatLastSynced(existingBinding.lastSyncedAt)}
          {existingBinding.followActiveSprint
            ? " · Following selected sprints"
            : " · Pinned sprints"}
        </p>
        {existingBinding.localMigrationPending === true ? (
          <p className="mt-2 text-xs text-warning-foreground" role="status">
            Finish the local data migration before importing Jira issues. Choose “Edit sprints and
            mappings” to resume it.
          </p>
        ) : null}
      </div>
      {existingBinding.lastSyncError ? (
        <p role="status" className="text-sm text-warning-foreground">
          {existingBinding.lastSyncError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => onOpenChange(false)} variant="outline">
          Close
        </Button>
        <Button
          disabled={pending || saving}
          onClick={() => void onSetActive(existingBinding, !existingBinding.active)}
          variant="outline"
        >
          {existingBinding.active ? "Pause mirror" : "Resume mirror"}
        </Button>
        <Button
          disabled={pending || saving}
          onClick={() =>
            void loadBoardSetup({
              targetConnectionId: existingBinding.connectionId,
              targetBoardId: existingBinding.boardId,
              existingMappings: existingBinding.statusMappings,
              targetSprintIds: getWorkbenchJiraBindingSprints(existingBinding).map(
                (sprint) => sprint.id,
              ),
            })
          }
        >
          Edit sprints and mappings
        </Button>
      </div>
    </div>
  );
}

function JiraSiteStep({
  connections,
  effectiveConnectionId,
  setConnectionId,
  pending,
  onBeginAuth,
  loadProjects,
}: {
  connections: ReadonlyArray<WorkbenchJiraConnection>;
  effectiveConnectionId: WorkbenchJiraConnectionId | null;
  setConnectionId: Dispatch<SetStateAction<WorkbenchJiraConnectionId | null>>;
  pending: boolean;
  onBeginAuth: () => Promise<void>;
  loadProjects: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      {connections.length > 0 ? (
        <div className="space-y-1.5">
          <Label>Jira site</Label>
          <Select
            value={effectiveConnectionId}
            onValueChange={(value) =>
              setConnectionId(value ? WorkbenchJiraConnectionId.make(value) : null)
            }
          >
            <SelectTrigger aria-label="Jira site">
              <SelectValue>
                {connections.find((connection) => connection.id === effectiveConnectionId)
                  ?.siteName ?? "Choose a site"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.siteName}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Authorize an Atlassian site before choosing a Jira board and its sprints.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={pending} onClick={() => void onBeginAuth()} variant="outline">
          <ExternalLinkIcon />{" "}
          {connections.length > 0 ? "Connect or reconnect Jira" : "Connect Atlassian"}
        </Button>
        {effectiveConnectionId ? (
          <Button disabled={pending} onClick={() => void loadProjects()}>
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function JiraProjectStep({
  jiraProjectId,
  setJiraProjectId,
  selectedProject,
  projects,
  setStep,
  pending,
  loadBoards,
}: {
  jiraProjectId: string | null;
  setJiraProjectId: Dispatch<SetStateAction<string | null>>;
  selectedProject: WorkbenchJiraProject | null;
  projects: ReadonlyArray<WorkbenchJiraProject>;
  setStep: Dispatch<SetStateAction<JiraSetupStep>>;
  pending: boolean;
  loadBoards: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Jira project</Label>
        <Select value={jiraProjectId} onValueChange={(value) => setJiraProjectId(value || null)}>
          <SelectTrigger aria-label="Jira project">
            <SelectValue>
              {selectedProject
                ? `${selectedProject.key} · ${selectedProject.name}`
                : "Choose a project"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.key} · {project.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Jira projects are available for this site.
        </p>
      ) : null}
      <div className="flex justify-between gap-2">
        <Button onClick={() => setStep("site")} variant="ghost">
          <ArrowLeftIcon /> Back
        </Button>
        <Button disabled={pending || !selectedProject} onClick={() => void loadBoards()}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function JiraBoardStep({
  boardId,
  setBoardId,
  selectedBoard,
  boards,
  setStep,
  pending,
  effectiveConnectionId,
  loadBoardSetup,
}: {
  boardId: number | null;
  setBoardId: Dispatch<SetStateAction<number | null>>;
  selectedBoard: WorkbenchJiraBoard | null;
  boards: ReadonlyArray<WorkbenchJiraBoard>;
  setStep: Dispatch<SetStateAction<JiraSetupStep>>;
  pending: boolean;
  effectiveConnectionId: WorkbenchJiraConnectionId | null;
  loadBoardSetup: ({
    targetConnectionId,
    targetBoardId,
    existingMappings,
    targetSprintIds,
  }: {
    readonly targetConnectionId: WorkbenchJiraConnectionId;
    readonly targetBoardId: number;
    readonly existingMappings?: ReadonlyArray<WorkbenchJiraStatusMapping>;
    readonly targetSprintIds?: ReadonlyArray<number>;
  }) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Jira board</Label>
        <Select
          value={boardId?.toString() ?? null}
          onValueChange={(value) => setBoardId(value ? Number(value) : null)}
        >
          <SelectTrigger aria-label="Jira board">
            <SelectValue>{selectedBoard?.name ?? "Choose a board"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {boards.map((board) => (
              <SelectItem key={board.id} value={String(board.id)}>
                {board.name} · {board.type}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Jira boards are available for this project.
        </p>
      ) : null}
      <div className="flex justify-between gap-2">
        <Button onClick={() => setStep("project")} variant="ghost">
          <ArrowLeftIcon /> Back
        </Button>
        <Button
          disabled={pending || !selectedBoard || !effectiveConnectionId}
          onClick={() =>
            effectiveConnectionId && selectedBoard
              ? void loadBoardSetup({
                  targetConnectionId: effectiveConnectionId,
                  targetBoardId: selectedBoard.id,
                })
              : undefined
          }
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

function JiraLocalDataChoice({
  localTicketCount,
  localEpicCount,
  existingBinding,
  localDataAction,
  setLocalDataAction,
}: {
  localTicketCount: number;
  localEpicCount: number;
  existingBinding: WorkbenchJiraBinding | null;
  localDataAction: "publish" | "delete" | null;
  setLocalDataAction: Dispatch<SetStateAction<"publish" | "delete" | null>>;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border/60 p-3">
      <legend className="px-1 text-sm font-medium">Existing local data</legend>
      <p className="text-xs text-muted-foreground">
        This workspace has {localTicketCount} local {localTicketCount === 1 ? "Ticket" : "Tickets"}
        {localEpicCount > 0
          ? ` and ${localEpicCount} local ${localEpicCount === 1 ? "Epic" : "Epics"}`
          : ""}
        . Choose what to do before importing Jira issues.
        {existingBinding?.localMigrationPending === true
          ? " A previous local data migration is still pending. Choose the same action to resume it before importing Jira issues."
          : existingBinding !== null
            ? " If a previous migration was interrupted, choose the same action to resume it."
            : ""}
      </p>
      <RadioGroup
        aria-label="Existing local data action"
        value={localDataAction}
        onValueChange={(value) => {
          if (value === "publish" || value === "delete") setLocalDataAction(value);
        }}
      >
        <label className="flex items-start gap-2 text-sm">
          <Radio value="publish" />
          <span>
            <span className="font-medium">Publish local data to Jira</span>
            <span className="block text-xs text-muted-foreground">
              Keep the existing Tickets and Epics, creating Jira issues in the selected sprint.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Radio value="delete" />
          <span>
            <span className="font-medium">Delete local data</span>
            <span className="block text-xs text-muted-foreground">
              Remove local Tickets and Epics before importing. Native Agent Threads are retained.
            </span>
          </span>
        </label>
      </RadioGroup>
    </fieldset>
  );
}

function JiraSprintSelection({
  followActiveSprint,
  selectableSprints,
  selectedSprints,
  setSprintIds,
  sprintIds,
}: {
  followActiveSprint: boolean;
  selectableSprints: ReadonlyArray<WorkbenchJiraSprint>;
  selectedSprints: ReadonlyArray<WorkbenchJiraSprint>;
  setSprintIds: Dispatch<SetStateAction<ReadonlyArray<number>>>;
  sprintIds: ReadonlyArray<number>;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {followActiveSprint ? "Current active sprints" : "Pinned sprints"}
      </legend>
      <p className="text-xs text-muted-foreground">
        Choose one, some, or all. Only your assigned issues from the selected sprints are mirrored,
        including issues from different Jira projects.
      </p>
      {selectableSprints.length > 0 ? (
        <div className="rounded-lg border border-border/60 p-3">
          <label className="flex items-center gap-2 border-b border-border/60 pb-2 text-sm font-medium">
            <Checkbox
              checked={selectedSprints.length === selectableSprints.length}
              indeterminate={
                selectedSprints.length > 0 && selectedSprints.length < selectableSprints.length
              }
              onCheckedChange={(checked) =>
                setSprintIds(checked ? selectableSprints.map((sprint) => sprint.id) : [])
              }
            />
            Select all
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {selectedSprints.length} selected
            </span>
          </label>
          <div className="max-h-48 space-y-2 overflow-y-auto pt-2">
            {selectableSprints.map((sprint) => (
              <label key={sprint.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={sprintIds.includes(sprint.id)}
                  onCheckedChange={(checked) =>
                    setSprintIds((current) =>
                      checked
                        ? [...current.filter((id) => id !== sprint.id), sprint.id]
                        : current.filter((id) => id !== sprint.id),
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  {sprint.name} <span className="text-muted-foreground">· {sprint.state}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-warning-foreground">
          {followActiveSprint
            ? "This Board has no active sprint. Start one in Jira, or turn off automatic following to select a future sprint."
            : "This Board has no active or future sprints to select."}
        </p>
      )}
      {selectableSprints.length > 0 && selectedSprints.length === 0 ? (
        <p className="text-xs text-muted-foreground">Select at least one sprint to continue.</p>
      ) : null}
    </fieldset>
  );
}

function JiraRepositoryScope({
  linkedProjects,
  selectedRepositoryProjectIds,
  setRepositoryProjectIds,
  selectedPrimaryProjectId,
  setPrimaryProjectId,
}: {
  linkedProjects: ReadonlyArray<Project>;
  selectedRepositoryProjectIds: ReadonlyArray<ProjectId>;
  setRepositoryProjectIds: Dispatch<SetStateAction<ReadonlyArray<ProjectId>>>;
  selectedPrimaryProjectId: ProjectId | null;
  setPrimaryProjectId: Dispatch<SetStateAction<ProjectId | null>>;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Default repository scope</legend>
      <p className="text-xs text-muted-foreground">
        Imported Tickets start with these repositories. Adjust each Ticket's repository scope before
        creating its Thread. Importing does not create worktrees.
      </p>
      <div className="space-y-1 rounded-lg border border-border p-1">
        {linkedProjects.map((project) => {
          const checked = selectedRepositoryProjectIds.includes(project.id);
          return (
            <label
              key={project.id}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={checked}
                disabled={checked && selectedRepositoryProjectIds.length === 1}
                onCheckedChange={(next) => {
                  const nextIds = next
                    ? [...selectedRepositoryProjectIds, project.id]
                    : selectedRepositoryProjectIds.filter((id) => id !== project.id);
                  setRepositoryProjectIds(nextIds);
                  if (
                    selectedPrimaryProjectId === null ||
                    !nextIds.includes(selectedPrimaryProjectId)
                  )
                    setPrimaryProjectId(nextIds[0] ?? null);
                }}
              />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
            </label>
          );
        })}
      </div>
      <Select
        value={selectedPrimaryProjectId}
        onValueChange={(value) => setPrimaryProjectId(value ? ProjectId.make(value) : null)}
      >
        <SelectTrigger aria-label="Default primary repository">
          <SelectValue>
            {linkedProjects.find((project) => project.id === selectedPrimaryProjectId)?.title ??
              "Choose a primary repository"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <WorkbenchRepositorySelectOptions
            projects={linkedProjects}
            selectedProjectIds={selectedRepositoryProjectIds}
          />
        </SelectPopup>
      </Select>
    </fieldset>
  );
}

function JiraStatusMappings({
  boardMode,
  setBoardMode,
  configuration,
  statusMappings,
  updateStatusMapping,
}: {
  boardMode: "mapped" | "mirror_jira";
  setBoardMode: Dispatch<SetStateAction<"mapped" | "mirror_jira">>;
  configuration: WorkbenchJiraBoardConfiguration;
  statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
  updateStatusMapping: (jiraStatusId: string, workbenchStatus: WorkbenchTicketStatus) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Ticket columns</legend>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={boardMode === "mirror_jira"}
          onCheckedChange={(checked) => setBoardMode(checked === true ? "mirror_jira" : "mapped")}
        />
        Mirror Jira states
      </label>
      <p className="text-xs text-muted-foreground">
        {boardMode === "mirror_jira"
          ? "Use Jira board column names and order. Agent activity stays a separate badge."
          : "Map Jira states to Todo, In Progress, or Done. Agent activity does not change Ticket status."}
      </p>
      {boardMode === "mapped" ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {configuration.columns.flatMap((column) =>
            column.statusIds.map((statusId) => {
              const mapping = statusMappings.find(
                (candidate) => candidate.jiraStatusId === statusId,
              );
              return (
                <div
                  key={statusId}
                  className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{column.name}</p>
                    <p className="truncate text-xs text-muted-foreground">Jira status {statusId}</p>
                  </div>
                  <Select
                    value={mapping?.workbenchStatus ?? null}
                    onValueChange={(value) => {
                      if (value === "todo" || value === "in_progress" || value === "done")
                        updateStatusMapping(statusId, value);
                    }}
                  >
                    <SelectTrigger aria-label={`Map Jira status ${statusId}`}>
                      <SelectValue>
                        {mapping
                          ? WORKBENCH_TICKET_STATUS_LABELS[mapping.workbenchStatus]
                          : "Choose status"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {(["todo", "in_progress", "done"] as const).map((status) => (
                        <SelectItem key={status} value={status}>
                          {WORKBENCH_TICKET_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              );
            }),
          )}
        </div>
      ) : (
        <p className="text-sm">{configuration.columns.map((column) => column.name).join(" → ")}</p>
      )}
    </fieldset>
  );
}

type JiraDialogProps = Parameters<typeof WorkbenchJiraDialog>[0];
function useJiraDialogState({
  existingBinding,
  connections,
  linkedProjects,
  localTickets,
  localEpics,
}: Pick<
  JiraDialogProps,
  "existingBinding" | "connections" | "linkedProjects" | "localTickets" | "localEpics"
>) {
  const projectSelection = useJiraProjectSelection({ existingBinding, connections });
  const sprintConfiguration = useJiraSprintConfiguration({ existingBinding });
  const repositorySelection = useJiraRepositorySelection({ existingBinding, linkedProjects });
  const migrationConfirmation = useJiraMigrationConfirmation({ localTickets, localEpics });
  return {
    ...projectSelection,
    ...sprintConfiguration,
    ...repositorySelection,
    ...migrationConfirmation,
  };
}

function useJiraProjectSelection({
  existingBinding,
  connections,
}: Pick<JiraDialogProps, "existingBinding" | "connections">) {
  const [step, setStep] = useState<JiraSetupStep>(existingBinding ? "existing" : "site");
  const [connectionId, setConnectionId] = useState<WorkbenchJiraConnectionId | null>(
    existingBinding?.connectionId ?? connections[0]?.id ?? null,
  );
  const [projects, setProjects] = useState<ReadonlyArray<WorkbenchJiraProject>>([]);
  const [jiraProjectId, setJiraProjectId] = useState<string | null>(null);
  const [boards, setBoards] = useState<ReadonlyArray<WorkbenchJiraBoard>>([]);
  const [boardId, setBoardId] = useState<number | null>(null);

  return {
    step,
    setStep,
    connectionId,
    setConnectionId,
    projects,
    setProjects,
    jiraProjectId,
    setJiraProjectId,
    boards,
    setBoards,
    boardId,
    setBoardId,
  };
}

function useJiraSprintConfiguration({ existingBinding }: Pick<JiraDialogProps, "existingBinding">) {
  const [sprints, setSprints] = useState<ReadonlyArray<WorkbenchJiraSprint>>([]);
  const [followActiveSprint, setFollowActiveSprint] = useState(
    existingBinding?.followActiveSprint ?? true,
  );
  const [boardMode, setBoardMode] = useState<"mapped" | "mirror_jira">(
    existingBinding?.boardMode ?? "mapped",
  );
  const [sprintIds, setSprintIds] = useState<ReadonlyArray<number>>(
    existingBinding
      ? getWorkbenchJiraBindingSprints(existingBinding).map((sprint) => sprint.id)
      : [],
  );
  const [configuration, setConfiguration] = useState<WorkbenchJiraBoardConfiguration | null>(null);
  const [statusMappings, setStatusMappings] = useState<ReadonlyArray<WorkbenchJiraStatusMapping>>(
    existingBinding?.statusMappings ?? [],
  );

  return {
    sprints,
    setSprints,
    followActiveSprint,
    setFollowActiveSprint,
    boardMode,
    setBoardMode,
    sprintIds,
    setSprintIds,
    configuration,
    setConfiguration,
    statusMappings,
    setStatusMappings,
  };
}

function useJiraRepositorySelection({
  existingBinding,
  linkedProjects,
}: Pick<JiraDialogProps, "existingBinding" | "linkedProjects">) {
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>(
    existingBinding?.defaultRepositoryProjectIds ??
      (linkedProjects[0] ? [linkedProjects[0].id] : []),
  );
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(
    existingBinding?.defaultPrimaryT3ProjectId ?? linkedProjects[0]?.id ?? null,
  );

  return { repositoryProjectIds, setRepositoryProjectIds, primaryProjectId, setPrimaryProjectId };
}

function useJiraMigrationConfirmation({
  localTickets,
  localEpics,
}: Pick<JiraDialogProps, "localTickets" | "localEpics">) {
  const [saving, setSaving] = useState(false);
  const [localDataAction, setLocalDataAction] = useState<"publish" | "delete" | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  // Keep the revision/timestamp tokens from the moment this dialog opened so
  // a retry cannot silently migrate data that changed while the request ran.
  const [localTicketSnapshot] = useState(() => [...localTickets]);
  const [localEpicSnapshot] = useState(() => [...localEpics]);

  return {
    saving,
    setSaving,
    localDataAction,
    setLocalDataAction,
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    localTicketSnapshot,
    localEpicSnapshot,
  };
}

function getJiraDialogSelection({
  connectionId,
  connections,
  projects,
  jiraProjectId,
  boards,
  boardId,
  sprints,
  followActiveSprint,
  sprintIds,
  repositoryProjectIds,
  linkedProjects,
  primaryProjectId,
  configuration,
}: {
  connectionId: WorkbenchJiraConnectionId | null;
  connections: JiraDialogProps["connections"];
  projects: ReadonlyArray<WorkbenchJiraProject>;
  jiraProjectId: string | null;
  boards: ReadonlyArray<WorkbenchJiraBoard>;
  boardId: number | null;
  sprints: ReadonlyArray<WorkbenchJiraSprint>;
  followActiveSprint: boolean;
  sprintIds: ReadonlyArray<number>;
  repositoryProjectIds: ReadonlyArray<ProjectId>;
  linkedProjects: JiraDialogProps["linkedProjects"];
  primaryProjectId: ProjectId | null;
  configuration: WorkbenchJiraBoardConfiguration | null;
}) {
  const effectiveConnectionId = connectionId ?? connections[0]?.id ?? null;
  const selectedProject = projects.find((project) => project.id === jiraProjectId) ?? null;
  const selectedBoard = boards.find((board) => board.id === boardId) ?? null;
  const selectableSprints = sprints.filter(
    (sprint) => !followActiveSprint || sprint.state === "active",
  );
  const selectedSprints = selectableSprints.filter((sprint) => sprintIds.includes(sprint.id));
  const selectedRepositoryProjectIds = repositoryProjectIds.filter((id) =>
    linkedProjects.some((project) => project.id === id),
  );
  const selectedPrimaryProjectId =
    primaryProjectId !== null && selectedRepositoryProjectIds.includes(primaryProjectId)
      ? primaryProjectId
      : (selectedRepositoryProjectIds[0] ?? null);
  const jiraStatusCount =
    configuration?.columns.reduce((count, column) => count + column.statusIds.length, 0) ?? 0;

  return {
    effectiveConnectionId,
    selectedProject,
    selectedBoard,
    selectableSprints,
    selectedSprints,
    selectedRepositoryProjectIds,
    selectedPrimaryProjectId,
    jiraStatusCount,
  };
}

function JiraFollowSprintToggle({
  followActiveSprint,
  setFollowActiveSprint,
  setSprintIds,
  sprints,
}: {
  followActiveSprint: boolean;
  setFollowActiveSprint: Dispatch<SetStateAction<boolean>>;
  setSprintIds: Dispatch<SetStateAction<readonly number[]>>;
  sprints: ReadonlyArray<WorkbenchJiraSprint>;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={followActiveSprint}
        onCheckedChange={(checked) => {
          const follow = checked === true;
          setFollowActiveSprint(follow);
          if (follow) {
            setSprintIds((current) =>
              current.filter((id) =>
                sprints.some((sprint) => sprint.id === id && sprint.state === "active"),
              ),
            );
          }
        }}
      />
      Follow selected sprints automatically
    </label>
  );
}

function JiraConfigureActions({
  setStep,
  existingBinding,
  pending,
  saving,
  selectedSprints,
  selectedPrimaryProjectId,
  selectedRepositoryProjectIds,
  statusMappings,
  jiraStatusCount,
  resolvedLocalDataAction,
  save,
}: {
  setStep: Dispatch<SetStateAction<JiraSetupStep>>;
  existingBinding: WorkbenchJiraBinding | null;
  pending: boolean;
  saving: boolean;
  selectedSprints: ReadonlyArray<WorkbenchJiraSprint>;
  selectedPrimaryProjectId: ProjectId | null;
  selectedRepositoryProjectIds: ReadonlyArray<ProjectId>;
  statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
  jiraStatusCount: number;
  resolvedLocalDataAction: "publish" | "delete" | "none" | null;
  save: ({ allowDelete }?: { readonly allowDelete?: boolean }) => Promise<void>;
}) {
  return (
    <div className="flex justify-between gap-2">
      <Button onClick={() => setStep(existingBinding ? "existing" : "board")} variant="ghost">
        <ArrowLeftIcon /> Back
      </Button>
      <Button
        disabled={
          pending ||
          saving ||
          selectedSprints.length === 0 ||
          !selectedPrimaryProjectId ||
          selectedRepositoryProjectIds.length === 0 ||
          statusMappings.length !== jiraStatusCount ||
          resolvedLocalDataAction === null
        }
        onClick={() => void save()}
      >
        {saving ? "Syncing with Jira…" : existingBinding ? "Save mirror" : "Create mirror"}
      </Button>
    </div>
  );
}

function JiraDialogController({
  context,
  presentation,
  discovery,
  commands,
}: {
  context: Pick<
    JiraDialogProps,
    "existingBinding" | "connections" | "linkedProjects" | "localTickets" | "localEpics"
  >;
  presentation: Pick<JiraDialogProps, "open" | "onOpenChange" | "pending" | "error">;
  discovery: Pick<
    JiraDialogProps,
    "onBeginAuth" | "onListProjects" | "onListBoards" | "onListSprints" | "onGetBoardConfiguration"
  >;
  commands: Pick<JiraDialogProps, "onCreate" | "onUpdate" | "onSetActive">;
}) {
  const { existingBinding, connections, linkedProjects, localTickets, localEpics } = context;
  const { open, onOpenChange, pending, error } = presentation;
  const { onBeginAuth, onListProjects, onListBoards, onListSprints, onGetBoardConfiguration } =
    discovery;
  const { onCreate, onUpdate, onSetActive } = commands;
  const {
    step,
    setStep,
    connectionId,
    setConnectionId,
    projects,
    setProjects,
    jiraProjectId,
    setJiraProjectId,
    boards,
    setBoards,
    boardId,
    setBoardId,
    sprints,
    setSprints,
    followActiveSprint,
    setFollowActiveSprint,
    boardMode,
    setBoardMode,
    sprintIds,
    setSprintIds,
    configuration,
    setConfiguration,
    statusMappings,
    setStatusMappings,
    repositoryProjectIds,
    setRepositoryProjectIds,
    primaryProjectId,
    setPrimaryProjectId,
    saving,
    setSaving,
    localDataAction,
    setLocalDataAction,
    deleteConfirmationOpen,
    setDeleteConfirmationOpen,
    localTicketSnapshot,
    localEpicSnapshot,
  } = useJiraDialogState({
    existingBinding,
    connections,
    linkedProjects,
    localTickets,
    localEpics,
  });

  const localTicketCount = localTicketSnapshot.length;
  const localEpicCount = localEpicSnapshot.length;
  const localDataCount = localTicketCount + localEpicCount;
  const resolvedLocalDataAction = localDataCount === 0 ? "none" : localDataAction;

  const {
    effectiveConnectionId,
    selectedProject,
    selectedBoard,
    selectableSprints,
    selectedSprints,
    selectedRepositoryProjectIds,
    selectedPrimaryProjectId,
    jiraStatusCount,
  } = getJiraDialogSelection({
    connectionId,
    connections,
    projects,
    jiraProjectId,
    boards,
    boardId,
    sprints,
    followActiveSprint,
    sprintIds,
    repositoryProjectIds,
    linkedProjects,
    primaryProjectId,
    configuration,
  });

  const loadProjects = async () => {
    if (effectiveConnectionId === null) return;
    const nextProjects = await onListProjects(effectiveConnectionId);
    if (nextProjects === null) return;
    setProjects(nextProjects);
    setJiraProjectId(nextProjects[0]?.id ?? null);
    setStep("project");
  };

  const loadBoards = async () => {
    if (effectiveConnectionId === null || selectedProject === null) return;
    const nextBoards = await onListBoards(effectiveConnectionId, selectedProject.key);
    if (nextBoards === null) return;
    setBoards(nextBoards);
    setBoardId(nextBoards[0]?.id ?? null);
    setStep("board");
  };

  const loadBoardSetup = async ({
    targetConnectionId,
    targetBoardId,
    existingMappings,
    targetSprintIds,
  }: {
    readonly targetConnectionId: WorkbenchJiraConnectionId;
    readonly targetBoardId: number;
    readonly existingMappings?: ReadonlyArray<WorkbenchJiraStatusMapping>;
    readonly targetSprintIds?: ReadonlyArray<number>;
  }) => {
    const nextSprints = await onListSprints(targetConnectionId, targetBoardId);
    if (nextSprints === null) return;
    const nextConfiguration = await onGetBoardConfiguration(targetConnectionId, targetBoardId);
    if (nextSprints === null || nextConfiguration === null) return;
    const selectableSprints = followActiveSprint
      ? nextSprints.filter((sprint) => sprint.state === "active")
      : nextSprints;
    setSprints(nextSprints);
    setSprintIds(
      targetSprintIds !== undefined
        ? selectableSprints
            .filter((sprint) => targetSprintIds.includes(sprint.id))
            .map((sprint) => sprint.id)
        : selectableSprints.length === 1
          ? [selectableSprints[0]!.id]
          : [],
    );
    setConfiguration(nextConfiguration);
    setStatusMappings(
      existingMappings && existingMappings.length > 0
        ? reconcileWorkbenchJiraStatusMappings({
            configuration: nextConfiguration,
            existingMappings,
          })
        : suggestWorkbenchJiraStatusMappings(nextConfiguration),
    );
    setStep("configure");
  };

  const updateStatusMapping = (jiraStatusId: string, workbenchStatus: WorkbenchTicketStatus) => {
    setStatusMappings((current) => [
      ...current.filter((mapping) => mapping.jiraStatusId !== jiraStatusId),
      { jiraStatusId, workbenchStatus },
    ]);
  };

  const save = async ({ allowDelete = false }: { readonly allowDelete?: boolean } = {}) => {
    if (saving || pending) return;
    if (
      selectedSprints.length === 0 ||
      selectedPrimaryProjectId === null ||
      selectedRepositoryProjectIds.length === 0 ||
      statusMappings.length !== jiraStatusCount ||
      resolvedLocalDataAction === null
    )
      return;
    if (resolvedLocalDataAction === "delete" && !allowDelete) {
      setDeleteConfirmationOpen(true);
      return;
    }
    setSaving(true);
    try {
      const saved = existingBinding
        ? await onUpdate({
            binding: existingBinding,
            sprints: selectedSprints,
            defaultPrimaryT3ProjectId: selectedPrimaryProjectId,
            defaultRepositoryProjectIds: selectedRepositoryProjectIds,
            statusMappings,
            followActiveSprint,
            boardMode,
            localDataAction: resolvedLocalDataAction,
            localTickets: localTicketSnapshot,
            localEpics: localEpicSnapshot,
          })
        : effectiveConnectionId && selectedProject && selectedBoard
          ? await onCreate({
              connectionId: effectiveConnectionId,
              jiraProject: selectedProject,
              board: selectedBoard,
              sprints: selectedSprints,
              defaultPrimaryT3ProjectId: selectedPrimaryProjectId,
              defaultRepositoryProjectIds: selectedRepositoryProjectIds,
              statusMappings,
              followActiveSprint,
              boardMode,
              localDataAction: resolvedLocalDataAction,
              localTickets: localTicketSnapshot,
              localEpics: localEpicSnapshot,
            })
          : false;
      if (saved) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{existingBinding ? "Jira sprint mirror" : "Connect Jira"}</DialogTitle>
          <DialogDescription>
            Mirror your assigned Tickets from selected Jira board sprints. Descriptions and progress
            sync both ways; repositories and Agent Threads stay in Workbench.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[70vh] overflow-y-auto">
          {error ? (
            <div
              className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-foreground"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {connections.length > 0 && step !== "site" ? (
            <div className="mb-4 flex justify-end">
              <Button disabled={pending} onClick={() => void onBeginAuth()} variant="outline">
                <ExternalLinkIcon /> Reconnect Jira
              </Button>
            </div>
          ) : null}

          {step === "existing" && existingBinding ? (
            <JiraExistingBindingPanel
              existingBinding={existingBinding}
              onOpenChange={onOpenChange}
              pending={pending}
              saving={saving}
              onSetActive={onSetActive}
              loadBoardSetup={loadBoardSetup}
            />
          ) : null}

          {step === "site" ? (
            <JiraSiteStep
              connections={connections}
              effectiveConnectionId={effectiveConnectionId}
              setConnectionId={setConnectionId}
              pending={pending}
              onBeginAuth={onBeginAuth}
              loadProjects={loadProjects}
            />
          ) : null}

          {step === "project" ? (
            <JiraProjectStep
              jiraProjectId={jiraProjectId}
              setJiraProjectId={setJiraProjectId}
              selectedProject={selectedProject}
              projects={projects}
              setStep={setStep}
              pending={pending}
              loadBoards={loadBoards}
            />
          ) : null}

          {step === "board" ? (
            <JiraBoardStep
              boardId={boardId}
              setBoardId={setBoardId}
              selectedBoard={selectedBoard}
              boards={boards}
              setStep={setStep}
              pending={pending}
              effectiveConnectionId={effectiveConnectionId}
              loadBoardSetup={loadBoardSetup}
            />
          ) : null}

          {step === "configure" && configuration ? (
            <JiraConfigureFields
              sprintSelection={{
                followActiveSprint,
                setFollowActiveSprint,
                setSprintIds,
                sprints,
                selectableSprints,
                selectedSprints,
                sprintIds,
              }}
              localData={{
                localDataCount,
                localTicketCount,
                localEpicCount,
                existingBinding,
                localDataAction,
                setLocalDataAction,
              }}
              repositoryScope={{
                linkedProjects,
                selectedRepositoryProjectIds,
                setRepositoryProjectIds,
                selectedPrimaryProjectId,
                setPrimaryProjectId,
              }}
              statusConfiguration={{
                boardMode,
                setBoardMode,
                configuration,
                statusMappings,
                updateStatusMapping,
              }}
              actions={{ saving, setStep, pending, jiraStatusCount, resolvedLocalDataAction, save }}
            />
          ) : null}
        </DialogPanel>
      </DialogPopup>
      <AlertDialog open={deleteConfirmationOpen} onOpenChange={setDeleteConfirmationOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete local data before importing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete {localDataCount} local {localDataCount === 1 ? "item" : "items"} from
              this Workspace before the Jira import. Native Agent Threads will be retained, but
              their local Tickets and Epics will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button disabled={saving} variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              disabled={saving}
              onClick={() => {
                setDeleteConfirmationOpen(false);
                void save({ allowDelete: true });
              }}
              variant="destructive"
            >
              Delete and import
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Dialog>
  );
}
