import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
export { changeRequestUrlFor as changeRequestWebUrl } from "@t3tools/shared/changeRequestUrl";
import {
  canonicalRepositoryKey,
  sourceControlRepositorySelector,
} from "@t3tools/shared/sourceControl";
import {
  pullRequestHostOf,
  type ProjectId,
  type PullRequestListEntry,
  type PullRequestRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { useAtomValue } from "@effect/atom-react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useId, useRef, useState } from "react";

import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { parsePullRequestReference } from "~/pullRequestReference";
import { useProjects, useThreadShell } from "~/state/entities";
import { useDebouncedValue } from "~/state/queries";
import { usePullRequestList, usePullRequestNumberSearch } from "~/state/pullRequests";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Atom } from "effect/reactivity";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/**
 * Which thread has the link dialog open, set by whichever entry point asked (command palette,
 * pull-requests surface, detail panel) and rendered once by the chat view so the dialog outlives
 * a palette that closes the moment its command runs.
 */
const linkPullRequestDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("pull-requests:link-dialog-thread"),
);

export function openLinkPullRequestDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linkPullRequestDialogThreadAtom, threadRef);
}

interface LinkPullRequestDialogProps {
  open: boolean;
  threadRef: ScopedThreadRef;
  thread: EnvironmentThreadShell | null;
  onOpenChange: (open: boolean) => void;
}

export function LinkPullRequestDialogHost() {
  const threadRef = useAtomValue(linkPullRequestDialogThreadAtom);
  const thread = useThreadShell(threadRef);
  const linking = usePullRequestLinking(threadRef?.environmentId);
  if (threadRef === null || linking.mode === "unsupported") return null;
  return (
    <LinkPullRequestDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      open
      threadRef={threadRef}
      thread={thread}
      onOpenChange={(open) => {
        if (!open) appAtomRegistry.set(linkPullRequestDialogThreadAtom, null);
      }}
    />
  );
}

interface ResolvedLink {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
}

export function resolveLinkPullRequestInput(input: {
  readonly reference: string;
  readonly project: {
    readonly host: string;
    readonly repository: string;
    readonly webUrl: (number: number) => string | null;
  } | null;
  readonly hasProject: (reference: ResolvedLink) => boolean;
}): { link: ResolvedLink } | { error: string } | null {
  const parsed =
    parseChangeRequestUrl(input.reference.trim()) !== null
      ? input.reference.trim()
      : parsePullRequestReference(input.reference);
  if (parsed === null) return null;
  const url = parseChangeRequestUrl(parsed);
  if (url !== null) {
    if (!input.hasProject({ ...url, url: parsed })) {
      return { error: `No project in this environment can read ${url.host}/${url.repository}.` };
    }
    return {
      link: { host: url.host, repository: url.repository, number: url.number, url: parsed },
    };
  }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  if (input.project === null) {
    return { error: "Paste a full URL to link a pull request from another repository." };
  }
  const webUrl = input.project.webUrl(number);
  const webReference = webUrl === null ? null : parseChangeRequestUrl(webUrl);
  if (webUrl === null || webReference === null) {
    return {
      error:
        "This Thread's repository has no supported PR URL. Paste a full URL from a connected host.",
    };
  }
  return {
    link: { ...webReference, url: webUrl },
  };
}

function resolveOwnProject(
  environmentProjects: ReturnType<typeof useProjects>,
  projectId: ProjectId | undefined,
) {
  const project = environmentProjects.find((candidate) => candidate.id === projectId);
  const identity = project?.repositoryIdentity;
  if (!project || !identity) return null;
  const repository =
    identity.displayName ??
    (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null);
  if (repository === null) return null;
  const definition = sourceControlClients.get(identity.provider ?? "unknown");
  const host = pullRequestHostOf(identity, definition.kind);
  return {
    host,
    repository,
    webUrl: (number: number) =>
      definition.changeRequestUrl({
        host,
        repository,
        number,
        remoteUrl: identity.locator.remoteUrl,
        webUrl: identity.webUrl,
      }),
  };
}

/** Hosts without text search return a recent page; narrow those rows locally without claiming
 * the page contains every match. The URL path remains available for older PRs. */
type LinkCandidate = Pick<
  PullRequestListEntry,
  "host" | "repository" | "number" | "title" | "url" | "state" | "isDraft"
>;

function matchesCandidate(entry: LinkCandidate, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    entry.title.toLowerCase().includes(needle) ||
    entry.repository.toLowerCase().includes(needle) ||
    entry.host.toLowerCase().includes(needle) ||
    String(entry.number).includes(needle)
  );
}

