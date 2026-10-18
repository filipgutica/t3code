import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveLinkPullRequestInput } from "@t3tools/client-runtime/pull-request-link-input";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PullRequestListEntry,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  canonicalRepositoryKey,
  sourceControlRepositorySelector,
} from "@t3tools/shared/sourceControl";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { usePullRequestLinking } from "../hooks/usePullRequestLinking";
import { useProjects } from "../state/entities";
import {
  linkedPullRequestDetailAtom,
  usePullRequestList,
  type MergedPullRequestListView,
} from "../state/pullRequests";
import { useEnvironmentQuery } from "../state/query";
import { useDebouncedValue } from "../state/queries";

const CANDIDATE_LIMIT = 50;

type Candidate = Pick<
  PullRequestListEntry,
  "host" | "repository" | "number" | "title" | "url" | "state" | "isDraft"
>;

interface RowProps {
  readonly thread: EnvironmentThreadShell;
  readonly linking: ReturnType<typeof usePullRequestLinking>;
  readonly selectedUrl: string | null;
  readonly pending: boolean;
  readonly onSelect: (url: string) => void;
}

/**
 * Workbench's PR picker for one native Thread: browse and search the environment's PRs, find an
 * exact number across its repositories, or paste a URL. Linking stays the native Thread mutation.
 */
