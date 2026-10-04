import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { WS_METHODS } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import type { EnvironmentQueryView } from "../state/query";

export function WorkbenchQueryError<A>({ query }: { query: EnvironmentQueryView<A> }) {
  const result = query.resultIdentity;
  // Older hosts reply with a string defect, which the shared query formatter hides.
  const failure =
    AsyncResult.isAsyncResult(result) && AsyncResult.isFailure(result)
      ? Cause.squash(result.cause)
      : null;
  const message = failure instanceof Error ? failure.message : failure;
  const unsupported = message === `Unknown request tag: ${WS_METHODS.workbenchGetSnapshot}`;
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertCircleIcon />
        </EmptyMedia>
        <EmptyTitle>
          {unsupported
            ? "Workbench is unavailable on this environment"
            : "Workbench couldn't refresh"}
        </EmptyTitle>
        <EmptyDescription>
          {unsupported
            ? "This environment does not support Workbench. Connect to a Workbench environment, or choose Back to Threads."
            : query.error}
        </EmptyDescription>
      </EmptyHeader>
      {!unsupported ? (
        <EmptyContent>
          <Button onClick={query.refresh} variant="outline">
            <RefreshCwIcon /> Retry
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
