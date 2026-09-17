import type * as Path from "effect/Path";

/** Ticket lifecycle operations own this directory, even after a checkout changes branch. */
export const isWorkbenchWorktreePath = ({
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
