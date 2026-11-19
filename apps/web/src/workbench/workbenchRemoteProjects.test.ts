import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  chooseWorkbenchThreadMachine,
  getWorkbenchBoardRepositories,
  getWorkbenchRepositoryChoices,
  getWorkbenchRepositoryKey,
  getWorkbenchThreadMachines,
  linkWorkbenchRepositoryCheckouts,
  matchWorkbenchSavedRepository,
  matchWorkbenchTicketThread,
  resolveWorkbenchTicketRepositories,
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
    // A Windows root differs in case from git's, but the path inside the repository does not.
    const windowsApi = checkout({
      id: "windows-api",
      environmentId: laptop,
      root: "C:\\Users\\me\\app",
      path: "c:\\users\\me\\app\\apps\\OrbitApi",
    });
    const linuxApi = checkout({
      id: "linux-api",
      environmentId: desktop,
      root: "/srv/app",
      path: "/srv/app/apps/OrbitApi",
    });
    expect(getWorkbenchRepositoryKey(windowsApi)).toBe(getWorkbenchRepositoryKey(linuxApi));
    const linuxLowerApi = checkout({
      id: "linux-lower-api",
      environmentId: desktop,
      root: "/srv/app",
      path: "/srv/app/apps/orbitapi",
    });
    expect(getWorkbenchRepositoryKey(linuxLowerApi)).not.toBe(getWorkbenchRepositoryKey(linuxApi));
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
    // A Ticket on the Board's machine is offered that machine's checkouts to add, even when
    // another machine links more repositories.
    const laptopDocs = checkout({
      id: "laptop-docs",
      environmentId: laptop,
      root: "/home/me/docs",
      remote: "git@github.com:acme/docs.git",
    });
    const desktopCli = checkout({
      id: "desktop-cli",
      environmentId: desktop,
      root: "/srv/cli",
      remote: "git@github.com:acme/cli.git",
    });
    expect(
      getWorkbenchBoardRepositories({
        board: {
          linkedProjectIds: [laptopApp, desktopApp, desktopDocs, laptopDocs, desktopCli].map(
            ({ id }) => id,
          ),
          remoteProjects: [
            ...remoteProjects,
            { projectId: desktopCli.id, environmentId: desktop, title: "cli" },
          ],
        },
        projects: [...projects, laptopDocs, desktopCli],
        environmentId: laptop,
        ticketProjectIds: [laptopApp.id],
      }),
    ).toEqual([laptopApp, laptopDocs, desktopCli]);
    // Linked twice, a repository still shows once in Edit Board, with both machines.
    expect(
      getWorkbenchRepositoryChoices({
        board: { linkedProjectIds: [laptopApp.id, desktopApp.id] },
        projects,
        environmentId: laptop,
      }).map(({ checkouts }) => checkouts),
    ).toEqual([[laptopApp, desktopApp], [desktopDocs]]);
  });

  it("saves a Ticket's chosen repositories on one machine, preferring the Board's", () => {
    const repository = (name: string, environmentId: EnvironmentId) =>
      checkout({
        id: `${environmentId}-${name}`,
        environmentId,
        root: `/repos/${name}`,
        remote: `git@github.com:acme/${name}.git`,
      });
    const laptopApi = repository("api", laptop);
    const laptopWeb = repository("web", laptop);
    const desktopApi = repository("api", desktop);
    const desktopDocs = repository("docs", desktop);
    const desktopLinks = [desktopApi, desktopDocs, repository("ops", desktop)];
    const board = {
      linkedProjectIds: [laptopApi, laptopWeb, ...desktopLinks].map((project) => project.id),
      remoteProjects: desktopLinks.map((project) => ({
        projectId: project.id,
        environmentId: desktop,
        title: project.title,
      })),
    };
    const resolve = (...selected: EnvironmentProject[]) =>
      resolveWorkbenchTicketRepositories({
        board,
        projects: [laptopApi, laptopWeb, ...desktopLinks],
        environmentId: laptop,
        projectIds: selected.map((project) => project.id),
      });
    // The picker shows the fuller machine's API, yet the Board's machine links both choices.
    expect(resolve(desktopApi, laptopWeb)).toEqual([laptopApi.id, laptopWeb.id]);
    expect(resolve(desktopApi)).toEqual([laptopApi.id]);
    expect(resolve(laptopApi, desktopDocs)).toEqual([desktopApi.id, desktopDocs.id]);
    expect(resolve(laptopWeb, desktopDocs)).toBeNull();
  });

  it("links every machine's checkout of a Board repository, so a Ticket can use one machine", () => {
    const board = { linkedProjectIds: [laptopApp.id] };
    const remote = (project: EnvironmentProject) => ({
      projectId: project.id,
      environmentId: desktop,
      title: project.title,
    });
    const docs = getWorkbenchRepositoryChoices({ board, projects, environmentId: laptop }).find(
      ({ checkouts }) => checkouts.includes(desktopDocs),
    )!;
    const linked = linkWorkbenchRepositoryCheckouts({
      board,
      projects,
      environmentId: laptop,
      row: { choice: docs, checked: true },
    });
    expect(linked).toEqual({
      linkedProjectIds: [laptopApp.id, desktopApp.id, desktopDocs.id],
      remoteProjects: [remote(desktopApp), remote(desktopDocs)],
    });
    expect(
      resolveWorkbenchTicketRepositories({
        board: linked,
        projects,
        environmentId: laptop,
        projectIds: [laptopApp.id, desktopDocs.id],
      }),
    ).toEqual([desktopApp.id, desktopDocs.id]);
    // Unchecking a row unlinks its checkout on every machine.
    expect(
      linkWorkbenchRepositoryCheckouts({
        board: linked,
        projects,
        environmentId: laptop,
        row: { choice: docs, checked: false },
      }),
    ).toEqual({
      linkedProjectIds: [laptopApp.id, desktopApp.id],
      remoteProjects: [remote(desktopApp)],
    });
  });

  it("offers machines that check out every Ticket repository, preferring the Board default", () => {
    const repositoryKeys = [
      { projectId: laptopApp.id, repositoryKey: getWorkbenchRepositoryKey(laptopApp)! },
    ];
    // The server matches other checkouts only by a key the Board stored.
    const unkeyed = getWorkbenchThreadMachines({
      board: undefined,
      boardEnvironmentId: laptop,
      repositoryProjectIds: [laptopApp.id],
      projects,
    });
    expect(unkeyed.map((machine) => machine.environmentId)).toEqual([laptop]);
    // A linked checkout matches only by its own stored key, as on the server.
    const desktopLink = { projectId: desktopApp.id, environmentId: desktop, title: "app" };
    const unkeyedLink = getWorkbenchThreadMachines({
      board: {
        linkedProjectIds: [laptopApp.id, desktopApp.id],
        remoteProjects: [desktopLink],
        repositoryKeys,
      },
      boardEnvironmentId: laptop,
      repositoryProjectIds: [laptopApp.id],
      projects,
    });
    expect(unkeyedLink.map((machine) => machine.environmentId)).toEqual([laptop]);
    const appOnly = getWorkbenchThreadMachines({
      board: { linkedProjectIds: [laptopApp.id], repositoryKeys },
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
      board: {
        linkedProjectIds: [laptopApp.id, desktopDocs.id],
        remoteProjects: [docsLink],
        repositoryKeys,
      },
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
      linkedProjectIds: [laptopApp.id],
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
    const repositoryKey = getWorkbenchRepositoryKey(laptopApp)!;
    const match = (projectId: ProjectId, keyed = true) =>
      matchWorkbenchTicketThread({
        board: {
          linkedProjectIds: [laptopApp.id],
          repositoryKeys: keyed ? [{ projectId: laptopApp.id, repositoryKey }] : [],
        },
        boardEnvironmentId: laptop,
        repositoryProjectIds: [laptopApp.id],
        projects,
        thread: { projectId, environmentId: desktop },
      });
    // The server matches only a key the Board stored.
    expect(match(desktopApp.id, false)).toBeNull();
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