function LinkPullRequestDialog({
  open,
  threadRef,
  thread,
  onOpenChange,
}: LinkPullRequestDialogProps) {
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const browseButtonRef = useRef<HTMLButtonElement>(null);
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const projects = useProjects();
  const environmentProjects = projects.filter(
    (project) => project.environmentId === threadRef.environmentId,
  );
  const ownProject = resolveOwnProject(environmentProjects, thread?.projectId);
  const ownUrl = ownProject?.webUrl(1);
  const supportsBareNumber = ownUrl != null && parseChangeRequestUrl(ownUrl) !== null;
  const [pending, setPending] = useState(false);
  const linking = usePullRequestLinking(threadRef.environmentId);
  const normalizedQuery = query.trim().replace(/^#(?=\d+$)/, "");
  const sentQuery = useDebouncedValue(normalizedQuery, 300);
  const parsedNumber = /^\d+$/u.test(sentQuery) ? Number(sentQuery) : null;
  const number =
    parsedNumber !== null && Number.isSafeInteger(parsedNumber) && parsedNumber > 0
      ? parsedNumber
      : null;
  const numberTargets = (() => {
    if (number === null) return [];
    const seen = new Set<string>();
    const targets: Array<{
      environmentId: typeof threadRef.environmentId;
      input: PullRequestRef;
    }> = [];
    for (const project of environmentProjects) {
      const identity = project.repositoryIdentity;
      if (!identity || identity.provider === "unknown") continue;
      const repository = sourceControlRepositorySelector(identity);
      if (repository === null) continue;
      const key = canonicalRepositoryKey(identity.canonicalKey.toLowerCase());
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        environmentId: threadRef.environmentId,
        input: { projectId: project.id, repository, number },
      });
    }
    return targets;
  })();
  const numberSearch = usePullRequestNumberSearch(numberTargets);
  const search = usePullRequestList(
    number === null
      ? [
          {
            environmentId: threadRef.environmentId,
            input: {
              state: sentQuery ? "all" : "open",
              involvement: "all",
              limit: 50,
              ...(sentQuery ? { query: sentQuery } : {}),
            },
          },
        ]
      : [],
  );

  const [openSeen, setOpenSeen] = useState(open);
  if (openSeen !== open) {
    setOpenSeen(open);
    if (open) {
      setManual(false);
      setQuery("");
      setSelectedUrl(null);
      setReference("");
      setDirty(false);
      setSubmitError(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      (manual ? inputRef : searchRef).current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [manual, open]);

  const resolved = resolveLinkPullRequestInput({
    reference,
    project: ownProject,
    hasProject: (candidate) => linking.canLink(candidate.url),
  });

  const candidates: ReadonlyArray<LinkCandidate> =
    number === null
      ? (search.data?.entries ?? []).filter((entry) => {
          if (!linking.canLink(entry.url)) return false;
          if (!sentQuery) return true;
          const hostSearches = search.data?.providers.some(
            (provider) => provider.host === entry.host && provider.searchesOnHost,
          );
          return hostSearches || matchesCandidate(entry, sentQuery);
        })
      : numberSearch.summaries.flatMap((summary) => {
          const reference = parseChangeRequestUrl(summary.url);
          return reference !== null && linking.canLink(summary.url)
            ? [
                {
                  ...reference,
                  title: summary.title,
                  url: summary.url,
                  state: summary.state,
                  isDraft: summary.isDraft === true,
                },
              ]
            : [];
        });
  const visibleCandidates = number === null ? candidates.slice(0, 50) : candidates;
  const unavailableProvider = search.data?.providers.find((provider) => !provider.configured);
  const discoveryError =
    number !== null
      ? numberSearch.error === null
        ? null
        : candidates.length > 0
          ? "Some repositories returned no PR or could not be checked. Paste a URL if yours is missing."
          : `No PR #${number} returned. A repository may have no match or be unavailable; check the Git host connection or paste a URL.`
      : search.error
        ? "Could not browse pull requests here. Check the Git host connection in this environment, or paste a PR URL."
        : unavailableProvider
          ? `${unavailableProvider.host}: ${unavailableProvider.detail ?? "Pull requests cannot be browsed on this host."}`
          : search.data?.errors[0]
            ? `Could not read ${search.data.errors[0].projectTitle}: ${search.data.errors[0].message}`
            : null;
  const searching =
    normalizedQuery !== sentQuery ||
    (number === null ? search.isPending && search.data === null : numberSearch.isPending);
  const selectedLink = manual
    ? resolved !== null && "link" in resolved
      ? resolved.link.url
      : null
    : selectedUrl;

  const submit = async () => {
    if (manual) setDirty(true);
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
    onOpenChange(false);
  };

  const validation =
    !manual || !dirty
      ? null
      : reference.trim().length === 0
        ? null
        : resolved === null
          ? supportsBareNumber
            ? "Use a pull request URL, 123, or #123."
            : "Use a pull request URL."
          : "error" in resolved
            ? resolved.error
            : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Link pull request</DialogTitle>
          <DialogDescription>
            {thread?.title
              ? `Choose a pull request to link to the Thread “${thread.title}”.`
              : "Choose a pull request to link to this Thread."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {manual ? (
            <>
              <p className="text-sm text-muted-foreground">
                {supportsBareNumber
                  ? "A number uses this Thread’s repository. A full URL can use any connected host."
                  : "This Thread has no hosted PR URL. Paste a full URL from a connected host."}
              </p>
              <Input
                ref={inputRef}
                aria-label="Pull request URL or number"
                placeholder={supportsBareNumber ? "Pull request URL or #42" : "Pull request URL"}
                value={reference}
                onChange={(event) => {
                  setDirty(false);
                  setSubmitError(null);
                  setReference(event.target.value);
                }}
                onBlur={(event) => {
                  if (event.relatedTarget !== browseButtonRef.current) setDirty(true);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void submit();
                }}
              />
              {resolved !== null && "link" in resolved ? (
                <p className="truncate text-muted-foreground text-xs">
                  {resolved.link.host}/{resolved.link.repository} #{resolved.link.number}
                </p>
              ) : null}
              <Button
                ref={browseButtonRef}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setManual(false)}
              >
                Browse pull requests
              </Button>
              {validation ? <p className="text-destructive text-xs">{validation}</p> : null}
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label htmlFor={searchId} className="text-sm font-medium">
                  Search pull requests
                </label>
                <Input
                  id={searchId}
                  ref={searchRef}
                  type="search"
                  placeholder="Search titles or PR numbers, or paste a URL"
                  value={query}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedUrl(null);
                    setSubmitError(null);
                    if (parseChangeRequestUrl(value.trim()) !== null) {
                      setReference(value.trim());
                      setDirty(true);
                      setManual(true);
                      return;
                    }
                    setQuery(value.slice(0, 200));
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">From projects in this environment</p>
              <div
                role="group"
                aria-label="Available pull requests"
                className="max-h-64 overflow-y-auto rounded-md border border-border/60"
              >
                {searching ? (
                  <p role="status" className="p-3 text-sm text-muted-foreground">
                    {sentQuery ? "Searching pull requests…" : "Loading pull requests…"}
                  </p>
                ) : visibleCandidates.length > 0 ? (
                  <ul>
                    {visibleCandidates.map((entry) => {
                      const linked = linking.isLinked(thread, entry.url);
                      return (
                        <li
                          key={`${entry.host}/${entry.repository}#${entry.number}`}
                          className="border-b border-border/50 last:border-b-0"
                        >
                          <button
                            type="button"
                            aria-label={`${linked ? "Already linked" : "Select"} ${entry.host}/${entry.repository} #${entry.number}: ${entry.title}`}
                            aria-pressed={selectedUrl === entry.url}
                            disabled={linked || pending}
                            onClick={() => setSelectedUrl(entry.url)}
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
                    })}
                  </ul>
                ) : (
                  <p role="status" className="p-3 text-sm text-muted-foreground">
                    {discoveryError ??
                      (sentQuery
                        ? number === null
                          ? "No matching pull requests found."
                          : `No pull request #${number} found in this environment.`
                        : "No open pull requests found in this environment.")}
                  </p>
                )}
              </div>
              {!searching && visibleCandidates.length > 0 && discoveryError ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {discoveryError}
                </p>
              ) : null}
              {!searching &&
              number === null &&
              (search.data?.truncated || candidates.length > 50) ? (
                <p className="text-xs text-muted-foreground">
                  More pull requests may be available. Paste a URL if yours is not shown.
                </p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedUrl(null);
                  setManual(true);
                }}
              >
                Paste a URL
              </Button>
            </>
          )}
          {submitError ? (
            <p role="alert" className="text-destructive text-xs">
              {submitError}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
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
