import type { Dispatch, SetStateAction } from "react";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

export function WorkbenchJiraSprintSelect({
  pending,
  jiraSprints,
  selectedSprintId,
  setJiraSprintId,
}: {
  readonly pending: boolean;
  readonly jiraSprints: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  readonly selectedSprintId: number | undefined;
  readonly setJiraSprintId: Dispatch<SetStateAction<number | null>>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Jira sprint</Label>
      <Select
        disabled={pending || jiraSprints.length === 1}
        value={selectedSprintId === undefined ? null : String(selectedSprintId)}
        onValueChange={(value) => setJiraSprintId(value ? Number(value) : null)}
      >
        <SelectTrigger aria-label="Jira sprint">
          <SelectValue>
            {jiraSprints.find((sprint) => sprint.id === selectedSprintId)?.name ??
              "Select a sprint"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {jiraSprints.map((sprint) => (
            <SelectItem key={sprint.id} value={String(sprint.id)}>
              {sprint.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
