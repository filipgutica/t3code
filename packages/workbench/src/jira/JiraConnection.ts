import { WorkbenchJiraOperationError, type WorkbenchJiraConnection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const requireJiraConnection = Effect.fn("JiraConnection.requireJiraConnection")(
  (lookup: Effect.Effect<Option.Option<WorkbenchJiraConnection>, WorkbenchJiraOperationError>) =>
    lookup.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new WorkbenchJiraOperationError({
                code: "connection_not_found",
                message: "The Jira connection was not found.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    ),
);
