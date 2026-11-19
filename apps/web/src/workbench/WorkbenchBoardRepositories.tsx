import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, WorkbenchProject } from "@t3tools/contracts";
import { useState } from "react";

import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useWorkbenchMachineOf } from "./useWorkbenchMachineOf";
import {
  getWorkbenchRepositoryChoices,
  linkWorkbenchRepositoryCheckouts,
} from "./workbenchRemoteProjects";

export type WorkbenchBoardRepositoryLinks = Pick<
  WorkbenchProject,
  "linkedProjectIds" | "remoteProjects" | "repositoryKeys"
>;

/** Edit Board's repository list: each repository once, with the machines that check it out. */
export function WorkbenchBoardRepositories({
  environmentId,
  projects,
  pending,
  editing,
  lockedProjectIds,
  board,
  onChange,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly pending: boolean;
  readonly editing: boolean;
  /** Linked when Edit Board opened; it never unlinks them. */
  readonly lockedProjectIds: ReadonlyArray<ProjectId>;
  readonly board: WorkbenchBoardRepositoryLinks;
  readonly onChange: (board: WorkbenchBoardRepositoryLinks) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const machineOf = useWorkbenchMachineOf(environmentId);
  const severalMachines = projects.some((project) => project.environmentId !== environmentId);
  const choices = getWorkbenchRepositoryChoices({ board, projects, environmentId }).filter(
    ({ checkouts }) =>
      checkouts.some(
        (checkout) =>
          checkout.title.toLowerCase().includes(normalizedQuery) ||
          checkout.workspaceRoot.toLowerCase().includes(normalizedQuery),
      ),
  );
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">Linked repositories</legend>
      <p className="text-xs text-muted-foreground">
        {editing
          ? "Already-linked repositories stay selected. Add a directory as a T3 Project first if it is not listed here."
          : "Tickets can target any selected T3 Project."}{" "}
        {severalMachines
          ? "A repository is linked on every machine that checks it out, so Threads can run on any machine with all of a Ticket's repositories. Threads on another machine get the Ticket in their first message; later Ticket changes don't reach them."
          : null}
      </p>
      {projects.length > 0 ? (
        <Input
          type="search"
          aria-label="Search repositories"
          placeholder="Search repositories"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          // Enter would otherwise submit the Board form.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      ) : null}
      {/* A fixed height while searching keeps the centered dialog from jumping as results change. */}
      <div
        className={cn(
          "space-y-1 overflow-y-auto rounded-lg border border-border p-1",
          normalizedQuery ? "h-60" : "max-h-60",
        )}
      >
        {choices.map((choice) => {
          const reachable = choice.checkouts.filter((checkout) => checkout.workspaceRoot !== "");
          const shown = reachable[0] ?? choice.checkouts[0]!;
          const inputId = `workbench-repository-${shown.environmentId}-${shown.id}`;
          return (
            <label
              key={choice.key}
              htmlFor={inputId}
              className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
            >
              <Checkbox
                id={inputId}
                className="mt-0.5"
                checked={choice.checkouts.some((checkout) =>
                  board.linkedProjectIds.includes(checkout.id),
                )}
                disabled={
                  pending ||
                  reachable.length === 0 ||
                  choice.checkouts.some((checkout) => lockedProjectIds.includes(checkout.id))
                }
                onCheckedChange={(checked) =>
                  onChange({
                    ...board,
                    ...linkWorkbenchRepositoryCheckouts({
                      board,
                      projects,
                      environmentId,
                      row: { choice, checked },
                    }),
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{shown.title}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {shown.workspaceRoot}
                </span>
                {severalMachines ? (
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {choice.checkouts.map((checkout) => {
                      const machine = machineOf(checkout.environmentId);
                      return (
                        <span
                          key={checkout.environmentId}
                          className="inline-flex min-w-0 items-center gap-1"
                        >
                          <EnvironmentMachineIcon kind={machine.kind} className="size-3 shrink-0" />
                          <span className="truncate">
                            {checkout.environmentId === environmentId
                              ? "This machine"
                              : machine.label}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
        {projects.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Create a T3 Project before creating a Board.
          </p>
        ) : choices.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No repositories match.</p>
        ) : null}
      </div>
    </fieldset>
  );
}
