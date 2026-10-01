import type { Project } from "../types";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import type { WorkbenchRepositoryScope } from "./workbenchRepositoryScope";

export function WorkbenchRepositoryScopeFields({
  projects,
  value,
  onChange,
  disabled = false,
  idPrefix,
}: {
  readonly projects: readonly Pick<Project, "id" | "title">[];
  readonly value: WorkbenchRepositoryScope;
  readonly onChange: (value: WorkbenchRepositoryScope) => void;
  readonly disabled?: boolean;
  readonly idPrefix: string;
}) {
  const primaryRepository = projects.find((project) => project.id === value.primaryT3ProjectId);
  const unavailableRepositoryIds = value.repositoryProjectIds.filter(
    (id) => !projects.some((project) => project.id === id),
  );
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="sr-only">Workspace repositories</legend>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-primary`}>Primary repository</Label>
        <p id={`${idPrefix}-primary-description`} className="text-xs text-muted-foreground">
          Where the thread starts. The primary repository is always included.
        </p>
        <Select
          disabled={disabled || projects.length === 0}
          value={value.primaryT3ProjectId}
          onValueChange={(id) => {
            const repository = projects.find((project) => project.id === id);
            if (!repository) return;
            onChange({
              primaryT3ProjectId: repository.id,
              repositoryProjectIds: value.repositoryProjectIds.includes(repository.id)
                ? value.repositoryProjectIds
                : [...value.repositoryProjectIds, repository.id],
            });
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-primary`}
            aria-label="Primary repository"
            aria-describedby={`${idPrefix}-primary-description`}
            aria-invalid={!primaryRepository}
          >
            <SelectValue>
              {primaryRepository?.title ?? "Primary repository unavailable"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {!primaryRepository ? (
              <SelectItem value={value.primaryT3ProjectId} disabled>
                Primary repository unavailable
              </SelectItem>
            ) : null}
            {projects.map((repository) => (
              <SelectItem key={repository.id} value={repository.id}>
                {repository.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {!primaryRepository ? (
          <p className="text-xs text-destructive" role="alert">
            {projects.length === 0
              ? "Link a repository to this Workbench Workspace before preparing this ticket."
              : "The saved primary repository is no longer linked. Choose a linked primary repository to continue."}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <p id={`${idPrefix}-additional-label`} className="text-sm font-medium">
          Additional repositories
        </p>
        <p className="text-xs text-muted-foreground">
          Included in the workspace and new thread context. Existing threads stay unchanged.
        </p>
        <div className="space-y-1" role="group" aria-labelledby={`${idPrefix}-additional-label`}>
          {projects
            .filter((repository) => repository.id !== value.primaryT3ProjectId)
            .map((repository) => (
              <label key={repository.id} className="flex min-w-0 items-center gap-2 py-1 text-sm">
                <Checkbox
                  disabled={disabled}
                  checked={value.repositoryProjectIds.includes(repository.id)}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      repositoryProjectIds: checked
                        ? value.repositoryProjectIds.includes(repository.id)
                          ? value.repositoryProjectIds
                          : [...value.repositoryProjectIds, repository.id]
                        : value.repositoryProjectIds.filter((id) => id !== repository.id),
                    })
                  }
                />
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {repository.title}
                </span>
              </label>
            ))}
          {projects.length === 1 && unavailableRepositoryIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">No additional repositories linked.</p>
          ) : null}
          {unavailableRepositoryIds.length > 0 ? (
            <div className="space-y-1 border-t border-border/50 pt-2">
              <p className="text-xs text-destructive">
                Saved repositories are no longer linked. Remove them or link them again to continue.
              </p>
              {unavailableRepositoryIds.map((id) => (
                <label key={id} className="flex min-w-0 items-start gap-2 py-1 text-sm">
                  <Checkbox
                    disabled={disabled || id === value.primaryT3ProjectId}
                    checked
                    onCheckedChange={(checked) => {
                      if (!checked)
                        onChange({
                          ...value,
                          repositoryProjectIds: value.repositoryProjectIds.filter(
                            (candidate) => candidate !== id,
                          ),
                        });
                    }}
                  />
                  <span className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                    Repository unavailable <span className="font-mono text-xs">({id})</span>
                    {id === value.primaryT3ProjectId ? " · Choose another primary to remove" : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
