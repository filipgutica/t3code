import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  WorkbenchJiraUncertainCreation,
  WorkbenchJiraResolveCreationInput,
} from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { Radio, RadioGroup } from "../components/ui/radio-group";
import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { failureMessage } from "./workbenchPageCommands";

export function WorkbenchJiraCreationRecovery({
  environmentId,
  creations,
}: {
  readonly environmentId: EnvironmentId;
  readonly creations: ReadonlyArray<WorkbenchJiraUncertainCreation>;
}) {
  const canResolve = useAtomValue(
    workbenchEnvironment.jiraResolveCreation.permissionAtom(environmentId),
  );
  const resolve = useAtomCommand(workbenchEnvironment.jiraResolveCreation, {
    reportFailure: false,
  });
  const [selected, setSelected] = useState<WorkbenchJiraUncertainCreation | null>(null);
  if (creations.length === 0) return null;
  return (
    <div className="space-y-2 border-b p-4 text-sm">
      <p>
        Jira may have accepted these creations. Check Jira and resolve each outcome before retrying
        or archiving this Workspace.
      </p>
      {creations.map((creation) => (
        <div
          key={`${creation.kind}:${creation.id}`}
          className="flex items-center justify-between gap-3"
        >
          <span>
            {creation.kind === "epic" ? "Epic" : "Ticket"}: {creation.title}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!canResolve}
            onClick={() => setSelected(creation)}
          >
            Resolve
          </Button>
        </div>
      ))}
      {selected ? (
        <ResolveDialog
          key={`${selected.kind}:${selected.id}`}
          creation={selected}
          canResolve={canResolve}
          onClose={() => setSelected(null)}
          onResolve={(outcome) =>
            resolve({
              environmentId,
              input: {
                bindingId: selected.bindingId,
                kind: selected.kind,
                id: selected.id,
                outcome,
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

function ResolveDialog({
  creation,
  canResolve,
  onClose,
  onResolve,
}: {
  readonly creation: WorkbenchJiraUncertainCreation;
  readonly canResolve: boolean;
  readonly onClose: () => void;
  readonly onResolve: (
    outcome: WorkbenchJiraResolveCreationInput["outcome"],
  ) => Promise<
    | { readonly _tag: "Success" }
    | { readonly _tag: "Failure"; readonly cause: Parameters<typeof failureMessage>[0]["cause"] }
  >;
}) {
  const [outcome, setOutcome] = useState<"not_created" | "created">("created");
  const [issueKey, setIssueKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await onResolve(
        outcome === "created"
          ? { type: "created", issueKey: issueKey.trim() }
          : { type: "not_created" },
      );
      if (result._tag === "Failure") setError(failureMessage(result));
      else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Jira creation could not be resolved.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Resolve Jira creation</DialogTitle>
          <DialogDescription>
            Check Jira for “{creation.title}” and select its outcome. Confirming that it was not
            created allows a new creation request.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <RadioGroup
              value={outcome}
              onValueChange={(value) => {
                if (value === "created" || value === "not_created") setOutcome(value);
              }}
              disabled={pending}
              aria-label="Jira creation outcome"
            >
              <Label>
                <Radio value="created" /> Created in Jira as KEY
              </Label>
              <Label>
                <Radio value="not_created" /> Not created in Jira
              </Label>
            </RadioGroup>
            {outcome === "created" ? (
              <Label>
                Jira issue key
                <Input
                  value={issueKey}
                  onChange={(event) => setIssueKey(event.target.value)}
                  placeholder="PROJ-123"
                  disabled={pending}
                />
              </Label>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !canResolve || (outcome === "created" && !issueKey.trim())}
            onClick={() => void submit()}
          >
            {pending ? "Resolving…" : "Resolve creation"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
