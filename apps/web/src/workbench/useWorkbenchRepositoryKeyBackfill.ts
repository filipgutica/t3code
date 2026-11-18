import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, WorkbenchProject } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useAtomCommand } from "../state/use-atom-command";
import { workbenchEnvironment } from "./state";
import { getMissingWorkbenchRepositoryKeys } from "./workbenchRemoteProjects";

/**
 * Boards linked before repositories had an identity store none, so their duplicate links stay
 * separate on the server. Record the identities this client can see, once per set of them.
 */
export function useWorkbenchRepositoryKeyBackfill({
  environmentId,
  boards,
  projects,
  canOperate,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly boards: ReadonlyArray<WorkbenchProject> | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly canOperate: boolean;
}) {
  const updateProject = useAtomCommand(workbenchEnvironment.updateProject, {
    reportFailure: false,
  });
  const attempted = useRef(new Set<string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes identities the server cannot read for itself
  useEffect(() => {
    if (!canOperate || environmentId === null) return;
    for (const board of boards ?? []) {
      if (board.archivedAt !== null) continue;
      const repositoryKeys = getMissingWorkbenchRepositoryKeys({ board, projects });
      // Keyed by the identities sent, not the revision: a server that ignores them gets one write.
      const attempt = [
        environmentId,
        board.id,
        ...repositoryKeys.map(({ projectId, repositoryKey }) => `${projectId}=${repositoryKey}`),
      ].join("\0");
      // A failed write, such as a stale revision, retries once the Board's revision changes.
      const failed = `${attempt}\0${board.revision}`;
      if (repositoryKeys.length === 0 || attempted.current.has(attempt)) continue;
      if (attempted.current.has(failed)) continue;
      attempted.current.add(attempt);
      void updateProject({
        environmentId,
        input: {
          id: board.id,
          expectedRevision: board.revision,
          title: board.title,
          linkedProjectIds: board.linkedProjectIds,
          remoteProjects: board.remoteProjects ?? [],
          repositoryKeys,
          updatedAt: new Date().toISOString(),
        },
      }).then((result) => {
        if (result._tag !== "Failure") return;
        attempted.current.delete(attempt);
        attempted.current.add(failed);
      });
    }
  }, [boards, canOperate, environmentId, projects, updateProject]);
}
