import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Workspace owners can veto native automatic removal without replacing its safety checks. */
export class WorkspaceCleanupPolicy extends Context.Reference<{
  readonly canRemove: (input: {
    readonly worktreesDir: string;
    readonly worktreePath: string;
  }) => Effect.Effect<boolean>;
}>("t3/workspace/WorkspaceCleanupPolicy", {
  defaultValue: () => ({ canRemove: () => Effect.succeed(true) }),
}) {}
