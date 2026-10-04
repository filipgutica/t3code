import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  type ThreadId,
  type WorkbenchAssignment,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import { changeRequestRepositoryUrl } from "@t3tools/shared/changeRequestUrl";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { ChevronDownIcon, MessageSquareIcon, RefreshCwIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { usePullRequestList } from "../state/pullRequests";
import { formatEnvironmentQueryError } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { WorkbenchLinkPullRequest } from "./WorkbenchLinkPullRequest";
import { WorkbenchPullRequestLink } from "./WorkbenchPullRequestLink";
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
  environmentId,
  ticketId,
  assignments,
  threadsById,
  ticketKey,
  workspaceRepositoryProjectIds,
  pullRequests,
  checkouts,
  onOpenThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: WorkbenchTicketId;
  readonly assignments: ReadonlyArray<WorkbenchAssignment>;
  readonly threadsById: ReadonlyMap<ThreadId, EnvironmentThreadShell>;
  readonly ticketKey: string | null;
  readonly workspaceRepositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly pullRequests: ReadonlyArray<WorkbenchTicketPullRequest>;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly checkouts: ReadonlyArray<{
    readonly projectId: ProjectId;
    readonly title: string;
    readonly cwd: string;
  }>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const checkout = useAtomValue(
    ticketCheckoutPullRequests(JSON.stringify({ environmentId, checkouts })),
  );
  const canSearch = ticketKey !== null && workspaceRepositoryProjectIds.length > 0;
  const search = usePullRequestList(
    canSearch
      ? [
          {
            environmentId,
            input: {
              state: "all",
              involvement: "all",
              projectIds: workspaceRepositoryProjectIds,
              query: ticketKey,
              limit: 50,
            },
          },
        ]
      : [],
  );
  // Hosts without text search must not associate an unfiltered repository listing with a Ticket.
  const matches =
    search.data?.entries.filter((entry) =>
      search.data?.providers.some(
        (provider) => provider.host === entry.host && provider.searchesOnHost,
      ),
    ) ?? [];
  const rows = mergeWorkbenchTicketPullRequests({
    threadPullRequests: pullRequests,
    matches,
    checkoutPullRequests: checkout.pullRequests,
  });
  const unsupported = search.data?.providers.some((provider) => !provider.searchesOnHost);

  return (
    <section className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/30">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            Pull requests{" "}
            <span className="ml-1 font-normal tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {canSearch
              ? `Linked PRs and ${ticketKey} mentions`
              : "Linked through threads or the ticket workspace"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <WorkbenchLinkPullRequest
            key={`${environmentId}:${ticketId}`}
            environmentId={environmentId}
            ticketId={ticketId}
            assignments={assignments}
            threadsById={threadsById}
          />
          {canSearch ? (
            <Button
              aria-label="Refresh ticket pull requests"
              size="icon-sm"
              variant="ghost"
              disabled={search.isPending}
              onClick={() => search.refresh()}
            >
              <RefreshCwIcon />
            </Button>
          ) : null}
          <Button
            aria-controls={contentId}
            aria-expanded={!collapsed}
            aria-label="Toggle pull requests"
            onClick={() => setCollapsed((value) => !value)}
            size="icon-xs"
            title="Toggle pull requests"
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon
              data-expanded={!collapsed}
              className="data-[expanded=true]:rotate-180"
            />
          </Button>
        </div>
      </div>
      <div id={contentId} hidden={collapsed} className="min-w-0 space-y-3 px-4 pb-4">
        {rows.length > 0 ? (
          <div className="divide-y divide-border/50">
            {rows.map((row) => (
              <WorkbenchTicketPullRequestRow
                key={row.pullRequest.url.toLowerCase()}
                environmentId={environmentId}
                ticketKey={ticketKey}
                row={row}
                onOpenThread={onOpenThread}
              />
            ))}
          </div>
        ) : null}
        <WorkbenchPullRequestSearchStatus
          search={search}
          checkout={checkout}
          unsupported={unsupported}
          hasRows={rows.length > 0}
        />
      </div>
    </section>
  );
}

function WorkbenchTicketPullRequestRow({
  environmentId,
  ticketKey,
  row,
  onOpenThread,
}: Pick<
  Parameters<typeof WorkbenchTicketPullRequests>[0],
  "environmentId" | "ticketKey" | "onOpenThread"
> & { row: ReturnType<typeof mergeWorkbenchTicketPullRequests>[number] }) {
  const { pullRequest, threadId, threadTitle, matchesTicket } = row;
  const repositoryUrl = changeRequestRepositoryUrl(pullRequest.url);
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
        {repositoryUrl ? (
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full break-words rounded-sm underline-offset-2 outline-none [overflow-wrap:anywhere] hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pullRequest.repository}
          </a>
        ) : (
          <span className="max-w-full break-words [overflow-wrap:anywhere]">
            {pullRequest.repository}
          </span>
        )}
        {matchesTicket ? <Badge variant="secondary">Mentions {ticketKey}</Badge> : null}
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
              <span className="min-w-0 truncate">Linked thread</span>
            </TooltipTrigger>
            <TooltipPopup className="max-w-72 break-words">
              Linked through thread: {threadTitle}
            </TooltipPopup>
          </Tooltip>
        ) : !matchesTicket ? (
          <Badge variant="secondary">Ticket workspace</Badge>
        ) : null}
      </div>
    </div>
  );
}

function WorkbenchPullRequestSearchStatus({
  search,
  checkout,
  unsupported,
  hasRows,
}: {
  search: ReturnType<typeof usePullRequestList>;
  checkout: {
    pullRequests: ReadonlyArray<TicketPullRequestReference>;
    errors: ReadonlyArray<string>;
    isPending: boolean;
  };
  unsupported: boolean | undefined;
  hasRows: boolean;
}) {
  return (
    <>
      {search.isPending ? (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          Searching repositories…
        </p>
      ) : null}
      {checkout.isPending ? (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          Checking ticket workspace pull requests…
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
      {search.error ? (
        <p
          role="alert"
          className="break-words text-xs leading-5 text-destructive [overflow-wrap:anywhere]"
        >
          PR search unavailable: {search.error}
        </p>
      ) : null}
      {search.data?.errors.map((error) => (
        <p
          role="alert"
          key={error.projectId}
          className="break-words text-xs leading-5 text-destructive [overflow-wrap:anywhere]"
        >
          {error.projectTitle}: {error.message}
        </p>
      ))}
      {unsupported ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Ticket-key search is unavailable for some repository hosts.
        </p>
      ) : null}
      {!hasRows &&
      !search.isPending &&
      !checkout.isPending &&
      checkout.errors.length === 0 &&
      !search.error &&
      !unsupported &&
      (search.data?.errors.length ?? 0) === 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          No pull requests found for this ticket.
        </p>
      ) : null}
      {search.data?.truncated ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Showing up to 50 matches per repository. More may be available on the host.
        </p>
      ) : null}
    </>
  );
}
