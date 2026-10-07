import type {
  WorkbenchEpic,
  WorkbenchEpicId,
  WorkbenchJiraBinding,
  WorkbenchTicket,
} from "@t3tools/contracts";
import { useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
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
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { getWorkbenchJiraBindingSprints } from "./workbenchJira.logic";
import { WorkbenchJiraSprintSelect } from "./WorkbenchJiraSprintSelect";

export function WorkbenchPublishTicketDialog({
  ticket,
  binding,
  epics,
  pending,
  error,
  onClose,
  onPublish,
}: {
  readonly ticket: WorkbenchTicket;
  readonly binding: WorkbenchJiraBinding;
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onPublish: (selection: {
    jiraSprintId: number;
    epicId: WorkbenchEpicId | null;
  }) => Promise<boolean>;
}) {
  const jiraSprints = getWorkbenchJiraBindingSprints(binding);
  const [jiraSprintId, setJiraSprintId] = useState<number | null>(null);
  const [epicId, setEpicId] = useState<WorkbenchEpicId | null>(() =>
    epics.some((epic) => epic.id === ticket.epicId) ? ticket.epicId : null,
  );
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);
  const selectedSprintId =
    jiraSprints.length === 1
      ? jiraSprints[0]?.id
      : jiraSprints.find((sprint) => sprint.id === jiraSprintId)?.id;
  const selectedEpicId = epics.some((epic) => epic.id === epicId) ? epicId : null;
  const canPublish = binding.active && selectedSprintId !== undefined;
  const close = () => {
    if (!pending && !submitting.current) onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || submitting.current || !canPublish) return;
    submitting.current = true;
    setSubmitted(true);
    try {
      if (await onPublish({ jiraSprintId: selectedSprintId, epicId: selectedEpicId })) onClose();
    } finally {
      submitting.current = false;
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Publish Ticket to Jira</DialogTitle>
          <DialogDescription>
            Create a Jira issue in {binding.jiraProjectKey}. This Ticket keeps its Threads and
            worktrees. Jira will own its status and synced content.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id="publish-workbench-ticket" className="space-y-5" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label>Ticket</Label>
              <p className="text-sm font-medium break-words">{ticket.title}</p>
            </div>
            <PublicationNotices error={error} connectionActive={binding.active} />
            <WorkbenchJiraSprintSelect
              pending={pending || submitted}
              jiraSprints={jiraSprints}
              selectedSprintId={selectedSprintId}
              setJiraSprintId={setJiraSprintId}
            />
            <PublicationEpicSelect
              epics={epics}
              originalEpicId={ticket.epicId}
              selectedEpicId={selectedEpicId}
              setEpicId={setEpicId}
              disabled={pending || submitted}
            />
            {pending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Publishing to Jira…
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <PublicationActions
          pending={pending}
          submitted={submitted}
          canPublish={canPublish}
          onClose={close}
        />
      </DialogPopup>
    </Dialog>
  );
}

function PublicationActions({
  pending,
  submitted,
  canPublish,
  onClose,
}: {
  readonly pending: boolean;
  readonly submitted: boolean;
  readonly canPublish: boolean;
  readonly onClose: () => void;
}) {
  return (
    <DialogFooter>
      <Button disabled={pending} onClick={onClose} variant="outline">
        Cancel
      </Button>
      <Button
        form="publish-workbench-ticket"
        type="submit"
        aria-busy={pending}
        disabled={pending || !canPublish}
      >
        {pending ? "Publishing…" : submitted ? "Retry publication" : "Publish to Jira"}
      </Button>
    </DialogFooter>
  );
}

function PublicationNotices({
  error,
  connectionActive,
}: {
  readonly error: string | null;
  readonly connectionActive: boolean;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!connectionActive ? (
        <p role="alert" className="text-sm text-destructive">
          Resume the Jira connection before publishing this Ticket.
        </p>
      ) : null}
    </>
  );
}

function PublicationEpicSelect({
  epics,
  originalEpicId,
  selectedEpicId,
  setEpicId,
  disabled,
}: {
  readonly epics: ReadonlyArray<WorkbenchEpic>;
  readonly originalEpicId: WorkbenchEpicId | null;
  readonly selectedEpicId: WorkbenchEpicId | null;
  readonly setEpicId: Dispatch<SetStateAction<WorkbenchEpicId | null>>;
  readonly disabled: boolean;
}) {
  const originalIsLocal =
    originalEpicId !== null && !epics.some((epic) => epic.id === originalEpicId);
  return (
    <div className="space-y-1.5">
      <Label>Jira Epic</Label>
      <Select
        disabled={disabled}
        value={selectedEpicId ?? "none"}
        onValueChange={(value) => setEpicId(epics.find((epic) => epic.id === value)?.id ?? null)}
      >
        <SelectTrigger aria-label="Jira Epic">
          <SelectValue>
            {epics.find((epic) => epic.id === selectedEpicId)?.title ?? "No Epic"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="none">No Epic</SelectItem>
          {epics.map((epic) => (
            <SelectItem key={epic.id} value={epic.id}>
              {epic.title}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {originalIsLocal ? (
        <p className="text-sm text-muted-foreground">
          The local Epic will not be published. Choose a Jira Epic or publish with no Epic.
        </p>
      ) : null}
    </div>
  );
}
