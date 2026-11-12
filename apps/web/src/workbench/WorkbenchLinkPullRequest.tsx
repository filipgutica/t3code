import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import { InfoIcon } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useProjects } from "../state/entities";
import { useConnectedEnvironmentIds } from "../state/environments";
import { environmentServerConfigsAtom } from "../state/server";
import { WorkbenchPullRequestPicker } from "./WorkbenchPullRequestPicker";
import { getWorkbenchAssignmentEnvironmentId } from "./workbench.logic";

export function WorkbenchLinkPullRequest({
  environmentId,
  ticketId,
  assignments,
  threadsById,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
}) {
  const linkUnavailableReason = usePullRequestLinkUnavailableReason();
  const descriptionId = useId();
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const [choosing, setChoosing] = useState(false);
  const [linkingThreadId, setLinkingThreadId] = useState<ThreadId | null>(null);
  const liveThreads = [
    ...getEligibleThreads({ assignments, threadsById, environmentId, ticketId }).values(),
  ];
  // Each Thread links on its own machine, so one machine's limits do not block another's Thread.
  const threads = new Map(
    liveThreads
      .filter((thread) => linkUnavailableReason(thread.environmentId) === null)
      .map((thread) => [thread.id, thread]),
  );
  const eligibleThreads = [...threads.values()];
  const unavailable =
    eligibleThreads.length > 0
      ? null
      : liveThreads.length > 0
        ? linkUnavailableReason(liveThreads[0]!.environmentId)
        : "Create or attach a live Thread to this Ticket. PR links belong to Threads.";
  const linkingThread =
    unavailable === null && linkingThreadId !== null ? threads.get(linkingThreadId) : undefined;
  const openPicker = (threadId: ThreadId) => {
    if (unavailable !== null || !threads.has(threadId)) return;
    setChoosing(false);
    setLinkingThreadId(threadId);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          ref={linkButtonRef}
          variant="outline"
          size="xs"
          disabled={unavailable !== null}
          aria-describedby={unavailable ? descriptionId : undefined}
          onClick={() => {
            if (unavailable !== null) return;
            const soleThread = eligibleThreads.length === 1 ? eligibleThreads[0] : undefined;
            if (soleThread) openPicker(soleThread.id);
            else setChoosing(true);
          }}
        >
          Link PR
        </Button>
        {unavailable ? (
          <>
            <p id={descriptionId} role="status" className="sr-only">
              {unavailable}
            </p>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Why Link PR is unavailable"
                  />
                }
              >
                <InfoIcon aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{unavailable}</TooltipPopup>
            </Tooltip>
          </>
        ) : null}
      </div>
      {choosing ? (
        <ThreadChooserDialog
          threads={eligibleThreads}
          unavailable={unavailable}
          finalFocus={linkButtonRef}
          onCancel={() => setChoosing(false)}
          onContinue={openPicker}
        />
      ) : null}
      {linkingThread ? (
        <WorkbenchPullRequestPicker
          key={linkingThread.id}
          thread={linkingThread}
          finalFocus={linkButtonRef}
          onClose={() => setLinkingThreadId(null)}
        />
      ) : null}
    </>
  );
}

function ThreadChooserDialog({
  threads,
  unavailable,
  finalFocus,
  onCancel,
  onContinue,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly unavailable: string | null;
  readonly finalFocus: RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onContinue: (threadId: ThreadId) => void;
}) {
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId);
  const threadLabel = (thread: EnvironmentThreadShell) =>
    `${thread.title} · ${thread.branch ?? "source checkout"} · ${thread.id}`;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogPopup finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>Choose a Thread</DialogTitle>
          <DialogDescription>The PR is linked to the native Thread you choose.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Select
            value={selectedThreadId}
            onValueChange={(value) =>
              setSelectedThreadId(threads.find((thread) => thread.id === value)?.id ?? null)
            }
          >
            <SelectTrigger aria-label="Thread for PR link">
              <SelectValue>
                {selectedThread ? threadLabel(selectedThread) : "Choose a Thread…"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {threads.map((thread) => (
                <SelectItem key={thread.id} value={thread.id}>
                  {threadLabel(thread)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {unavailable ? (
            <p role="status" className="text-xs text-muted-foreground">
              {unavailable}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!selectedThread || unavailable !== null}
            onClick={() => {
              if (selectedThread) onContinue(selectedThread.id);
            }}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function getEligibleThreads({
  assignments,
  threadsById,
  environmentId,
  ticketId,
}: {
  assignments: ReadonlyArray<WorkbenchAssignment>;
  threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  environmentId: EnvironmentId;
  ticketId: WorkbenchTicketId;
}) {
  const threads = new Map<ThreadId, EnvironmentThreadShell>();
  for (const assignment of assignments) {
    const thread = threadsById.get(assignment.threadId);
    if (
      assignment.ticketId === ticketId &&
      assignment.supersededAt === null &&
      // The picker links on the Thread's own environment, which may be another machine.
      thread?.environmentId === getWorkbenchAssignmentEnvironmentId(assignment, environmentId) &&
      thread.archivedAt === null &&
      thread.settledOverride !== "settled"
    )
      threads.set(thread.id, thread);
  }
  return threads;
}

/** Why a Thread's machine cannot link a PR, or null; `usePullRequestLinking`'s checks per machine. */
function usePullRequestLinkUnavailableReason() {
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const projects = useProjects();
  return (environmentId: EnvironmentId) => {
    if (!connectedEnvironmentIds.includes(environmentId)) {
      return "Connect to this environment to link a PR.";
    }
    const capabilities = serverConfigs.get(environmentId)?.environment.capabilities;
    if (threadPullRequestLinkMode(capabilities) === "unsupported") {
      return "This environment does not support PR linking.";
    }
    if (
      !projects.some(
        (project) =>
          project.environmentId === environmentId &&
          project.repositoryIdentity?.provider !== undefined,
      )
    ) {
      return "Add a project with a supported Git remote to this environment before linking a PR.";
    }
    return null;
  };
}
