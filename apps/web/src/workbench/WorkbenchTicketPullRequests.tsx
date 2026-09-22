import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ProjectId, type ThreadId } from "@t3tools/contracts";
import { changeRequestRepositoryUrl } from "@t3tools/shared/changeRequestUrl";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { MessageSquareIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { usePullRequestList } from "../state/pullRequests";
import { formatEnvironmentQueryError } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
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
  ticketKey,
  workspaceRepositoryProjectIds,
  pullRequests,
  checkouts,
  onOpenThread,
}: {
  readonly environmentId: EnvironmentId;
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

  if (!canSearch && rows.length === 0 && !checkout.isPending && checkout.errors.length === 0)
    return null;

  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 xl:min-h-0 xl:flex-1">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            Pull Requests{" "}
            <span className="ml-1 font-normal tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {canSearch
              ? `Linked PRs and Workspace repository mentions of ${ticketKey}.`
              : "From this Ticket’s Threads and prepared workspace."}
          </p>
        </div>
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
      </div>
      <div className="min-h-0 space-y-2 px-3 py-2.5 xl:overflow-y-auto xl:overscroll-contain">
        {rows.map(({ pullRequest, threadId, threadTitle, matchesTicket }) => {
          const repositoryUrl = changeRequestRepositoryUrl(pullRequest.url);
          return (
            <div key={pullRequest.url.toLowerCase()} className="min-w-0">
              <WorkbenchPullRequestLink environmentId={environmentId} pullRequest={pullRequest} />
              <p className="mt-1.5 break-words px-3 text-xs leading-5 text-muted-foreground">
                {repositoryUrl ? (
                  <a
                    href={repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {pullRequest.repository}
                  </a>
                ) : (
                  pullRequest.repository
                )}
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 px-3 pb-1">
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
                      <span className="min-w-0 truncate">Linked Thread</span>
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
        })}
        {search.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            Searching repositories…
          </p>
        ) : null}
        {checkout.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            Checking checkout pull requests…
          </p>
        ) : null}
        {checkout.errors.map((error) => (
          <p role="alert" key={error} className="break-words text-xs text-destructive">
            {error}
          </p>
        ))}
        {search.error ? (
          <p role="alert" className="break-words text-xs text-destructive">
            PR search unavailable: {search.error}
          </p>
        ) : null}
        {search.data?.errors.map((error) => (
          <p role="alert" key={error.projectId} className="break-words text-xs text-destructive">
            {error.projectTitle}: {error.message}
          </p>
        ))}
        {unsupported ? (
          <p className="text-xs text-muted-foreground">
            Ticket-key search is unavailable for some repository hosts.
          </p>
        ) : null}
        {rows.length === 0 &&
        !search.isPending &&
        !checkout.isPending &&
        checkout.errors.length === 0 &&
        !search.error &&
        !unsupported &&
        search.data?.errors.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pull requests found.</p>
        ) : null}
        {search.data?.truncated ? (
          <p className="text-xs text-muted-foreground">
            Showing up to 50 matches per repository. More may be available on the host.
          </p>
        ) : null}
      </div>
    </section>
  );
}
