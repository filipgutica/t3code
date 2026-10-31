import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import {
  linkedPullRequestDetailAtom,
  pullRequestEnvironment,
  sharedPullRequestSummaryAtom,
} from "../state/pullRequests";
import { workbenchEnvironment } from "./state";
import {
  getWorkbenchPullRequestAttention,
  mergeWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
  type WorkbenchPullRequestAttention,
} from "./workbenchAttention.logic";
import type { TicketPullRequestReference } from "./workbenchPullRequests.logic";

type Observations = ReadonlyMap<string, WorkbenchPullRequestAttention>;
interface InspectionScope {
  readonly environmentId: EnvironmentId | null;
  readonly entityScope: string;
  readonly scope: string;
  readonly references: ReadonlyArray<TicketPullRequestReference>;
  readonly refreshGeneration: number;
}

const pendingObservation = (
  observation: WorkbenchPullRequestAttention,
): WorkbenchPullRequestAttention => ({
  ...observation,
  reasons: [
    ...observation.reasons.filter((reason) => !reason.startsWith("PR attention ")),
    "PR attention loading",
  ],
  inspectionStatus: "loading",
  inspected: false,
  terminal: false,
  activityComplete: false,
  checksKnown: false,
  reviewDecisionKnown: false,
  resolvedReviewThreadIds: [],
});

/** One provider's transient inspection progress; native atoms retain all PR data. */
export function createWorkbenchAttentionQueries() {
  const history = Atom.make<{
    entityScope: string;
    scope: string;
    observations: Observations;
  }>({ entityScope: "", scope: "", observations: new Map() });
  const family = Atom.family((key: string) =>
    Atom.make<Observations>((get) => {
      const input = JSON.parse(key) as InspectionScope;
      const { environmentId, references } = input;
      get.mount(history);
      const previous = get.once(history);
      const keys = new Set(
        environmentId === null
          ? []
          : references.map((reference) => workbenchAttentionIdentity(environmentId, reference)),
      );
      let observations: Observations = new Map(
        previous.entityScope === input.entityScope
          ? [...previous.observations]
              .filter(([identity]) => keys.has(identity))
              .map(([identity, observation]) => [
                identity,
                previous.scope === input.scope ? observation : pendingObservation(observation),
              ])
          : [],
      );
      const remember = () =>
        get.set(history, { entityScope: input.entityScope, scope: input.scope, observations });
      remember();
      let disposed = false;
      let stopBatch = () => {};
      get.addFinalizer(() => {
        disposed = true;
        stopBatch();
      });
      const publish = (identity: string, next: WorkbenchPullRequestAttention) => {
        if (disposed || get.once(history).scope !== input.scope) return;
        const merged = mergeWorkbenchPullRequestAttention({
          previous: observations.get(identity),
          next,
        });
        if (JSON.stringify(observations.get(identity)) === JSON.stringify(merged)) return;
        observations = new Map(observations).set(identity, merged);
        remember();
        get.setSelf(observations);
      };
      const inspectBatch = (start: number) => {
        if (
          disposed ||
          get.once(history).scope !== input.scope ||
          environmentId === null ||
          start >= references.length
        )
          return;
        const batch = references.slice(start, start + 3);
        const stops: Array<() => void> = [];
        stopBatch = () => stops.splice(0).forEach((stop) => stop());
        let ready = false;
        let advancing = false;
        const advance = () => {
          if (
            !ready ||
            advancing ||
            !batch.every(
              (reference) =>
                observations.get(workbenchAttentionIdentity(environmentId, reference))?.terminal,
            )
          )
            return;
          advancing = true;
          queueMicrotask(() => {
            stopBatch();
            inspectBatch(start + 3);
          });
        };
        for (const reference of batch) {
          const host = sourceControlClients.parseChangeRequestUrl(reference.url)?.link.host;
          const target = {
            environmentId,
            input: {
              projectId: reference.projectId,
              repository: reference.repository,
              number: reference.number,
              ...(host === undefined ? {} : { host }),
            },
          };
          const summaryQuery = linkedPullRequestDetailAtom(target);
          const activityQuery = pullRequestEnvironment.activity(target);
          const summary = sharedPullRequestSummaryAtom(environmentId, target.input);
          const viewer =
            host === undefined
              ? null
              : workbenchEnvironment.pullRequestViewer({ environmentId, input: { host } });
          const initialSummary = get.registry.get(summaryQuery);
          const initialActivity = get.registry.get(activityQuery);
          const observe = () => {
            if (disposed) return;
            const summaryResult = get.registry.get(summaryQuery);
            const activityResult = get.registry.get(activityQuery);
            const viewerResult = viewer === null ? null : get.registry.get(viewer);
            const waitingForRefresh =
              input.refreshGeneration > 0 &&
              (summaryResult === initialSummary || activityResult === initialActivity);
            publish(
              workbenchAttentionIdentity(environmentId, reference),
              getWorkbenchPullRequestAttention({
                reference,
                summary: get.registry.get(summary),
                activity: AsyncResult.getOrElse(activityResult, () => null),
                viewer:
                  viewerResult === null
                    ? undefined
                    : AsyncResult.getOrElse(viewerResult, () => null)?.viewer,
                loading:
                  waitingForRefresh ||
                  viewerResult?._tag === "Initial" ||
                  summaryResult.waiting ||
                  activityResult.waiting ||
                  summaryResult._tag === "Initial" ||
                  activityResult._tag === "Initial",
                error: summaryResult._tag === "Failure" || activityResult._tag === "Failure",
              }),
            );
            advance();
          };
          stops.push(
            get.registry.subscribe(summaryQuery, observe),
            get.registry.subscribe(activityQuery, observe),
            get.registry.subscribe(summary, observe),
          );
          if (viewer !== null) stops.push(get.registry.subscribe(viewer, observe));
          observe();
          if (input.refreshGeneration > 0) {
            get.registry.refresh(summaryQuery);
            get.registry.refresh(activityQuery);
          }
        }
        ready = true;
        advance();
      };
      // Native refreshes can notify other mounted React readers, so start after this render.
      queueMicrotask(() => inspectBatch(0));
      return observations;
    }).pipe(Atom.setIdleTTL(0)),
  );
  return (input: InspectionScope) => family(JSON.stringify(input));
}

export function useWorkbenchAttentionQueries(input: InspectionScope): Observations {
  const [queries] = useState(createWorkbenchAttentionQueries);
  return useAtomValue(queries(input));
}
