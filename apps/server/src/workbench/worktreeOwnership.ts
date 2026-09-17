import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { WorkspaceCleanupPolicy } from "../workspace/WorkspaceCleanupPolicy.ts";

/** Ticket lifecycle operations own this directory, even after a checkout changes branch. */
const isWorkbenchWorktreePath = ({
  path,
  worktreesDir,
  worktreePath,
}: {
  path: Path.Path;
  worktreesDir: string;
  worktreePath: string;
}) => {
  const relative = path.relative(path.join(worktreesDir, "workbench"), worktreePath);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

export const layer = Layer.effect(
  WorkspaceCleanupPolicy,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return {
      canRemove: (input: { readonly worktreesDir: string; readonly worktreePath: string }) =>
        Effect.succeed(!isWorkbenchWorktreePath({ path, ...input })),
    };
  }),
);
