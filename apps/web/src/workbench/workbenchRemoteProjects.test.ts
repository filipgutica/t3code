import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chooseWorkbenchThreadMachine,
  getWorkbenchBoardRepositories,
  getWorkbenchRepositoryChoices,
  getWorkbenchRepositoryKey,
  getWorkbenchThreadMachines,
  matchWorkbenchSavedRepository,
  matchWorkbenchTicketThread,
} from "./workbenchRemoteProjects";

const laptop = EnvironmentId.make("laptop");
const desktop = EnvironmentId.make("desktop");
const createdAt = "2026-09-03T12:00:00.000Z";

const checkout = ({
  id,
  environmentId,
  root,
  path = root,
  remote = "git@github.com:acme/app.git",
}: {
  id: string;
  environmentId: EnvironmentId;
  root: string;
  path?: string;
  remote?: string;
}): EnvironmentProject => ({
  id: ProjectId.make(id),
  environmentId,
  title: id,
  workspaceRoot: path,
  repositoryIdentity: {
    canonicalKey: remote.replace(/^git@|\.git$/gu, "").replace(":", "/"),
    locator: { source: "git-remote", remoteName: "origin", remoteUrl: remote },
    rootPath: root,
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt,
  updatedAt: createdAt,
});

describe("getWorkbenchRepositoryKey", () => {
  it("matches a repository path across machines and separates monorepo projects", () => {
    const laptopWeb = checkout({
      id: "laptop-web",
      environmentId: laptop,
      root: "/home/me/app",
      path: "/home/me/app/apps/web",
    });
    const desktopWeb = checkout({
      id: "desktop-web",
      environmentId: desktop,
      root: "/srv/app",
      path: "/srv/app/apps/web",
    });
    const desktopApi = checkout({
      id: "desktop-api",
      environmentId: desktop,
      root: "/srv/app",
      path: "/srv/app/apps/api",
    });
    expect(getWorkbenchRepositoryKey(laptopWeb)).toBe(getWorkbenchRepositoryKey(desktopWeb));
    expect(getWorkbenchRepositoryKey(desktopApi)).not.toBe(getWorkbenchRepositoryKey(desktopWeb));
  });

  it("leaves a Project without a known repository root on its own", () => {
    const project = checkout({ id: "app", environmentId: laptop, root: "/home/me/app" });
    const remote = "git@github.com:acme/app.git";
    const withoutRoot = {
      ...project,
      repositoryIdentity: {
        canonicalKey: "github.com/acme/app",
        locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: remote },
      },
    };
    expect(getWorkbenchRepositoryKey(withoutRoot)).toBeNull();
    expect(getWorkbenchRepositoryKey({ ...project, repositoryIdentity: null })).toBeNull();
  });
});

