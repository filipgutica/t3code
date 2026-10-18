import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchTicketId,
} from "@t3tools/contracts";
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
import { usePullRequestLinking } from "../hooks/usePullRequestLinking";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useEnvironment } from "../state/environments";
import { WorkbenchPullRequestPicker } from "./WorkbenchPullRequestPicker";

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
  const linking = usePullRequestLinking(environmentId);
  const environment = useEnvironment(environmentId);
  const descriptionId = useId();
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const [choosing, setChoosing] = useState(false);
  const [linkingThreadId, setLinkingThreadId] = useState<ThreadId | null>(null);
  const threads = getEligibleThreads({ assignments, threadsById, environmentId, ticketId });
  const eligibleThreads = [...threads.values()];
  const unavailable = getUnavailableReason({
    connected: environment?.connection.phase === "connected",
    unsupported: linking.mode === "unsupported",
    hasThreads: eligibleThreads.length > 0,
    canLinkAny: linking.canLinkAny,
  });
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
      thread?.environmentId === environmentId &&
      thread.archivedAt === null &&
      thread.settledOverride !== "settled"
    )
      threads.set(thread.id, thread);
  }
  return threads;
}

function getUnavailableReason({
  connected,
  unsupported,
  hasThreads,
  canLinkAny,
}: {
  connected: boolean;
  unsupported: boolean;
  hasThreads: boolean;
  canLinkAny: boolean;
}) {
  if (!connected) return "Connect to this environment to link a PR.";
  if (unsupported) return "This environment does not support PR linking.";
  if (!hasThreads)
    return "Create or attach a live Thread to this Ticket. PR links belong to Threads.";
  if (!canLinkAny)
    return "Add a project with a supported Git remote to this environment before linking a PR.";
  return null;
}
