import {
  ProjectId,
  type WorkbenchJiraBinding,
  type WorkbenchJiraBoard,
  type WorkbenchJiraBoardConfiguration,
  type WorkbenchJiraConnection,
  WorkbenchJiraConnectionId,
  type WorkbenchJiraProject,
  type WorkbenchJiraSprint,
  type WorkbenchJiraStatusMapping,
  type WorkbenchTicketStatus,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon, LinkIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
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
import type { Project } from "../types";
import { WORKBENCH_TICKET_STATUS_LABELS } from "./workbench.logic";
import {
  reconcileWorkbenchJiraStatusMappings,
  suggestWorkbenchJiraStatusMappings,
} from "./workbenchJira.logic";

type JiraSetupStep = "existing" | "site" | "project" | "board" | "configure";

export interface WorkbenchJiraCreateDraft {
  readonly connectionId: WorkbenchJiraConnectionId;
  readonly jiraProject: WorkbenchJiraProject;
  readonly board: WorkbenchJiraBoard;
  readonly sprint: WorkbenchJiraSprint;
  readonly defaultPrimaryT3ProjectId: ProjectId;
  readonly defaultRepositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
}

export interface WorkbenchJiraUpdateDraft {
  readonly binding: WorkbenchJiraBinding;
  readonly sprint: WorkbenchJiraSprint;
  readonly defaultPrimaryT3ProjectId: ProjectId;
  readonly defaultRepositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
}

const formatLastSynced = (value: string | null) =>
  value === null ? "Not synced yet" : `Last synced ${new Date(value).toLocaleString()}`;

export function WorkbenchJiraDialog({
  open,
  connections,
  existingBinding,
  linkedProjects,
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
  const [step, setStep] = useState<JiraSetupStep>(existingBinding ? "existing" : "site");
  const [connectionId, setConnectionId] = useState<WorkbenchJiraConnectionId | null>(
    existingBinding?.connectionId ?? connections[0]?.id ?? null,
  );
  const [projects, setProjects] = useState<ReadonlyArray<WorkbenchJiraProject>>([]);
  const [jiraProjectId, setJiraProjectId] = useState<string | null>(null);
  const [boards, setBoards] = useState<ReadonlyArray<WorkbenchJiraBoard>>([]);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [sprints, setSprints] = useState<ReadonlyArray<WorkbenchJiraSprint>>([]);
  const [sprintId, setSprintId] = useState<number | null>(existingBinding?.sprintId ?? null);
  const [configuration, setConfiguration] = useState<WorkbenchJiraBoardConfiguration | null>(null);
  const [statusMappings, setStatusMappings] = useState<ReadonlyArray<WorkbenchJiraStatusMapping>>(
    existingBinding?.statusMappings ?? [],
  );
  const [repositoryProjectIds, setRepositoryProjectIds] = useState<ReadonlyArray<ProjectId>>(
    existingBinding?.defaultRepositoryProjectIds ??
      (linkedProjects[0] ? [linkedProjects[0].id] : []),
  );
  const [primaryProjectId, setPrimaryProjectId] = useState<ProjectId | null>(
    existingBinding?.defaultPrimaryT3ProjectId ?? linkedProjects[0]?.id ?? null,
  );

  const effectiveConnectionId = connectionId ?? connections[0]?.id ?? null;
  const selectedProject = projects.find((project) => project.id === jiraProjectId) ?? null;
  const selectedBoard = boards.find((board) => board.id === boardId) ?? null;
  const selectedSprint = sprints.find((sprint) => sprint.id === sprintId) ?? null;
  const selectedRepositoryProjectIds = repositoryProjectIds.filter((id) =>
    linkedProjects.some((project) => project.id === id),
  );
  const selectedPrimaryProjectId =
    primaryProjectId !== null && selectedRepositoryProjectIds.includes(primaryProjectId)
      ? primaryProjectId
      : (selectedRepositoryProjectIds[0] ?? null);
  const jiraStatusCount =
    configuration?.columns.reduce((count, column) => count + column.statusIds.length, 0) ?? 0;

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
    targetSprintId,
  }: {
    readonly targetConnectionId: WorkbenchJiraConnectionId;
    readonly targetBoardId: number;
    readonly existingMappings?: ReadonlyArray<WorkbenchJiraStatusMapping>;
    readonly targetSprintId?: number;
  }) => {
    const nextSprints = await onListSprints(targetConnectionId, targetBoardId);
    if (nextSprints === null) return;
    const nextConfiguration = await onGetBoardConfiguration(targetConnectionId, targetBoardId);
    if (nextSprints === null || nextConfiguration === null) return;
    setSprints(nextSprints);
    setSprintId(
      nextSprints.some((sprint) => sprint.id === targetSprintId)
        ? (targetSprintId ?? null)
        : (nextSprints.find((sprint) => sprint.state === "active")?.id ??
            nextSprints[0]?.id ??
            null),
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

  const save = async () => {
    if (
      selectedSprint === null ||
      selectedPrimaryProjectId === null ||
      selectedRepositoryProjectIds.length === 0 ||
      statusMappings.length !== jiraStatusCount
    )
      return;
    const saved = existingBinding
      ? await onUpdate({
          binding: existingBinding,
          sprint: selectedSprint,
          defaultPrimaryT3ProjectId: selectedPrimaryProjectId,
          defaultRepositoryProjectIds: selectedRepositoryProjectIds,
          statusMappings,
        })
      : effectiveConnectionId && selectedProject && selectedBoard
        ? await onCreate({
            connectionId: effectiveConnectionId,
            jiraProject: selectedProject,
            board: selectedBoard,
            sprint: selectedSprint,
            defaultPrimaryT3ProjectId: selectedPrimaryProjectId,
            defaultRepositoryProjectIds: selectedRepositoryProjectIds,
            statusMappings,
          })
        : false;
    if (saved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{existingBinding ? "Jira sprint mirror" : "Connect Jira"}</DialogTitle>
          <DialogDescription>
            Mirror assigned Tickets from one Jira sprint. Jira owns their summary, Epic, and Board
            status; Workbench owns repositories and Agent Threads.
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

          {step === "existing" && existingBinding ? (
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
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {existingBinding.boardName} · {existingBinding.sprintName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatLastSynced(existingBinding.lastSyncedAt)}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => onOpenChange(false)} variant="outline">
                  Close
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => void onSetActive(existingBinding, !existingBinding.active)}
                  variant="outline"
                >
                  {existingBinding.active ? "Pause mirror" : "Resume mirror"}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void loadBoardSetup({
                      targetConnectionId: existingBinding.connectionId,
                      targetBoardId: existingBinding.boardId,
                      existingMappings: existingBinding.statusMappings,
                      targetSprintId: existingBinding.sprintId,
                    })
                  }
                >
                  Edit sprint and mappings
                </Button>
              </div>
            </div>
          ) : null}

          {step === "site" ? (
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
                  Authorize an Atlassian site before choosing a Jira project and sprint.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={pending} onClick={() => void onBeginAuth()} variant="outline">
                  <ExternalLinkIcon />{" "}
                  {connections.length > 0 ? "Connect another site" : "Connect Atlassian"}
                </Button>
                {effectiveConnectionId ? (
                  <Button disabled={pending} onClick={() => void loadProjects()}>
                    Continue
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === "project" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Jira project</Label>
                <Select
                  value={jiraProjectId}
                  onValueChange={(value) => setJiraProjectId(value || null)}
                >
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
          ) : null}

          {step === "board" ? (
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
          ) : null}

          {step === "configure" && configuration ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label>Sprint</Label>
                <Select
                  value={sprintId?.toString() ?? null}
                  onValueChange={(value) => setSprintId(value ? Number(value) : null)}
                >
                  <SelectTrigger aria-label="Jira sprint">
                    <SelectValue>{selectedSprint?.name ?? "Choose a sprint"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {sprints.map((sprint) => (
                      <SelectItem key={sprint.id} value={String(sprint.id)}>
                        {sprint.name} · {sprint.state}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {sprints.length === 0 ? (
                  <p className="text-xs text-warning-foreground">
                    This Board has no available sprints and cannot be mirrored.
                  </p>
                ) : null}
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Default repository scope</legend>
                <p className="text-xs text-muted-foreground">
                  New Jira Tickets use this scope until work starts.
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
                  onValueChange={(value) =>
                    setPrimaryProjectId(value ? ProjectId.make(value) : null)
                  }
                >
                  <SelectTrigger aria-label="Default primary repository">
                    <SelectValue>
                      {linkedProjects.find((project) => project.id === selectedPrimaryProjectId)
                        ?.title ?? "Choose a primary repository"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {linkedProjects
                      .filter((project) => selectedRepositoryProjectIds.includes(project.id))
                      .map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.title}
                        </SelectItem>
                      ))}
                  </SelectPopup>
                </Select>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Board status mapping</legend>
                <p className="text-xs text-muted-foreground">
                  Confirm where each Jira status appears in Workbench.
                </p>
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
                            <p className="truncate text-xs text-muted-foreground">
                              Jira status {statusId}
                            </p>
                          </div>
                          <Select
                            value={mapping?.workbenchStatus ?? null}
                            onValueChange={(value) => {
                              if (
                                value === "todo" ||
                                value === "in_progress" ||
                                value === "ready_for_review" ||
                                value === "done"
                              )
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
                              {(["todo", "in_progress", "ready_for_review", "done"] as const).map(
                                (status) => (
                                  <SelectItem key={status} value={status}>
                                    {WORKBENCH_TICKET_STATUS_LABELS[status]}
                                  </SelectItem>
                                ),
                              )}
                            </SelectPopup>
                          </Select>
                        </div>
                      );
                    }),
                  )}
                </div>
              </fieldset>

              <div className="flex justify-between gap-2">
                <Button
                  onClick={() => setStep(existingBinding ? "existing" : "board")}
                  variant="ghost"
                >
                  <ArrowLeftIcon /> Back
                </Button>
                <Button
                  disabled={
                    pending ||
                    !selectedSprint ||
                    !selectedPrimaryProjectId ||
                    selectedRepositoryProjectIds.length === 0 ||
                    statusMappings.length !== jiraStatusCount
                  }
                  onClick={() => void save()}
                >
                  {existingBinding ? "Save mirror" : "Create mirror"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
