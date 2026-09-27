import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  WorkbenchAssignment,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import { useId, useState } from "react";

import { openLinkPullRequestDialog } from "../components/pullRequest/LinkPullRequestDialog";
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
import { useEnvironment } from "../state/environments";

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
  const [choosing, setChoosing] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const threads = getEligibleThreads({ assignments, threadsById, environmentId, ticketId });
  const eligibleThreads = [...threads.values()];
  const unavailable = getUnavailableReason({
    connected: environment?.connection.phase === "connected",
    unsupported: linking.mode === "unsupported",
    hasThreads: eligibleThreads.length > 0,
  });
  const threadLabel = (thread: EnvironmentThreadShell) =>
    `${thread.title} · ${thread.branch ?? "source checkout"} · ${thread.id}`;
  const selectedThread = selectedThreadId === null ? undefined : threads.get(selectedThreadId);
  const openNativeDialog = (threadId: ThreadId) => {
    if (unavailable !== null || !threads.has(threadId)) return;
    setChoosing(false);
    openLinkPullRequestDialog({ environmentId, threadId });
  };

  return (
    <>
      <div className="flex max-w-64 flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={unavailable !== null}
          aria-describedby={unavailable ? descriptionId : undefined}
          onClick={() => {
            if (unavailable !== null) return;
            const soleThread = eligibleThreads.length === 1 ? eligibleThreads[0] : undefined;
            if (soleThread) openNativeDialog(soleThread.id);
            else {
              setSelectedThreadId(null);
              setChoosing(true);
            }
          }}
        >
          Link PR
        </Button>
        {unavailable ? (
          <p id={descriptionId} role="status" className="text-right text-xs text-muted-foreground">
            {unavailable}
          </p>
        ) : null}
      </div>
      {choosing ? (
        <Dialog open onOpenChange={setChoosing}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Choose a Thread</DialogTitle>
              <DialogDescription>
                The PR is linked to a native Thread. Bare PR numbers use that Thread’s repository.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Select
                value={selectedThreadId}
                onValueChange={(value) =>
                  setSelectedThreadId(
                    eligibleThreads.find((thread) => thread.id === value)?.id ?? null,
                  )
                }
              >
                <SelectTrigger aria-label="Thread for PR link">
                  <SelectValue>
                    {selectedThread ? threadLabel(selectedThread) : "Choose a Thread…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {eligibleThreads.map((thread) => (
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
              <Button variant="outline" size="sm" onClick={() => setChoosing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!selectedThread || unavailable !== null}
                onClick={() => {
                  if (selectedThread) openNativeDialog(selectedThread.id);
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
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
}: {
  connected: boolean;
  unsupported: boolean;
  hasThreads: boolean;
}) {
  if (!connected) return "Connect to this environment to link a PR.";
  if (unsupported) return "This environment does not support PR linking.";
  if (!hasThreads) return "Create or attach a live Thread to link a PR.";
  return null;
}
