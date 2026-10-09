import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import "./WorkbenchTicketProposal.css";
import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadId,
  WorkbenchTicketDraftFields,
} from "@t3tools/contracts";
import { SparklesIcon } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
  ChatMarkdownCodeBlockRendererContext,
  type ChatMarkdownCodeBlock,
} from "../components/ChatMarkdown";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useProjects, useThreadProjection } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import type { Project } from "../types";
import { WorkbenchDescription } from "./WorkbenchDescription";
import { workbenchEnvironment } from "./state";
import { getWorkbenchContextForThread } from "./workbench.logic";
import {
  findTicketDraftSuggestion,
  readTicketDraftSuggestion,
  type WorkbenchSuggestionMessage,
  type WorkbenchTicketDraftSuggestion,
} from "./workbenchTicketDraft.logic";

const EMPTY_MESSAGES: ReadonlyArray<WorkbenchSuggestionMessage> = [];

export function WorkbenchRepositoryBadges({
  label,
  ids,
  primaryId,
  projects,
}: {
  readonly label: string;
  readonly ids: ReadonlyArray<string>;
  readonly primaryId: string | null;
  readonly projects: ReadonlyArray<Project>;
}) {
  return (
    <ul aria-label={label} data-workbench-ticket-repositories className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <Badge
          key={id}
          render={<li data-workbench-ticket-repository-badge />}
          variant="outline"
          size="lg"
        >
          <span className="max-w-48 truncate">
            {projects.find((project) => project.id === id)?.title ?? "Repository"}
          </span>
          {id === primaryId ? <span className="text-muted-foreground">· Primary</span> : null}
        </Badge>
      ))}
    </ul>
  );
}

function ProposalCard({
  suggestion,
  linkedProjects,
  status,
  replacesContent,
  canApply,
  onApply,
  onDismiss,
}: {
  readonly suggestion: WorkbenchTicketDraftSuggestion;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly status: "ready" | "applied" | "dismissed" | "superseded" | "saved";
  readonly replacesContent: boolean;
  readonly canApply: boolean;
  readonly onApply?: () => void;
  readonly onDismiss?: () => void;
}) {
  return (
    <section
      aria-label="Proposed ticket"
      data-workbench-ticket-proposal
      className="my-3 flex min-w-0 flex-col gap-2.5 rounded-lg border border-primary/25 bg-primary/5 p-3 text-foreground"
    >
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-4 text-primary" aria-hidden />
        <h3 data-workbench-ticket-proposal-heading className="text-sm font-medium">
          Proposed ticket
        </h3>
      </div>
      <p data-workbench-ticket-proposal-copy className="break-words text-sm font-medium">
        {suggestion.title}
      </p>
      <WorkbenchRepositoryBadges
        label="Proposed repositories"
        ids={suggestion.repositoryProjectIds}
        primaryId={suggestion.primaryT3ProjectId}
        projects={linkedProjects}
      />
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Preview description
        </summary>
        <div className="mt-2">
          <WorkbenchDescription markdown={suggestion.markdown} />
        </div>
      </details>
      {status === "ready" ? (
        <>
          <p data-workbench-ticket-proposal-copy className="text-xs text-muted-foreground">
            {replacesContent
              ? "Applying replaces the current title, description, and repositories."
              : "Apply fills the draft. You can edit every field afterwards."}
          </p>
          <div className="flex gap-2">
            <Button size="xs" disabled={!canApply} onClick={onApply}>
              Apply to draft
            </Button>
            <Button size="xs" variant="outline" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <p
          role="status"
          data-workbench-ticket-proposal-copy
          className="text-xs text-muted-foreground"
        >
          {status === "applied"
            ? "Applied to draft"
            : status === "dismissed"
              ? "Dismissed"
              : status === "saved"
                ? "Ticket already created"
                : "Replaced by a later response"}
        </p>
      )}
    </section>
  );
}

