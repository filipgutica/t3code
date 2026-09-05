import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadId } from "@t3tools/contracts";
import { useState } from "react";

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
import { Input } from "../components/ui/input";

export function WorkbenchAttachThreadDialog({
  threads,
  pending,
  error,
  onClose,
  onAttach,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onAttach: (threadId: ThreadId) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const matching = threads.filter((thread) =>
    thread.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="min-w-0 max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach existing Thread</DialogTitle>
          <DialogDescription>
            Choose a non-archived Thread from this Ticket’s primary repository in this environment.
            Threads already linked to a Ticket, including past assignments, cannot be attached. No
            prompt is sent.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-w-0 space-y-3">
          <Input
            aria-label="Find a Thread"
            placeholder="Find a Thread…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <div className="max-h-72 space-y-1 overflow-x-hidden overflow-y-auto">
            {matching.map((thread) => (
              <Button
                key={thread.id}
                className="w-full min-w-0 justify-start"
                variant={selectedId === thread.id ? "secondary" : "ghost"}
                disabled={pending}
                onClick={() => setSelectedId(thread.id)}
              >
                <span className="truncate">{thread.title}</span>
              </Button>
            ))}
            {matching.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                {threads.length === 0
                  ? "No available Threads in this Ticket’s primary repository. Create a new Thread instead."
                  : "No Threads match your search."}
              </p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              pending || selectedId === null || !threads.some((thread) => thread.id === selectedId)
            }
            onClick={() => {
              if (selectedId !== null) void onAttach(selectedId);
            }}
          >
            Attach Thread
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
