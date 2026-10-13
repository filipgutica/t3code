import type { Project } from "../types";
import { CheckIcon } from "lucide-react";
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
  lockedScope,
}: {
  readonly projects: readonly Pick<Project, "id" | "title">[];
  readonly value: WorkbenchRepositoryScope;
  readonly onChange: (value: WorkbenchRepositoryScope) => void;
  readonly disabled?: boolean;
  readonly idPrefix: string;
  readonly lockedScope?: WorkbenchRepositoryScope | undefined;
}) {
  const primaryRepository = projects.find((project) => project.id === value.primaryT3ProjectId);
  const unavailableAdditionalRepositoryIds = value.repositoryProjectIds.filter(
    (id) => id !== value.primaryT3ProjectId && !projects.some((project) => project.id === id),
  );
  const additionalRepositoryIds = value.repositoryProjectIds.filter(
    (id) => id !== value.primaryT3ProjectId,
  );
  const additionalRepositories = [
    ...projects.filter((project) => project.id !== value.primaryT3ProjectId),
    ...unavailableAdditionalRepositoryIds.map((id) => ({
      id,
      title: `Repository unavailable (${id})`,
    })),
  ];
  const firstAdditionalRepository = additionalRepositories.find(
    (repository) => repository.id === additionalRepositoryIds[0],
  );
  const additionalRepositorySummary = firstAdditionalRepository
    ? `${firstAdditionalRepository.title}${additionalRepositoryIds.length > 1 ? ` + ${additionalRepositoryIds.length - 1} more` : ""}`
    : "None";
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <legend className="sr-only">Workspace repositories</legend>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-primary`}>Primary repository</Label>
        <p id={`${idPrefix}-primary-description`} className="flex-1 text-xs text-muted-foreground">
          Where the thread starts. The primary repository is always included.
        </p>
        <Select
          disabled={disabled || lockedScope !== undefined || projects.length === 0}
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
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-additional`}>Additional repositories</Label>
        <p
          id={`${idPrefix}-additional-description`}
          className="flex-1 text-xs text-muted-foreground"
        >
          Included in the workspace and new thread context. Existing threads stay unchanged.
        </p>
        <Select
          multiple
          disabled={disabled || additionalRepositories.length === 0}
          value={additionalRepositoryIds}
          onValueChange={(ids) =>
            onChange({
              ...value,
              repositoryProjectIds: [value.primaryT3ProjectId, ...ids],
            })
          }
        >
          <SelectTrigger
            id={`${idPrefix}-additional`}
            aria-label="Additional repositories"
            aria-describedby={`${idPrefix}-additional-description`}
            aria-invalid={unavailableAdditionalRepositoryIds.length > 0}
          >
            <SelectValue>
              {additionalRepositories.length === 0
                ? "No additional repositories linked"
                : additionalRepositorySummary}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {additionalRepositories.map((repository) => (
              <SelectItem
                key={repository.id}
                value={repository.id}
                disabled={lockedScope?.repositoryProjectIds.includes(repository.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 max-w-80 flex-1 truncate">{repository.title}</span>
                  {additionalRepositoryIds.includes(repository.id) ? (
                    <CheckIcon aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {unavailableAdditionalRepositoryIds.length > 0 ? (
          <p className="text-xs text-destructive" role="alert">
            Saved repositories are no longer linked. Remove them or link them again to continue.
          </p>
        ) : null}
      </div>
      {lockedScope ? (
        <p className="col-span-full text-xs text-muted-foreground">
          Prepared repositories and the primary are fixed here. You can add repositories. To remove
          one or change the primary, use Edit repositories in the ticket’s work area.
        </p>
      ) : null}
    </fieldset>
  );
}
