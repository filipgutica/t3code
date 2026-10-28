import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchReference,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { MessageSquareIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { formatEnvironmentQueryError } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { WorkbenchLinkPullRequest } from "./WorkbenchLinkPullRequest";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
import { useWorkbenchReferenceCommands } from "./WorkbenchReferences";
import {
  WorkbenchTicketPanelHeader,
  useWorkbenchTicketPanelCollapsed,
} from "./WorkbenchTicketPanelHeader";
import {
  mergeWorkbenchTicketPullRequests,
  type TicketPullRequestReference,
  type WorkbenchTicketPullRequest,
} from "./workbenchPullRequests.logic";

const CheckoutTargets = Schema.Struct({
  environmentId: EnvironmentId,
  checkouts: Schema.Array(
    Schema.Struct({ projectId: ProjectId, title: Schema.String, cwd: Schema.String }),
  ),
});
const decodeCheckoutTargets = Schema.decodeUnknownSync(CheckoutTargets);

const ticketCheckoutPullRequests = Atom.family((key: string) => {
  const { environmentId, checkouts } = decodeCheckoutTargets(JSON.parse(key));
  return Atom.make((get) => {
    const pullRequests: TicketPullRequestReference[] = [];
    const errors: string[] = [];
    let isPending = false;
    for (const { projectId, title, cwd } of checkouts) {
      const result = get(vcsEnvironment.status({ environmentId, input: { cwd } }));
      if (result._tag === "Failure")
        errors.push(`${title}: ${formatEnvironmentQueryError(result.cause)}`);
      const status = Option.getOrNull(AsyncResult.value(result));
      isPending ||= status === null && result.waiting;
      if (status?.pr) pullRequests.push({ ...status.pr, projectId, repository: title });
    }
    return { pullRequests, errors, isPending };
  });
});

export function WorkbenchTicketPullRequests({
  readOnly = false,
  environmentId,
  ticketId,
  assignments,
  threadsById,
  references,
  pullRequests,
  checkouts,
  onOpenThread,
}: {
  readonly readOnly?: boolean;
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  /** The Ticket's `github_pull_request` References. */
  readonly references: ReadonlyArray<WorkbenchReference>;
  readonly pullRequests: ReadonlyArray<WorkbenchTicketPullRequest>;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly checkouts: ReadonlyArray<{
    readonly projectId: ProjectId;
    readonly title: string;
    readonly cwd: string;
  }>;
}) {
  const [collapsed, setCollapsed] = useWorkbenchTicketPanelCollapsed("pull-requests");
  const contentId = useId();
  const checkout = useAtomValue(
    ticketCheckoutPullRequests(JSON.stringify({ environmentId, checkouts })),
  );
  const referenceCommands = useWorkbenchReferenceCommands(environmentId);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const rows = mergeWorkbenchTicketPullRequests({
    threadPullRequests: pullRequests,
    checkoutPullRequests: checkout.pullRequests,
    references,
  });
  const canUnlink = !readOnly && referenceCommands.canEdit;
  const unlink = async (reference: WorkbenchReference) => {
    setUnlinking(reference.url);
    setUnlinkError(
      await referenceCommands
        .remove({ ticketId, url: reference.url })
        .finally(() => setUnlinking(null)),
    );
  };

  return (
    <section className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <WorkbenchTicketPanelHeader
        title="Pull requests"
        count={rows.length}
        description="Linked through threads, references, or the ticket work area"
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        contentId={contentId}
        actions={
          !readOnly ? (
            <WorkbenchLinkPullRequest
              key={`${environmentId}:${ticketId}`}
              environmentId={environmentId}
              ticketId={ticketId}
              assignments={assignments}
              threadsById={threadsById}
            />
          ) : null
        }
      />
      <div id={contentId} hidden={collapsed} className="min-w-0 space-y-3 px-4 pb-4">
        {rows.length > 0 ? (
          <div className="divide-y divide-border/50">
            {rows.map((row) => (
              <WorkbenchTicketPullRequestRow
                key={row.pullRequest.url.toLowerCase()}
                environmentId={environmentId}
                row={row}
                onOpenThread={onOpenThread}
                unlinkDisabled={canUnlink ? unlinking !== null : null}
                onUnlink={(reference) => void unlink(reference)}
              />
            ))}
          </div>
        ) : null}
        {unlinkError ? (
          <p
            role="alert"
            className="break-words text-xs leading-5 text-destructive [overflow-wrap:anywhere]"
          >
            {unlinkError}
          </p>
        ) : null}
        <WorkbenchPullRequestCheckoutStatus checkout={checkout} hasRows={rows.length > 0} />
      </div>
    </section>
  );
}

function WorkbenchTicketPullRequestRow({
  environmentId,
  row,
  onOpenThread,
  unlinkDisabled,
  onUnlink,
}: Pick<Parameters<typeof WorkbenchTicketPullRequests>[0], "environmentId" | "onOpenThread"> & {
  row: ReturnType<typeof mergeWorkbenchTicketPullRequests>[number];
  /** `null` hides Unlink, as for a read-only Ticket. */
  unlinkDisabled: boolean | null;
  onUnlink: (reference: WorkbenchReference) => void;
}) {
  const { pullRequest, threadId, threadTitle, reference } = row;
  return (
    <div key={pullRequest.url.toLowerCase()} className="min-w-0 py-3 first:pt-0 last:pb-0">
      <WorkbenchPullRequestLink
        environmentId={environmentId}
        pullRequest={pullRequest}
        linkedThread={
          threadId !== null && threadTitle !== null
            ? { threadId, title: threadTitle, onOpen: () => onOpenThread(threadId) }
            : undefined
        }
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1 text-xs leading-5 text-muted-foreground">
        <WorkbenchTicketPullRequestRepository pullRequest={pullRequest} />
        {threadId !== null && threadTitle !== null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge
                  render={<button type="button" />}
                  variant="outline"
                  size="control"
                  className="max-w-full shrink"
                  aria-label={`Open linked Thread: ${threadTitle}`}
                  onClick={() => onOpenThread(threadId)}
                />
              }
            >
              <MessageSquareIcon />
              <span className="min-w-0 truncate">{threadTitle}</span>
            </TooltipTrigger>
            <TooltipPopup className="max-w-72 break-words">
              Linked through thread: {threadTitle}
            </TooltipPopup>
          </Tooltip>
        ) : reference === null ? (
          <Badge variant="secondary">Work area</Badge>
        ) : null}
        {reference !== null && unlinkDisabled !== null ? (
          <Button
            size="xs"
            type="button"
            variant="ghost"
            disabled={unlinkDisabled}
            aria-label={`Unlink pull request #${pullRequest.number} reference`}
            onClick={() => onUnlink(reference)}
          >
            Unlink
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function WorkbenchTicketPullRequestRepository({
  pullRequest,
}: {
  pullRequest: ReturnType<typeof mergeWorkbenchTicketPullRequests>[number]["pullRequest"];
}) {
  if (pullRequest.title === undefined || pullRequest.title === pullRequest.repository) return null;
  const repositoryUrl = sourceControlClients.parseChangeRequestUrl(pullRequest.url)?.link
    .repositoryUrl;
  return repositoryUrl ? (
    <a
      href={repositoryUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="max-w-full break-words rounded-sm underline-offset-2 outline-none [overflow-wrap:anywhere] hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {pullRequest.repository}
    </a>
  ) : (
    <span className="max-w-full break-words [overflow-wrap:anywhere]">
      {pullRequest.repository}
    </span>
  );
}

function WorkbenchPullRequestCheckoutStatus({
  checkout,
  hasRows,
}: {
  checkout: {
    pullRequests: ReadonlyArray<TicketPullRequestReference>;
    errors: ReadonlyArray<string>;
    isPending: boolean;
  };
  hasRows: boolean;
}) {
  return (
    <>
      {checkout.isPending ? (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          Checking ticket work area pull requests…
        </p>
      ) : null}
      {checkout.errors.map((error) => (
        <p
          role="alert"
          key={error}
          className="break-words text-xs leading-5 text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      ))}
      {!hasRows && !checkout.isPending && checkout.errors.length === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          No pull requests found for this ticket.
        </p>
      ) : null}
    </>
  );
}
