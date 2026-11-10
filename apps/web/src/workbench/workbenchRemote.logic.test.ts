import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId, WorkbenchProjectId } from "@t3tools/contracts";

import {
  getWorkbenchAttachableThreads,
  getWorkbenchBoardLinkedOptionKeys,
  getWorkbenchBoardProjectSelection,
  getWorkbenchBoardProjectUnavailableReason,
  getWorkbenchBoardSelectionGap,
  getWorkbenchRemoteRepositories,
  workbenchBoardProjectOptionKey,
} from "./workbenchRemote.logic";

const host = EnvironmentId.make("host");
const remote = EnvironmentId.make("remote");
const otherRemote = EnvironmentId.make("other-remote");
const hostRepo = ProjectId.make("host-repo");
const remoteRepo = ProjectId.make("remote-repo");

describe("Workbench refs on other machines", () => {
  it("links each Project id once and keeps a host copy's id off the Board", () => {
    const hostOption = { id: hostRepo, environmentId: host, title: "web", environmentLabel: null };
    const remoteOption = {
      id: remoteRepo,
      environmentId: remote,
      title: "api",
      environmentLabel: "Build box",
    };
    // Copied data: the same Project id on two other machines, and on this one.
    const sameIdElsewhere = { ...remoteOption, environmentId: otherRemote };
    const copyOfHost = { ...hostOption, environmentId: remote, environmentLabel: "Build box" };
    const options = [hostOption, remoteOption, sameIdElsewhere, copyOfHost];
    const reason = (option: (typeof options)[number], selected: ReadonlyArray<typeof option>) =>
      getWorkbenchBoardProjectUnavailableReason({
        option,
        options,
        selectedKeys: new Set(selected.map(workbenchBoardProjectOptionKey)),
      });

    expect(reason(remoteOption, [])).toBeNull();
    expect(reason(sameIdElsewhere, [remoteOption])).toBe(
      "A Project with the same ID is already on this Board.",
    );
    expect(reason(remoteOption, [remoteOption])).toBeNull();
    expect(reason(copyOfHost, [])).toBe("A Project on this machine has the same ID.");

    expect(getWorkbenchBoardProjectSelection([hostOption, remoteOption])).toEqual({
      linkedProjectIds: [hostRepo, remoteRepo],
      remoteProjects: {
        [remoteRepo]: { environmentId: remote, environmentLabel: "Build box", projectTitle: "api" },
      },
      hasHostProject: true,
    });
    // A new Board needs a Project on the host, where planning runs; an existing one keeps its links.
    const remoteOnly = getWorkbenchBoardProjectSelection([remoteOption]);
    expect(getWorkbenchBoardSelectionGap(remoteOnly, true)).toBe("host-project");
    expect(getWorkbenchBoardSelectionGap(remoteOnly, false)).toBeNull();
    expect(getWorkbenchBoardSelectionGap(getWorkbenchBoardProjectSelection([]), true)).toBe(
      "empty",
    );
    // Saved links stay when none of them is available to pick, so an edit is never empty.
    expect(getWorkbenchBoardSelectionGap(getWorkbenchBoardProjectSelection([]), false)).toBeNull();

    // Reopening the Board selects each linked id only on the machine it was linked from.
    expect(
      getWorkbenchBoardLinkedOptionKeys(options, {
        linkedProjectIds: [hostRepo, remoteRepo],
        remoteProjects: {
          [remoteRepo]: {
            environmentId: remote,
            environmentLabel: "Build box",
            projectTitle: "api",
          },
        },
      }),
    ).toEqual(new Set([hostOption, remoteOption].map(workbenchBoardProjectOptionKey)));
  });

  it("resolves each Board's links on its own, as copied data can share a Project id", () => {
    const link = (environmentId: EnvironmentId, environmentLabel: string) => ({
      environmentId,
      environmentLabel,
      projectTitle: "api",
    });
    const first = WorkbenchProjectId.make("first-board");
    const second = WorkbenchProjectId.make("second-board");
    const repositories = getWorkbenchRemoteRepositories({
      boards: [
        { id: first, remoteProjects: { [remoteRepo]: link(remote, "Build box") } },
        { id: second, remoteProjects: { [remoteRepo]: link(otherRemote, "Laptop") } },
      ],
      projects: [],
      environmentLabels: new Map(),
    });
    expect(repositories.get(first)?.get(remoteRepo)).toMatchObject({
      environmentId: remote,
      environmentLabel: "Build box",
    });
    expect(repositories.get(second)?.get(remoteRepo)).toMatchObject({
      environmentId: otherRemote,
      environmentLabel: "Laptop",
    });
  });

  it("offers unassigned Threads from the machine that links each Ticket repository", () => {
    const thread = (id: string, environmentId: EnvironmentId, projectId: ProjectId) => ({
      id: ThreadId.make(id),
      environmentId,
      projectId,
    });
    const hostThread = thread("host-thread", host, hostRepo);
    const remoteThread = thread("remote-thread", remote, remoteRepo);
    const wrongMachine = thread("wrong-machine", otherRemote, remoteRepo);
    const hostIdCopy = thread("host-known", remote, remoteRepo);
    const assigned = thread("assigned", remote, remoteRepo);
    const outOfScope = thread("out-of-scope", host, ProjectId.make("other-repo"));

    expect(
      getWorkbenchAttachableThreads({
        hostEnvironmentId: host,
        repositoryProjectIds: [hostRepo, remoteRepo],
        remoteRepositories: new Map([[remoteRepo, { environmentId: remote }]]),
        threads: [hostThread, remoteThread, wrongMachine, hostIdCopy, assigned, outOfScope],
        assignedThreadIds: new Set([assigned.id]),
        reservedThreadIds: new Set(),
        hostThreadIds: new Set([hostThread.id, hostIdCopy.id]),
      }),
    ).toEqual([hostThread, remoteThread]);
  });
});