/** Saved planning proposals keep their presentation when the same Thread starts implementation. */
export function WorkbenchTicketProposalHistory({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  const { data } = useEnvironmentQuery(
    threadRef === null
      ? null
      : workbenchEnvironment.snapshot({ environmentId: threadRef.environmentId, input: {} }),
  );
  const projects = useProjects();
  const hasTicket =
    threadRef !== null && getWorkbenchContextForThread(data ?? null, threadRef.threadId) !== null;
  const linkedProjects = useMemo(
    () => projects.filter((project) => project.environmentId === threadRef?.environmentId),
    [projects, threadRef?.environmentId],
  );
  const knownRepositoryProjectIds = useMemo(
    () => new Set(linkedProjects.map((project) => project.id)),
    [linkedProjects],
  );
  const renderBlock = useCallback(
    (block: ChatMarkdownCodeBlock) => {
      if (
        !hasTicket ||
        block.language !== "workbench-ticket-draft" ||
        block.messageId === undefined ||
        block.sourceOffset === undefined ||
        block.isStreaming ||
        !block.isComplete
      )
        return undefined;
      const suggestion = readTicketDraftSuggestion({
        code: block.code,
        messageId: block.messageId,
        sourceOffset: block.sourceOffset,
        knownRepositoryProjectIds,
      });
      if (suggestion === null) return undefined;
      return (
        <ProposalCard
          suggestion={suggestion}
          linkedProjects={linkedProjects}
          status="saved"
          replacesContent={false}
          canApply={false}
        />
      );
    },
    [hasTicket, knownRepositoryProjectIds, linkedProjects],
  );
  return (
    <ChatMarkdownCodeBlockRendererContext value={renderBlock}>
      {children}
    </ChatMarkdownCodeBlockRendererContext>
  );
}

const proposalStatus = ({
  suggestion,
  fields,
  ticketCreated,
  handled,
  latest,
}: {
  readonly suggestion: WorkbenchTicketDraftSuggestion;
  readonly fields: Pick<
    WorkbenchTicketDraftFields,
    "title" | "markdown" | "repositoryProjectIds" | "primaryT3ProjectId"
  >;
  readonly ticketCreated: boolean;
  readonly handled: "applied" | "dismissed" | undefined;
  readonly latest: WorkbenchTicketDraftSuggestion | null;
}) => {
  if (ticketCreated) return "saved";
  if (handled) return handled;
  const alreadyApplied =
    suggestion.title === fields.title.trim() &&
    suggestion.markdown === fields.markdown.trim() &&
    suggestion.primaryT3ProjectId === fields.primaryT3ProjectId &&
    suggestion.repositoryProjectIds.length === fields.repositoryProjectIds.length &&
    suggestion.repositoryProjectIds.every((id) => fields.repositoryProjectIds.includes(id));
  if (alreadyApplied) return "applied";
  const isLatest =
    latest?.messageId === suggestion.messageId && latest.sourceOffset === suggestion.sourceOffset;
  return isLatest ? "ready" : "superseded";
};

/** Only assistant blocks in this Workbench Thread become ticket UI; native messages stay intact. */
export function WorkbenchTicketProposalRenderer({
  environmentId,
  threadId,
  linkedProjects,
  fields,
  ticketCreated,
  canApply,
  onApply,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly linkedProjects: ReadonlyArray<Project>;
  readonly fields: Pick<
    WorkbenchTicketDraftFields,
    "title" | "markdown" | "repositoryProjectIds" | "primaryT3ProjectId"
  >;
  readonly ticketCreated: boolean;
  readonly canApply: boolean;
  readonly onApply?: (suggestion: WorkbenchTicketDraftSuggestion) => void;
  readonly children: ReactNode;
}) {
  const projection = useThreadProjection(scopeThreadRef(environmentId, threadId));
  const messages = projection?.projection.messages ?? EMPTY_MESSAGES;
  const knownRepositoryProjectIds = useMemo(
    () => new Set(linkedProjects.map((project) => project.id)),
    [linkedProjects],
  );
  const latest = useMemo(
    () => findTicketDraftSuggestion({ messages, knownRepositoryProjectIds }),
    [messages, knownRepositoryProjectIds],
  );
  const [handled, setHandled] = useState<ReadonlyMap<string, "applied" | "dismissed">>(new Map());
  const renderBlock = useCallback(
    (block: ChatMarkdownCodeBlock) => {
      if (block.language !== "workbench-ticket-draft" || block.messageId === undefined) {
        return undefined;
      }
      if (block.isStreaming) {
        return (
          <p role="status" className="my-3 text-sm text-muted-foreground">
            Preparing proposed ticket…
          </p>
        );
      }
      const suggestion =
        block.isComplete && block.sourceOffset !== undefined
          ? readTicketDraftSuggestion({
              code: block.code,
              messageId: block.messageId,
              sourceOffset: block.sourceOffset,
              knownRepositoryProjectIds,
            })
          : null;
      if (suggestion === null) {
        return (
          <p role="status" className="my-3 text-sm text-muted-foreground">
            This proposal is incomplete or has invalid repository details. Ask the agent to try
            again.
          </p>
        );
      }
      const key = `${suggestion.messageId}:${suggestion.sourceOffset}`;
      const status = proposalStatus({
        suggestion,
        fields,
        ticketCreated,
        handled: handled.get(key),
        latest,
      });
      return (
        <ProposalCard
          suggestion={suggestion}
          linkedProjects={linkedProjects}
          status={status}
          replacesContent={fields.title.trim().length > 0 || fields.markdown.trim().length > 0}
          canApply={canApply && onApply !== undefined}
          onApply={() => {
            if (!canApply || !onApply) return;
            onApply(suggestion);
            setHandled((previous) => new Map(previous).set(key, "applied"));
          }}
          onDismiss={() => setHandled((previous) => new Map(previous).set(key, "dismissed"))}
        />
      );
    },
    [
      canApply,
      ticketCreated,
      fields,
      handled,
      knownRepositoryProjectIds,
      latest,
      linkedProjects,
      onApply,
    ],
  );
  return (
    <ChatMarkdownCodeBlockRendererContext value={renderBlock}>
      {children}
    </ChatMarkdownCodeBlockRendererContext>
  );
}