export function WorkbenchPullRequestPicker({
  thread,
  finalFocus,
  onClose,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly finalFocus: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}) {
  const threadRef: ScopedThreadRef = { environmentId: thread.environmentId, threadId: thread.id };
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const linking = usePullRequestLinking(thread.environmentId);
  const normalizedQuery = query.trim().replace(/^#(?=\d+$)/u, "");
  const sentQuery = useDebouncedValue(normalizedQuery, 300);

  const pasted = resolvePastedUrl(query, linking.canLink);
  const selectedLink = pasted === null ? selectedUrl : pasted.url;

  const submit = async () => {
    if (selectedLink === null || pending) return;
    setSubmitError(null);
    setPending(true);
    const result = await settlePromise(() => linking.changeLink(threadRef, selectedLink, true));
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setSubmitError(error instanceof Error ? error.message : "Could not link the pull request.");
      return;
    }
    onClose();
  };
  const rowProps = { thread, linking, selectedUrl, pending, onSelect: setSelectedUrl };

  return (
    <Dialog open onOpenChange={(next) => (next || pending ? undefined : onClose())}>
      <DialogPopup className="max-w-xl" initialFocus={inputRef} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>Link pull request</DialogTitle>
          <DialogDescription>
            Choose a pull request to link to the Thread “{thread.title}”.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <label htmlFor={searchId} className="text-sm font-medium">
              Search pull requests
            </label>
            <Input
              id={searchId}
              ref={inputRef}
              type="search"
              placeholder="Search titles or PR numbers, or paste a URL"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedUrl(null);
                setSubmitError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void submit();
              }}
            />
          </div>
          {pasted === null ? (
            <PullRequestResults
              environmentId={thread.environmentId}
              sentQuery={sentQuery}
              debouncing={normalizedQuery !== sentQuery}
              rowProps={rowProps}
            />
          ) : (
            <p
              className={
                pasted.url === null
                  ? "text-destructive text-xs"
                  : "truncate text-muted-foreground text-xs"
              }
            >
              {pasted.message}
            </p>
          )}
          {submitError ? (
            <p role="alert" className="text-destructive text-xs">
              {submitError}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={pending || selectedLink === null}
          >
            {pending ? "Linking..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** A pasted URL skips browsing; the native resolver explains URLs this environment cannot read. */
function resolvePastedUrl(
  query: string,
  canLink: (url: string) => boolean,
): { readonly url: string | null; readonly message: string } | null {
  if (parseChangeRequestUrl(query.trim()) === null) return null;
  const resolved = resolveLinkPullRequestInput({
    reference: query,
    project: null,
    hasProject: (candidate) => canLink(candidate.url),
  });
  if (resolved === null) return null;
  if ("error" in resolved) return { url: null, message: resolved.error };
  const { host, repository, number, url } = resolved.link;
  return { url, message: `${host}/${repository} #${number}` };
}

function PullRequestResults({
  environmentId,
  sentQuery,
  debouncing,
  rowProps,
}: {
  readonly environmentId: EnvironmentId;
  readonly sentQuery: string;
  readonly debouncing: boolean;
  readonly rowProps: RowProps;
}) {
  const number = /^\d+$/u.test(sentQuery) ? Number(sentQuery) : null;
  return (
    <>
      <p className="text-xs text-muted-foreground">From projects in this environment</p>
      {debouncing ? (
        <ResultsFrame>
          <ResultsStatus>Searching pull requests…</ResultsStatus>
        </ResultsFrame>
      ) : number !== null && Number.isSafeInteger(number) && number > 0 ? (
        <NumberResults environmentId={environmentId} number={number} rowProps={rowProps} />
      ) : (
        <SearchResults environmentId={environmentId} sentQuery={sentQuery} rowProps={rowProps} />
      )}
    </>
  );
}

function ResultsFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label="Available pull requests"
      className="max-h-64 overflow-y-auto rounded-md border border-border/60"
    >
      {children}
    </div>
  );
}

function ResultsStatus({ children }: { readonly children: ReactNode }) {
  return (
    <p role="status" className="p-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function SearchResults({
  environmentId,
  sentQuery,
  rowProps,
}: {
  readonly environmentId: EnvironmentId;
  readonly sentQuery: string;
  readonly rowProps: RowProps;
}) {
  const search = usePullRequestList([
    {
      environmentId,
      input: {
        state: sentQuery ? "all" : "open",
        involvement: "all",
        limit: CANDIDATE_LIMIT,
        ...(sentQuery ? { query: sentQuery.slice(0, 200) } : {}),
      },
    },
  ]);
  const candidates = searchCandidates(search, sentQuery, rowProps.linking.canLink);
  const error = searchErrorMessage(search);
  if (search.isPending && search.data === null)
    return (
      <ResultsFrame>
        <ResultsStatus>
          {sentQuery ? "Searching pull requests…" : "Loading pull requests…"}
        </ResultsStatus>
      </ResultsFrame>
    );
  if (candidates.length === 0)
    return (
      <ResultsFrame>
        <ResultsStatus>
          {error ??
            (sentQuery
              ? "No matching pull requests found."
              : "No open pull requests found in this environment.")}
        </ResultsStatus>
      </ResultsFrame>
    );
  return (
    <>
      <ResultsFrame>
        <ul>
          {candidates.slice(0, CANDIDATE_LIMIT).map((entry) => (
            <CandidateRow
              key={`${entry.host}/${entry.repository}#${entry.number}`}
              entry={entry}
              {...rowProps}
            />
          ))}
        </ul>
      </ResultsFrame>
      {error ? (
        <p role="status" className="text-xs text-muted-foreground">
          {error}
        </p>
      ) : null}
      {search.data?.truncated || candidates.length > CANDIDATE_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          More pull requests may be available. Paste a URL if yours is not shown.
        </p>
      ) : null}
    </>
  );
}

/** Hosts without text search return a recent page; narrow those rows locally without claiming
 * the page contains every match. A pasted URL still reaches older PRs. */
function searchCandidates(
  search: MergedPullRequestListView,
  sentQuery: string,
  canLink: (url: string) => boolean,
): ReadonlyArray<Candidate> {
  const needle = sentQuery.toLowerCase();
  return (search.data?.entries ?? []).filter(
    (entry) =>
      canLink(entry.url) &&
      (!sentQuery ||
        search.data?.providers.some(
          (provider) => provider.host === entry.host && provider.searchesOnHost,
        ) ||
        [entry.title, entry.repository, entry.host, String(entry.number)].some((field) =>
          field.toLowerCase().includes(needle),
        )),
  );
}

