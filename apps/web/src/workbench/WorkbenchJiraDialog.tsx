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
}

export interface WorkbenchJiraUpdateDraft {
  readonly binding: WorkbenchJiraBinding;
  readonly sprints: ReadonlyArray<WorkbenchJiraSprint>;
  readonly defaultPrimaryT3ProjectId: ProjectId;
  readonly defaultRepositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly statusMappings: ReadonlyArray<WorkbenchJiraStatusMapping>;
  readonly followActiveSprint: boolean;
  readonly boardMode: "mapped" | "mirror_jira";
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

  const save = async () => {
    if (
      selectedSprints.length === 0 ||
      selectedPrimaryProjectId === null ||
      selectedRepositoryProjectIds.length === 0 ||
      statusMappings.length !== jiraStatusCount
    )
      return;
    const saved = existingBinding
      ? await onUpdate({
          binding: existingBinding,
          sprints: selectedSprints,
          defaultPrimaryT3ProjectId: selectedPrimaryProjectId,
          defaultRepositoryProjectIds: selectedRepositoryProjectIds,
          statusMappings,
          followActiveSprint,
          boardMode,
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
              <p className="text-xs text-muted-foreground">
                Checks every five minutes while the server is running. Keeps the current board
                between sprints; asks you to choose when replacement sprints are ambiguous.
              </p>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {followActiveSprint ? "Current active sprints" : "Pinned sprints"}
                </legend>
                <p className="text-xs text-muted-foreground">
                  Choose one, some, or all. Only your assigned issues from the selected sprints are
                  mirrored, including issues from different Jira projects.
                </p>
                {selectableSprints.length > 0 ? (
                  <div className="rounded-lg border border-border/60 p-3">
                    <label className="flex items-center gap-2 border-b border-border/60 pb-2 text-sm font-medium">
                      <Checkbox
                        checked={selectedSprints.length === selectableSprints.length}
                        indeterminate={
                          selectedSprints.length > 0 &&
                          selectedSprints.length < selectableSprints.length
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
                            {sprint.name}{" "}
                            <span className="text-muted-foreground">· {sprint.state}</span>
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
                  <p className="text-xs text-muted-foreground">
                    Select at least one sprint to continue.
                  </p>
                ) : null}
              </fieldset>

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
                <legend className="text-sm font-medium">Ticket columns</legend>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={boardMode === "mirror_jira"}
                    onCheckedChange={(checked) =>
                      setBoardMode(checked === true ? "mirror_jira" : "mapped")
                    }
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
                              <p className="truncate text-xs text-muted-foreground">
                                Jira status {statusId}
                              </p>
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
                  <p className="text-sm">
                    {configuration.columns.map((column) => column.name).join(" → ")}
                  </p>
                )}
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
                    selectedSprints.length === 0 ||
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
