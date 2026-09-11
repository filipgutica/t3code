import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId, WorkbenchJiraIssueLink } from "@t3tools/contracts";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useContext, useEffect, useLayoutEffect, useRef } from "react";

import { workbenchEnvironment } from "./state";

const MAX_CONCURRENT_PRELOADS = 2;
const PRELOAD_REFRESH_INTERVAL_MS = 30_000;
type TransitionQuery = ReturnType<typeof workbenchEnvironment.jiraGetTicketTransitions>;
type TransitionResult = TransitionQuery extends Atom.Atom<infer Result> ? Result : never;
type TransitionEntry = readonly [key: string, atom: TransitionQuery];

/** Keeps visible Jira transition queries warm without queueing interactive lookups behind them. */
export function WorkbenchJiraTransitionsPreloader({
  environmentId,
  issueLinks,
  paused = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly issueLinks: ReadonlyArray<WorkbenchJiraIssueLink>;
  readonly paused?: boolean;
}) {
  const registry = useContext(RegistryContext);
  const transitionInputs = issueLinks
    .filter((link) => link.active)
    .map((link) => ({
      key: `${environmentId}:${link.ticketId}:${link.issue.remoteUpdatedAt ?? "null"}`,
      link,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const latestInputs = useRef(transitionInputs);
  useLayoutEffect(() => {
    latestInputs.current = transitionInputs;
  });
  const signature = `${paused ? "paused" : "active"}:${transitionInputs.map(({ key }) => key).join("\u0000")}`;

  useEffect(() => {
    if (paused || signature === "active:") return;
    const unique = new Map<string, TransitionQuery>();
    for (const { key, link } of latestInputs.current) {
      unique.set(
        key,
        workbenchEnvironment.jiraGetTicketTransitions({
          environmentId,
          input: { ticketId: link.ticketId, remoteUpdatedAt: link.issue.remoteUpdatedAt },
        }),
      );
    }
    const transitions: ReadonlyArray<TransitionEntry> = Array.from(unique.entries());
    let disposed = false;
    let cycle = 0;
    let nextIndex = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let pumping = false;
    let pumpPending = false;
    const active = new Map<string, { readonly stop: () => void; readonly unmount: () => void }>();

    const clearActive = () => {
      for (const { stop, unmount } of active.values()) {
        stop();
        unmount();
      }
      active.clear();
    };

    const scheduleCycle = () => {
      if (disposed || refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        cycle += 1;
        nextIndex = 0;
        requestPump();
      }, PRELOAD_REFRESH_INTERVAL_MS);
    };

    const pump = () => {
      if (disposed || transitions.length === 0) return;
      while (active.size < MAX_CONCURRENT_PRELOADS && nextIndex < transitions.length) {
        const [key, atom] = transitions[nextIndex++]!;
        const unmount = registry.mount(atom);
        let stop = () => {};
        let settled = false;
        const finish = (result: TransitionResult) => {
          if (settled || result.waiting || result._tag === "Initial") return;
          settled = true;
          stop();
          unmount();
          active.delete(key);
          requestPump();
        };
        active.set(key, { stop: () => stop(), unmount });
        stop = registry.subscribe(atom, finish);
        if (cycle > 0 && !registry.get(atom).waiting) registry.refresh(atom);
        finish(registry.get(atom));
      }
      if (active.size === 0 && nextIndex >= transitions.length) scheduleCycle();
    };

    const requestPump = () => {
      if (disposed) return;
      if (pumping) {
        pumpPending = true;
        return;
      }
      pumping = true;
      do {
        pumpPending = false;
        pump();
      } while (pumpPending);
      pumping = false;
    };

    requestPump();
    return () => {
      disposed = true;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      clearActive();
    };
  }, [registry, environmentId, signature, paused]);

  return null;
}