function searchErrorMessage(search: MergedPullRequestListView): string | null {
  if (search.error)
    return "Could not browse pull requests here. Check the Git host connection in this environment, or paste a PR URL.";
  const unavailable = search.data?.providers.find((provider) => !provider.configured);
  if (unavailable)
    return `${unavailable.host}: ${unavailable.detail ?? "Pull requests cannot be browsed on this host."}`;
  const failure = search.data?.errors[0];
  return failure ? `Could not read ${failure.projectTitle}: ${failure.message}` : null;
}

function NumberResults({
  environmentId,
  number,
  rowProps,
}: {
  readonly environmentId: EnvironmentId;
  readonly number: number;
  readonly rowProps: RowProps;
}) {
  const targets = repositoryTargets(useProjects(), environmentId, number);
  return (
    <ResultsFrame>
      {targets.length > 0 ? (
        <ul>
          {targets.map((input) => (
            <NumberCandidate
              key={input.projectId}
              environmentId={environmentId}
              input={input}
              {...rowProps}
            />
          ))}
        </ul>
      ) : (
        <ResultsStatus>
          No repository in this environment can be searched by number. Paste a URL.
        </ResultsStatus>
      )}
    </ResultsFrame>
  );
}

/** One lookup per distinct repository, so the same remote cloned into two projects is read once. */
function repositoryTargets(
  projects: ReturnType<typeof useProjects>,
  environmentId: EnvironmentId,
  number: number,
): ReadonlyArray<PullRequestRef> {
  const seen = new Set<string>();
  const targets: Array<PullRequestRef> = [];
  for (const project of projects) {
    const identity = project.repositoryIdentity;
    if (project.environmentId !== environmentId || !identity || identity.provider === "unknown")
      continue;
    const repository = sourceControlRepositorySelector(identity);
    const key = canonicalRepositoryKey(identity.canonicalKey.toLowerCase());
    if (repository === null || seen.has(key)) continue;
    seen.add(key);
    targets.push({ projectId: project.id, repository, number });
  }
  return targets;
}

function NumberCandidate({
  environmentId,
  input,
  ...rowProps
}: RowProps & { readonly environmentId: EnvironmentId; readonly input: PullRequestRef }) {
  const query = useEnvironmentQuery(linkedPullRequestDetailAtom({ environmentId, input }));
  const reference = query.data === null ? null : parseChangeRequestUrl(query.data.url);
  if (query.data !== null && reference !== null) {
    if (!rowProps.linking.canLink(query.data.url)) return null;
    return (
      <CandidateRow
        entry={{
          ...reference,
          title: query.data.title,
          url: query.data.url,
          state: query.data.state,
          isDraft: query.data.isDraft === true,
        }}
        {...rowProps}
      />
    );
  }
  return (
    <li className="border-b border-border/50 px-3 py-2 text-xs text-muted-foreground last:border-b-0">
      <p role="status">
        {query.isPending
          ? `Checking ${input.repository} #${input.number}…`
          : `${input.repository}: no PR #${input.number} returned. It may not exist or the Git host may be unavailable; paste a URL if yours is missing.`}
      </p>
    </li>
  );
}

function CandidateRow({
  entry,
  thread,
  linking,
  selectedUrl,
  pending,
  onSelect,
}: RowProps & { readonly entry: Candidate }) {
  const linked = linking.isLinked(thread, entry.url);
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        aria-label={`${linked ? "Already linked" : "Select"} ${entry.host}/${entry.repository} #${entry.number}: ${entry.title}`}
        aria-pressed={selectedUrl === entry.url}
        disabled={linked || pending}
        onClick={() => onSelect(entry.url)}
        className="flex w-full flex-col gap-1 px-3 py-2 text-left text-sm outline-none hover:bg-accent aria-pressed:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-64"
      >
        <span className="w-full truncate">{entry.title}</span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {entry.host}/{entry.repository} #{entry.number} ·{" "}
          {linked ? "Linked" : entry.isDraft ? "Draft" : entry.state}
        </span>
      </button>
    </li>
  );
}
