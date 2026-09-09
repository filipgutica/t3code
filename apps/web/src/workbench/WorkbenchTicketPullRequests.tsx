import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "../components/ui/button";
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
  repositoryProjectIds,
  pullRequests,
  checkouts,
}: {
  readonly environmentId: EnvironmentId;
  readonly ticketKey: string | null;
  readonly repositoryProjectIds: ReadonlyArray<ProjectId>;
  readonly pullRequests: ReadonlyArray<WorkbenchTicketPullRequest>;
  readonly checkouts: ReadonlyArray<{
    readonly projectId: ProjectId;
    readonly title: string;
    readonly cwd: string;
  }>;
}) {
  const checkout = useAtomValue(
    ticketCheckoutPullRequests(JSON.stringify({ environmentId, checkouts })),
  );
  const canSearch = ticketKey !== null && repositoryProjectIds.length > 0;
  const search = usePullRequestList(
    canSearch
      ? [
          {
            environmentId,
            input: {
              state: "all",
              involvement: "all",
              projectIds: repositoryProjectIds,
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
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            Pull Requests{" "}
            <span className="ml-1 font-normal tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {canSearch
              ? `Checkout links and repository matches for ${ticketKey}.`
              : "From this Ticket’s Threads and checkouts."}
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
      <div className="space-y-3 px-4 py-3">
        {rows.map(({ pullRequest, threadTitle, matchesTicket }) => (
          <div key={pullRequest.url.toLowerCase()} className="min-w-0">
            <WorkbenchPullRequestLink environmentId={environmentId} pullRequest={pullRequest} />
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {pullRequest.repository}
            </p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
              {matchesTicket
                ? `Matches ${ticketKey}`
                : threadTitle
                  ? `From ${threadTitle}`
                  : "Current checkout"}
            </p>
          </div>
        ))}
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
