import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  linkedPullRequestDetailAtom,
  pullRequestEnvironment,
  useSharedPullRequestSummary,
} from "../state/pullRequests";
import { useEnvironmentQuery } from "../state/query";
import {
  getWorkbenchPullRequestAttention,
  workbenchAttentionIdentity,
  type WorkbenchPullRequestAttention,
} from "./workbenchAttention.logic";
import type { TicketPullRequestReference } from "./workbenchPullRequests.logic";

/** Three native PR observers at a time; results are transient presentation, not another PR cache. */
export function WorkbenchAttentionQueries({
  environmentId,
  references,
  refresh,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly references: ReadonlyArray<TicketPullRequestReference>;
  readonly refresh: boolean;
  readonly onChange: (observations: ReadonlyMap<string, WorkbenchPullRequestAttention>) => void;
}) {
  const [observations, setObservations] = useState<
    ReadonlyMap<string, WorkbenchPullRequestAttention>
  >(new Map());
  const nextIndex = references.findIndex(
    (reference) =>
      !observations.get(workbenchAttentionIdentity(environmentId, reference))?.terminal,
  );
  const batchStart = Math.floor(nextIndex / 3) * 3;
  const current = nextIndex === -1 ? [] : references.slice(batchStart, batchStart + 3);
  const observe = useCallback(
    (key: string, next: WorkbenchPullRequestAttention) =>
      setObservations((previous) => {
        const existing = previous.get(key);
        if (
          existing?.inspected === next.inspected &&
          existing.pullRequestTitle === next.pullRequestTitle &&
          existing.terminal === next.terminal &&
          existing.reasons.join("|") === next.reasons.join("|") &&
          existing.inspectionStatus === next.inspectionStatus &&
          existing.activityComplete === next.activityComplete &&
          existing.checksKnown === next.checksKnown &&
          existing.reviewDecisionKnown === next.reviewDecisionKnown &&
          JSON.stringify(existing.resolvedReviewThreadIds) ===
            JSON.stringify(next.resolvedReviewThreadIds) &&
          JSON.stringify(existing.unresolvedReviewThreads) ===
            JSON.stringify(next.unresolvedReviewThreads)
        )
          return previous;
        return new Map(previous).set(key, next);
      }),
    [],
  );
  useEffect(() => onChange(observations), [observations, onChange]);
  return current.map((reference) => (
    <WorkbenchAttentionQuery
      key={workbenchAttentionIdentity(environmentId, reference)}
      environmentId={environmentId}
      reference={reference}
      refresh={refresh}
      onChange={observe}
    />
  ));
}

function WorkbenchAttentionQuery({
  environmentId,
  reference,
  refresh,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly reference: TicketPullRequestReference;
  readonly refresh: boolean;
  readonly onChange: (key: string, observation: WorkbenchPullRequestAttention) => void;
}) {
  const target = useMemo(() => {
    const host = parseChangeRequestUrl(reference.url)?.host;
    return {
      environmentId,
      input: {
        projectId: reference.projectId,
        repository: reference.repository,
        number: reference.number,
        ...(host === undefined ? {} : { host }),
      },
    };
  }, [environmentId, reference.projectId, reference.repository, reference.number, reference.url]);
  const summaryQuery = useEnvironmentQuery(linkedPullRequestDetailAtom(target));
  const summary = useSharedPullRequestSummary(
    environmentId,
    target.input,
    summaryQuery.data,
    summaryQuery.dataUpdatedAt,
  );
  const activityQuery = useEnvironmentQuery(pullRequestEnvironment.activity(target));
  const initialResult = useRef({
    summary: summaryQuery.resultIdentity,
    activity: activityQuery.resultIdentity,
  });
  // Manual refresh visits the same native atoms; errors never erase positive attention signals.
  const refreshSummary = summaryQuery.refresh;
  const refreshActivity = activityQuery.refresh;
  useEffect(() => {
    if (refresh) {
      refreshSummary();
      refreshActivity();
    }
  }, [refresh, refreshSummary, refreshActivity]);
  useEffect(() => {
    const waitingForRefresh =
      refresh &&
      (summaryQuery.resultIdentity === initialResult.current.summary ||
        activityQuery.resultIdentity === initialResult.current.activity);
    onChange(
      workbenchAttentionIdentity(environmentId, reference),
      getWorkbenchPullRequestAttention({
        reference,
        summary,
        activity: activityQuery.data,
        loading:
          waitingForRefresh ||
          summaryQuery.isPending ||
          activityQuery.isPending ||
          (!summaryQuery.isSuccess && summaryQuery.error === null) ||
          (!activityQuery.isSuccess && activityQuery.error === null),
        error: summaryQuery.error !== null || activityQuery.error !== null,
      }),
    );
  }, [
    environmentId,
    reference,
    refresh,
    summary,
    summaryQuery.resultIdentity,
    activityQuery.resultIdentity,
    activityQuery.data,
    activityQuery.isPending,
    activityQuery.isSuccess,
    activityQuery.error,
    summaryQuery.isPending,
    summaryQuery.isSuccess,
    summaryQuery.error,
    onChange,
  ]);
  return null;
}
