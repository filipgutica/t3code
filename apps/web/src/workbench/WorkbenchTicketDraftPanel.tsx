import type { ProjectId, WorkbenchTicketDraftFields } from "@t3tools/contracts";
import { useId, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { Project } from "../types";
import { WorkbenchBriefAskButton, WorkbenchBriefBody } from "./WorkbenchBriefReview";
import { WorkbenchCreateTicketRepositories } from "./WorkbenchForms";
import { WorkbenchProvenanceBadge, type WorkbenchProvenanceSource } from "./WorkbenchReferences";
import { WorkbenchReviewBar } from "./WorkbenchReviewBar";
import { WorkbenchWordDiff } from "./WorkbenchMarkdownReview";
import type { useWorkbenchBriefReview } from "./useWorkbenchBriefReview";

interface DraftFieldContext {
  readonly linkedProjects: ReadonlyArray<Project>;
}

const getCreateBlocker = ({
  title,
  hasRepository,
}: {
  readonly title: string;
  readonly hasRepository: boolean;
}): string | null => {
  if (title.trim().length === 0) return "Add a title to create the ticket.";
  if (!hasRepository) return "Select a repository to create the ticket.";
  return null;
};

/**
 * Validates the draft's chosen repositories against the current Board.
 * `effectiveFields` is what Create ticket sends; `blocker` explains why it is disabled.
 */
export const getTicketDraftCreateState = ({
  fields,
  linkedProjects,
}: DraftFieldContext & { readonly fields: WorkbenchTicketDraftFields }) => {
  const repositories = {
    selectedRepositoryProjectIds: fields.repositoryProjectIds.filter((id) =>
      linkedProjects.some((project) => project.id === id),
    ),
  };
  const blocker = getCreateBlocker({
    title: fields.title,
    hasRepository: repositories.selectedRepositoryProjectIds.length > 0,
  });
  const effectiveFields: WorkbenchTicketDraftFields = {
    ...fields,
    repositoryProjectIds: repositories.selectedRepositoryProjectIds,
  };
  return { repositories, blocker, effectiveFields };
};

/** Adapts a patch callback to the `Dispatch<SetStateAction>` setters the manual form's fields expect. */
const asSetter =
  <Value,>(current: Value, set: (value: Value) => void): Dispatch<SetStateAction<Value>> =>
  (action) =>
    set(typeof action === "function" ? (action as (previous: Value) => Value)(current) : action);

function DraftBriefView({
  markdown,
  updatedBy,
  briefReview,
}: {
  readonly markdown: string;
  readonly updatedBy: WorkbenchProvenanceSource | null;
  readonly briefReview: ReturnType<typeof useWorkbenchBriefReview>;
}) {
  const headingId = useId();
  const { review } = briefReview;
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <h3 id={headingId} className="shrink-0 font-medium text-sm">
          Brief
        </h3>
        {updatedBy !== null ? (
          <WorkbenchProvenanceBadge
            source={updatedBy}
            pressed={briefReview.diffShown}
            onToggle={briefReview.toggleDiff}
          />
        ) : null}
        <span className="flex-1" />
        {markdown.trim() ? (
          <WorkbenchBriefAskButton briefReview={briefReview} variant="ghost" />
        ) : null}
      </div>
      {review ? (
        <WorkbenchReviewBar
          review={review}
          source={updatedBy}
          editedAt={briefReview.contentUpdatedAt}
          permitted={briefReview.permitted}
          className="rounded-lg px-3 py-2"
        />
      ) : null}
      <WorkbenchBriefBody
        briefReview={briefReview}
        markdown={markdown}
        empty="No brief yet. Ask the agent to write one."
      />
    </section>
  );
}

export function WorkbenchTicketDraftFieldsForm({
  fields,
  disabled,
  updatedBy,
  briefReview,
  references,
  onChange,
  ...context
}: DraftFieldContext & {
  readonly fields: WorkbenchTicketDraftFields;
  readonly disabled: boolean;
  /** Who last wrote the title or brief, if an agent or Ask for change did. */
  readonly updatedBy: WorkbenchProvenanceSource | null;
  readonly briefReview: ReturnType<typeof useWorkbenchBriefReview>;
  /** Sits after the brief and keeps its own read-only rules, outside the form's fieldsets. */
  readonly references: ReactNode;
  readonly onChange: (patch: Partial<WorkbenchTicketDraftFields>) => void;
}) {
  const { repositories } = getTicketDraftCreateState({ fields, ...context });
  const titleWords = briefReview.review?.diffShown ? briefReview.review.titleWords : null;
  return (
    <div className="min-w-0 space-y-5">
      <fieldset disabled={disabled} className="min-w-0">
        <div className="space-y-1.5">
          {/* Like the brief, the title shows its diff in place of the editor until the diff is hidden. */}
          {titleWords ? (
            <>
              <Label>Title</Label>
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                <WorkbenchWordDiff segments={titleWords} />
              </p>
            </>
          ) : (
            <>
              <Label htmlFor="workbench-draft-title">Title</Label>
              <Input
                id="workbench-draft-title"
                placeholder="What needs doing?"
                value={fields.title}
                onChange={(event) => onChange({ title: event.currentTarget.value })}
              />
            </>
          )}
        </div>
      </fieldset>
      {/* Its actions follow the review's own gates, so a read-only viewer can still toggle the diff. */}
      <DraftBriefView markdown={fields.markdown} updatedBy={updatedBy} briefReview={briefReview} />
      {references}
      <fieldset disabled={disabled} className="min-w-0 space-y-5">
        <WorkbenchCreateTicketRepositories
          linkedProjects={context.linkedProjects}
          selectedRepositoryProjectIds={repositories.selectedRepositoryProjectIds}
          setRepositoryProjectIds={asSetter<ReadonlyArray<ProjectId>>(
            repositories.selectedRepositoryProjectIds,
            (ids) => onChange({ repositoryProjectIds: ids }),
          )}
        />
      </fieldset>
    </div>
  );
}