describe("Workbench repositories across machines", () => {
  const laptopApp = checkout({ id: "laptop-app", environmentId: laptop, root: "/home/me/app" });
  const desktopApp = checkout({ id: "desktop-app", environmentId: desktop, root: "/srv/app" });
  const desktopDocs = checkout({
    id: "desktop-docs",
    environmentId: desktop,
    root: "/srv/docs",
    remote: "git@github.com:acme/docs.git",
  });
  const projects = [laptopApp, desktopApp, desktopDocs];

  it("shows a repository linked on two machines once, from the Board's machine", () => {
    expect(
      getWorkbenchBoardRepositories({
        board: {
          linkedProjectIds: [desktopApp.id, laptopApp.id],
          remoteProjects: [{ projectId: desktopApp.id, environmentId: desktop, title: "app" }],
        },
        projects,
        environmentId: laptop,
      }),
    ).toEqual([laptopApp]);
    // A Ticket naming the other checkout keeps it, so its saved scope stays valid.
    expect(
      getWorkbenchBoardRepositories({
        board: {
          linkedProjectIds: [desktopApp.id, laptopApp.id],
          remoteProjects: [{ projectId: desktopApp.id, environmentId: desktop, title: "app" }],
        },
        projects,
        environmentId: laptop,
        ticketProjectIds: [desktopApp.id],
      }),
    ).toEqual([desktopApp]);
    // A Ticket naming two checkouts of one repository keeps both.
    const laptopCopy = checkout({ id: "laptop-copy", environmentId: laptop, root: "/tmp/app" });
    expect(
      getWorkbenchBoardRepositories({
        board: { linkedProjectIds: [laptopApp.id, laptopCopy.id] },
        projects: [...projects, laptopCopy],
        environmentId: laptop,
        ticketProjectIds: [laptopApp.id, laptopCopy.id],
      }),
    ).toEqual([laptopApp, laptopCopy]);
  });

  it("keeps a new Ticket's repositories on the machine that links all of them", () => {
    const remoteProjects = [desktopApp, desktopDocs].map((project) => ({
      projectId: project.id,
      environmentId: desktop,
      title: project.title,
    }));
    expect(
      getWorkbenchBoardRepositories({
        board: {
          linkedProjectIds: [laptopApp.id, desktopApp.id, desktopDocs.id],
          remoteProjects,
        },
        projects,
        environmentId: laptop,
      }),
    ).toEqual([desktopApp, desktopDocs]);
    // Linked twice, a repository still shows once in the Board picker.
    expect(
      getWorkbenchRepositoryChoices({
        projects,
        environmentId: laptop,
        linkedProjectIds: [laptopApp.id, desktopApp.id],
      }),
    ).toEqual([laptopApp, desktopDocs]);
  });

  it("offers the Board machine's checkout of a repository linked only elsewhere", () => {
    expect(
      getWorkbenchRepositoryChoices({
        projects,
        environmentId: laptop,
        linkedProjectIds: [desktopApp.id],
      }),
    ).toEqual([laptopApp, desktopApp, desktopDocs]);
    expect(
      getWorkbenchRepositoryChoices({
        projects,
        environmentId: laptop,
        linkedProjectIds: [laptopApp.id],
      }),
    ).toEqual([laptopApp, desktopDocs]);
  });

  it("offers machines that check out every Ticket repository, preferring the Board default", () => {
    const appOnly = getWorkbenchThreadMachines({
      board: undefined,
      boardEnvironmentId: laptop,
      repositoryProjectIds: [laptopApp.id],
      projects,
    });
    expect(appOnly.map((machine) => machine.environmentId)).toEqual([laptop, desktop]);
    expect(appOnly[1]?.projectsByRepository.get(laptopApp.id)).toBe(desktopApp);
    const choose = (picked?: EnvironmentId, defaultEnvironmentId?: EnvironmentId) =>
      chooseWorkbenchThreadMachine({
        machines: appOnly,
        picked,
        defaultEnvironmentId,
        boardEnvironmentId: laptop,
        scopeEnvironmentId: laptop,
      })?.environmentId;
    expect(choose()).toBe(laptop);
    expect(choose(undefined, desktop)).toBe(desktop);
    expect(choose(laptop, desktop)).toBe(laptop);

    const docsLink = { projectId: desktopDocs.id, environmentId: desktop, title: "docs" };
    const withDocs = getWorkbenchThreadMachines({
      board: { remoteProjects: [docsLink] },
      boardEnvironmentId: laptop,
      repositoryProjectIds: [laptopApp.id, desktopDocs.id],
      projects,
    });
    expect(withDocs.map((machine) => machine.environmentId)).toEqual([desktop]);
    expect(
      chooseWorkbenchThreadMachine({
        machines: withDocs,
        picked: laptop,
        defaultEnvironmentId: undefined,
        boardEnvironmentId: laptop,
        scopeEnvironmentId: laptop,
      }),
    ).toBeUndefined();
  });

  it("requires every saved Ticket repository, even one this client cannot see", () => {
    const board = {
      remoteProjects: [{ projectId: laptopApp.id, environmentId: laptop, title: "app" }],
      repositoryKeys: [
        { projectId: laptopApp.id, repositoryKey: getWorkbenchRepositoryKey(laptopApp)! },
      ],
    };
    const desktopOnly = [desktopApp, desktopDocs];
    // The Ticket's own checkout is offline, but another machine checks out the same repository.
    expect(
      getWorkbenchThreadMachines({
        board,
        boardEnvironmentId: desktop,
        repositoryProjectIds: [laptopApp.id],
        projects: desktopOnly,
      }).map((machine) => machine.environmentId),
    ).toEqual([desktop]);
    // A repository with no identity and no reachable checkout makes no machine eligible.
    expect(
      getWorkbenchThreadMachines({
        board,
        boardEnvironmentId: desktop,
        repositoryProjectIds: [laptopApp.id, ProjectId.make("offline-unkeyed")],
        projects: desktopOnly,
      }),
    ).toEqual([]);
  });

  it("attaches another machine's Thread only when it works in a Ticket repository", () => {
    const match = (projectId: ProjectId) =>
      matchWorkbenchTicketThread({
        board: { linkedProjectIds: [laptopApp.id] },
        boardEnvironmentId: laptop,
        repositoryProjectIds: [laptopApp.id],
        projects,
        thread: { projectId, environmentId: desktop },
      });
    expect(match(desktopApp.id)).toEqual({
      repository: { repositoryKey: getWorkbenchRepositoryKey(laptopApp), title: "desktop-app" },
    });
    expect(match(desktopDocs.id)).toBeNull();
    // A new Thread defaults to the saved repository the last Thread's checkout stands for.
    expect(
      matchWorkbenchSavedRepository({
        board: { linkedProjectIds: [laptopApp.id] },
        projects,
        projectId: desktopApp.id,
        savedProjectIds: [desktopDocs.id, laptopApp.id],
      }),
    ).toBe(laptopApp.id);
  });
});
