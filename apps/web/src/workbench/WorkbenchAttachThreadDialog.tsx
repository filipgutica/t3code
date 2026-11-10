import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ThreadId } from "@t3tools/contracts";
import { CheckIcon, LinkIcon } from "lucide-react";
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
import { getWorkbenchRepositoryTitle } from "./WorkbenchThreadRepositoryPicker";

export type WorkbenchAttachableThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "title" | "projectId" | "branch"
>;
type LinkableThread = WorkbenchAttachableThread;
/** A Board repository; one on another machine carries that machine in its title. */
type RepositoryProject = Pick<EnvironmentProject, "id" | "title">;

function WorkbenchLinkThreadList({
  threads,
  projects,
  selectedId,
  pending,
  onSelect,
}: {
  readonly threads: ReadonlyArray<LinkableThread>;
  readonly projects: ReadonlyArray<RepositoryProject>;
  readonly selectedId: ThreadId | null;
  readonly pending: boolean;
  readonly onSelect: (id: ThreadId) => void;
}) {
  const [search, setSearch] = useState("");
  const matching = threads.filter((thread) =>
    thread.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Input
        aria-label="Find a Thread"
        placeholder="Find a Thread…"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <div className="max-h-72 space-y-1 overflow-x-hidden overflow-y-auto">
        {matching.map((thread) => {
          const repository = getWorkbenchRepositoryTitle(projects, thread.projectId);
          const selected = selectedId === thread.id;
          return (
            <Button
              key={thread.id}
              className="w-full min-w-0 justify-start"
              aria-label={[thread.title, repository, thread.branch].filter(Boolean).join(", ")}
              aria-pressed={selected}
              variant={selected ? "secondary" : "ghost"}
              disabled={pending}
              onClick={() => onSelect(thread.id)}
            >
              <span className="min-w-0 flex-1 truncate text-left">{thread.title}</span>
              <span className="max-w-1/2 truncate text-xs text-muted-foreground">
                {[repository, thread.branch].filter(Boolean).join(" · ")}
              </span>
              {selected ? <CheckIcon aria-hidden="true" /> : null}
            </Button>
          );
        })}
        {matching.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {threads.length === 0
              ? "No Threads are available to link. Create a Thread instead."
              : "No Threads match your search."}
          </p>
        ) : null}
      </div>
    </>
  );
}

function WorkbenchLinkSource({
  thread,
  projects,
}: {
  readonly thread: LinkableThread;
  readonly projects: ReadonlyArray<RepositoryProject>;
}) {
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <p className="text-muted-foreground">Selected Thread</p>
      <p className="break-words">{thread.title}</p>
      <p className="break-words text-muted-foreground">
        {[getWorkbenchRepositoryTitle(projects, thread.projectId), thread.branch]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

export function WorkbenchAttachThreadDialog({
  projects,
  threads,
  pending,
  disabled,
  error,
  onClose,
  onAttach,
}: {
  readonly projects: ReadonlyArray<RepositoryProject>;
  readonly threads: ReadonlyArray<LinkableThread>;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onAttach: (thread: WorkbenchAttachableThread) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const selected = threads.find((thread) => thread.id === selectedId);
  const canLink = !disabled && !pending && selected !== undefined;
  const attachSelectedThread = () => {
    // `selected` comes from the live shells, so a Thread that left its machine cannot be linked.
    if (canLink) void onAttach(selected);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="min-w-0 max-w-lg">
        <DialogHeader>
          <DialogTitle>Link existing Thread</DialogTitle>
          <DialogDescription>
            Choose an unassigned Thread from this Ticket’s repositories, on this machine or another
            connected one. It keeps its existing branch and working directory. No prompt is sent.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="min-w-0">
          <div className="space-y-3">
            <WorkbenchLinkThreadList
              threads={threads}
              projects={projects}
              selectedId={selectedId}
              pending={pending}
              onSelect={setSelectedId}
            />
            {selected ? <WorkbenchLinkSource thread={selected} projects={projects} /> : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <p role="status" className="sr-only">
            {pending ? "Linking Thread…" : null}
          </p>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button className="[&_svg]:mx-0" disabled={!canLink} onClick={attachSelectedThread}>
            <LinkIcon /> {pending ? "Linking…" : "Link Thread"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
