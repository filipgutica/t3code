import {
  WorkbenchArchiveEpicInput,
  RunId,
  ProjectId,
  ThreadId,
  WorkbenchAssignmentId,
  WorkbenchProjectId,
  WorkbenchEpicId,
  WorkbenchTicketWorkspaceAttemptId,
  WorkbenchTicketId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { WorkbenchNativeAccess } from "./WorkbenchNativeAccess.ts";
import { ensureWorkbenchSchema } from "./WorkbenchSchema.ts";
import {
  WorkbenchStore,
  WorkbenchStoreLive,
  type WorkbenchThreadContextSnapshot,
} from "./WorkbenchStore.ts";

const decodeArchiveEpicInput = Schema.decodeEffect(WorkbenchArchiveEpicInput);
const orbitIssue = (number: number) => ({
  key: `ORBIT-${number}`,
  url: `https://acme.atlassian.net/browse/ORBIT-${number}`,
});

const nativeLayer = (options?: {
  readonly projects?: ReadonlySet<string>;
  readonly repositoryProjects?: ReadonlySet<string>;
  readonly threads?: ReadonlyMap<string, string>;
  readonly executionSequence?: Effect.Effect<number>;
}) => {
  const projects = options?.projects ?? new Set<string>();
  const repositoryProjects = options?.repositoryProjects ?? projects;
  const threads = options?.threads ?? new Map<string, string>();
  return Layer.succeed(
    WorkbenchNativeAccess,
    WorkbenchNativeAccess.of({
      findProject: (projectId) =>
        Effect.succeed(
          projects.has(projectId)
            ? Option.some({ id: projectId, workspaceRoot: `/repos/${projectId}` })
            : Option.none(),
        ),
      isRepository: (root) => Effect.succeed(repositoryProjects.has(root.slice("/repos/".length))),
      findThread: (threadId) => {
        const projectId = threads.get(threadId);
        return Effect.succeed(
          projectId === undefined
            ? Option.none()
            : Option.some({ id: threadId, projectId: ProjectId.make(projectId) }),
        );
      },
      hasThreadAtWorktreePath: () => Effect.succeed(false),
      findStartingRun: () => Effect.succeedNone,
      contextMarker: () => Effect.succeed(0),
      findRunMessageText: () => Effect.succeedNone,
      executionSequence: options?.executionSequence ?? Effect.succeed(0),
      startedExecutionRunIds: Effect.succeed([]),
      hasPendingThreadWork: () => Effect.succeed(false),
    }),
  );
};

const testLayer = (options?: Parameters<typeof nativeLayer>[0]) =>
  WorkbenchStoreLive.pipe(
    Layer.provideMerge(nativeLayer(options)),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provideMerge(NodeCrypto.layer),
  );

const fileLayer = (filename: string, options?: Parameters<typeof nativeLayer>[0]) =>
  WorkbenchStoreLive.pipe(
    Layer.provideMerge(nativeLayer(options)),
    Layer.provideMerge(NodeSqliteClient.layer({ filename })),
    Layer.provideMerge(NodeCrypto.layer),
  );

const seedTicket = (input: {
  readonly store: WorkbenchStore["Service"];
  readonly projectId: ProjectId;
  readonly workspaceId: WorkbenchProjectId;
  readonly ticketId: WorkbenchTicketId;
  readonly title?: string;
  readonly markdown?: string;
  readonly createdAt?: string;
}) =>
  Effect.gen(function* () {
    const createdAt = input.createdAt ?? "2026-09-07T10:00:00.000Z";
    yield* input.store.createProject({
      id: input.workspaceId,
      title: "Summary workspace",
      linkedProjectIds: [input.projectId],
      createdAt,
    });
    return yield* input.store.createTicket({
      id: input.ticketId,
      projectId: input.workspaceId,
      title: input.title ?? "Validate requests",
      kind: "bug",
      markdown: input.markdown ?? "Reject invalid dimensions before querying the provider.",
      primaryT3ProjectId: input.projectId,
      createdAt,
    });
  });

describe("WorkbenchStore package boundary", () => {
  it.effect(
    "omits archived markdown only from compact snapshots and preserves the ticket read",
    () =>
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const projectId = ProjectId.make("compact-project");
        const workspaceId = WorkbenchProjectId.make("compact-workspace");
        const ticketId = WorkbenchTicketId.make("compact-ticket");
        const ticket = yield* seedTicket({ store, projectId, workspaceId, ticketId });
        yield* store.archiveTicket({
          ticketId,
          expectedRevision: ticket.revision,
          archivedAt: "2026-10-17T10:00:00.000Z",
          updatedAt: "2026-10-17T10:00:00.000Z",
        });
        expect((yield* store.getCompactSnapshot).tickets[0]).toMatchObject({
          id: ticketId,
          markdown: "",
          markdownOmitted: true,
        });
        expect((yield* store.getSnapshot).tickets[0]?.markdown).toBe(ticket.markdown);
        expect(Option.getOrThrow(yield* store.getTicket(ticketId)).markdown).toBe(ticket.markdown);
        yield* store.archiveTicket({
          ticketId,
          expectedRevision: ticket.revision + 1,
          archivedAt: null,
          updatedAt: "2026-10-17T10:01:00.000Z",
        });
        expect((yield* store.getCompactSnapshot).tickets[0]).toMatchObject({
          markdown: ticket.markdown,
        });
      }).pipe(Effect.provide(testLayer({ projects: new Set(["compact-project"]) }))),
  );

  it.effect("atomically starts todo execution and preserves further-along statuses", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("execution-project");
      const workspaceId = WorkbenchProjectId.make("execution-workspace");
      const todoTicketId = WorkbenchTicketId.make("execution-todo-ticket");
      const doneTicketId = WorkbenchTicketId.make("execution-done-ticket");
      const todo = yield* seedTicket({
        store,
        projectId,
        workspaceId,
        ticketId: todoTicketId,
      });
      const done = yield* store.createTicket({
        id: doneTicketId,
        projectId: workspaceId,
        title: "Already done",
        kind: "story",
        markdown: "Keep the terminal status.",
        primaryT3ProjectId: projectId,
        createdAt: "2026-09-07T10:00:00.000Z",
      });
      yield* store.updateTicket({
        id: done.id,
        expectedRevision: done.revision,
        status: "done",
        updatedAt: "2026-09-07T10:01:00.000Z",
      });

      const todoThread = ThreadId.make("execution-todo-thread");
      const doneThread = ThreadId.make("execution-done-thread");
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("execution-todo-assignment"),
        ticketId: todoTicketId,
        threadId: todoThread,
        createdAt: todo.createdAt,
      });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("execution-done-assignment"),
        ticketId: doneTicketId,
        threadId: doneThread,
        createdAt: done.createdAt,
      });
      yield* store.initializeTicketExecution;
      yield* store.consumeTicketExecution({
        sequence: 1,
        run: {
          id: RunId.make("todo-run"),
          threadId: todoThread,
          startedAt: "2026-09-07T10:02:00.000Z",
        },
      });
      const started = (yield* store.getSnapshot).tickets.find(
        (ticket) => ticket.id === todoTicketId,
      )!;
      expect(started.status).toBe("in_progress");
      expect(started.revision).toBe(todo.revision + 1);
      yield* store.consumeTicketExecution({
        sequence: 2,
        run: {
          id: RunId.make("todo-run"),
          threadId: todoThread,
          startedAt: "2026-09-07T10:03:00.000Z",
        },
      });
      expect(
        (yield* store.getSnapshot).tickets.find((ticket) => ticket.id === todoTicketId),
      ).toEqual(started);
      yield* store.consumeTicketExecution({
        sequence: 3,
        run: {
          id: RunId.make("done-run"),
          threadId: doneThread,
          startedAt: "2026-09-07T10:04:00.000Z",
        },
      });
      expect(
        (yield* store.getSnapshot).tickets.map((ticket) => [ticket.id, ticket.status]),
      ).toEqual([
        [doneTicketId, "done"],
        [todoTicketId, "in_progress"],
      ]);
    }).pipe(
      Effect.provide(
        testLayer({
          projects: new Set(["execution-project"]),
          threads: new Map([
            ["execution-todo-thread", "execution-project"],
            ["execution-done-thread", "execution-project"],
          ]),
        }),
      ),
    ),
  );

  it.effect(
    "guards summary completions and failures by request while preserving metadata updates",
    () =>
      Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const projectId = ProjectId.make("summary-lifecycle-project");
        const workspaceId = WorkbenchProjectId.make("summary-lifecycle-workspace");
        const ticketId = WorkbenchTicketId.make("summary-lifecycle-ticket");
        const created = yield* seedTicket({ store, projectId, workspaceId, ticketId });
        expect(created.generatedSummary).toMatchObject({ stale: false });
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual(
          created.generatedSummary,
        );

        yield* store.requestTicketSummary({ ticketId, requestId: "summary-request-1" });
        const staleCompletion = yield* store.completeTicketSummary({
          ticketId,
          requestId: "summary-request-stale",
          summary: "Should be ignored.",
        });
        expect(Option.isNone(staleCompletion)).toBe(true);

        const completed = yield* store.completeTicketSummary({
          ticketId,
          requestId: "summary-request-1",
          summary: "Reject invalid dimensions before querying the provider.",
        });
        const completedTicket = Option.getOrThrow(completed);
        expect(completedTicket.generatedSummary).toEqual({
          text: "Reject invalid dimensions before querying the provider.",
          status: "ready",
          stale: false,
          error: null,
        });

        const statusUpdate = yield* store.updateTicket({
          id: ticketId,
          expectedRevision: 0,
          status: "in_progress",
          updatedAt: "2026-09-07T10:01:00.000Z",
        });
        expect(statusUpdate.generatedSummary).toEqual(completedTicket.generatedSummary);

        yield* store.requestTicketSummary({ ticketId, requestId: "summary-request-2" });
        const staleFailure = yield* store.failTicketSummary({
          ticketId,
          requestId: "summary-request-1",
          error: "Should be ignored.",
        });
        expect(Option.isNone(staleFailure)).toBe(true);

        const failed = yield* store.failTicketSummary({
          ticketId,
          requestId: "summary-request-2",
          error: "The selected model is unavailable.",
        });
        expect(Option.getOrThrow(failed).generatedSummary).toEqual({
          text: "Reject invalid dimensions before querying the provider.",
          status: "error",
          stale: false,
          error: "The selected model is unavailable.",
        });
        expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual(
          Option.getOrThrow(failed).generatedSummary,
        );
      }).pipe(Effect.provide(testLayer({ projects: new Set(["summary-lifecycle-project"]) }))),
  );

  it.effect("publishes a ticket change after restoring an archived pending ticket", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("summary-restore-project");
      const workspaceId = WorkbenchProjectId.make("summary-restore-workspace");
      const ticketId = WorkbenchTicketId.make("summary-restore-ticket");
      const archivedAt = "2026-09-07T10:01:00.000Z";
      const restoredAt = "2026-09-07T10:02:00.000Z";
      yield* seedTicket({ store, projectId, workspaceId, ticketId });

      const changeFiber = yield* Stream.runHead(store.ticketChanges).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 0,
        archivedAt,
        updatedAt: archivedAt,
      });
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 1,
        archivedAt: null,
        updatedAt: restoredAt,
      });

      expect(Option.getOrThrow(yield* Fiber.join(changeFiber))).toEqual({ ticketId });
    }).pipe(Effect.provide(testLayer({ projects: new Set(["summary-restore-project"]) }))),
  );

  it.effect("backfills summary columns for tickets from an older schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("summary-migration-project");
      const workspaceId = WorkbenchProjectId.make("summary-migration-workspace");
      const ticketId = WorkbenchTicketId.make("summary-migration-ticket");
      yield* seedTicket({ store, projectId, workspaceId, ticketId });

      yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 12`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_request_id`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_source_hash`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_error`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_stale`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary_status`;
      yield* sql`ALTER TABLE workbench_tickets DROP COLUMN generated_summary`;

      yield* ensureWorkbenchSchema;

      expect((yield* store.getSnapshot).tickets[0]?.generatedSummary).toEqual({
        text: null,
        status: "pending",
        stale: false,
        error: null,
      });
      const migratedColumns = yield* sql<{
        readonly generatedSummary: string | null;
        readonly generatedSummaryStatus: string;
        readonly generatedSummaryStale: number;
        readonly generatedSummaryError: string | null;
        readonly generatedSummarySourceHash: string | null;
        readonly generatedSummaryRequestId: string | null;
      }>`
        SELECT
          generated_summary AS "generatedSummary",
          generated_summary_status AS "generatedSummaryStatus",
          generated_summary_stale AS "generatedSummaryStale",
          generated_summary_error AS "generatedSummaryError",
          generated_summary_source_hash AS "generatedSummarySourceHash",
          generated_summary_request_id AS "generatedSummaryRequestId"
        FROM workbench_tickets
        WHERE ticket_id = ${ticketId}
      `;
      expect(migratedColumns).toEqual([
        {
          generatedSummary: null,
          generatedSummaryStatus: "pending",
          generatedSummaryStale: 0,
          generatedSummaryError: null,
          generatedSummarySourceHash: null,
          generatedSummaryRequestId: null,
        },
      ]);
    }).pipe(Effect.provide(testLayer({ projects: new Set(["summary-migration-project"]) }))),
  );

  it.effect("backfills Ticket Workspace repository attempt ownership", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("workspace-attempt-migration-project");
      const workspaceId = WorkbenchProjectId.make("workspace-attempt-migration-workspace");
      const ticketId = WorkbenchTicketId.make("workspace-attempt-migration-ticket");
      const createdAt = "2026-09-07T10:00:00.000Z";
      const attemptId = "workspace-attempt-migration-attempt";

      yield* seedTicket({ store, projectId, workspaceId, ticketId, createdAt });
      yield* sql`
        INSERT INTO workbench_ticket_workspaces (
          ticket_id, attempt_id, status, branch_name, error_message, created_at, updated_at
        ) VALUES (
          ${ticketId}, ${attemptId}, 'ready', 'workbench/migration', NULL,
          ${createdAt}, ${createdAt}
        )
      `;
      yield* sql`
        INSERT INTO workbench_ticket_workspace_repositories (
          ticket_id, t3_project_id, attempt_id, is_primary, source_path, worktree_path,
          branch_name, status, error_message, created_at, updated_at
        ) VALUES (
          ${ticketId}, ${projectId}, NULL, 1, '/repos/migration', '/worktrees/migration',
          'workbench/migration', 'ready', NULL, ${createdAt}, ${createdAt}
        )
      `;

      yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 13`;
      yield* sql`ALTER TABLE workbench_ticket_workspace_repositories DROP COLUMN attempt_id`;
      yield* ensureWorkbenchSchema;

      const backfilled = yield* sql<{ readonly attemptId: string | null }>`
        SELECT attempt_id AS "attemptId"
        FROM workbench_ticket_workspace_repositories
        WHERE ticket_id = ${ticketId}
      `;
      expect(backfilled).toEqual([{ attemptId }]);
      expect(yield* store.getTicketWorkspaceRepositoryStates(ticketId)).toEqual([
        { projectId, attemptId, status: "ready" },
      ]);
    }).pipe(
      Effect.provide(testLayer({ projects: new Set(["workspace-attempt-migration-project"]) })),
    ),
  );

  it.effect("backfills only selected legacy Workspace branches once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("generated-branch-migration-project");
      const createdAt = "2026-09-07T10:00:00.000Z";
      const cases = [
        { name: "empty", branches: [], selected: true },
        { name: "mixed", branches: ["feature/primary", "workbench/mixed"], selected: true },
        { name: "all-pr", branches: ["feature/primary", "feature/secondary"], selected: false },
      ];

      yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 19`;
      yield* sql`ALTER TABLE workbench_ticket_workspaces DROP COLUMN generated_branch_name`;
      for (const { name, branches } of cases) {
        const ticketId = WorkbenchTicketId.make(`migration-${name}`);
        yield* seedTicket({
          store,
          projectId,
          workspaceId: WorkbenchProjectId.make(`migration-${name}`),
          ticketId,
          createdAt,
        });
        yield* sql`
          INSERT INTO workbench_ticket_workspaces (
            ticket_id, attempt_id, status, branch_name, error_message, created_at, updated_at
          ) VALUES (
            ${ticketId}, 'legacy-attempt', 'ready', ${`workbench/${name}`}, NULL,
            ${createdAt}, ${createdAt}
          )
        `;
        for (const [index, branch] of branches.entries()) {
          yield* sql`
            INSERT INTO workbench_ticket_workspace_repositories (
              ticket_id, t3_project_id, attempt_id, is_primary, source_path, worktree_path,
              branch_name, status, error_message, created_at, updated_at
            ) VALUES (
              ${ticketId}, ${`repository-${index}`}, 'legacy-attempt', ${index === 0 ? 1 : 0},
              ${`/repos/${index}`}, ${`/worktrees/${name}/${index}`}, ${branch}, 'ready', NULL,
              ${createdAt}, ${createdAt}
            )
          `;
        }
      }
      yield* ensureWorkbenchSchema;
      for (const { name, selected } of cases) {
        expect(
          yield* store.getTicketWorkspaceGeneratedBranchName(
            WorkbenchTicketId.make(`migration-${name}`),
          ),
        ).toEqual(selected ? Option.some(`workbench/${name}`) : Option.none());
      }

      yield* sql`UPDATE workbench_ticket_workspaces SET generated_branch_name = NULL`;
      yield* ensureWorkbenchSchema;
      for (const { name } of cases) {
        expect(
          yield* store.getTicketWorkspaceGeneratedBranchName(
            WorkbenchTicketId.make(`migration-${name}`),
          ),
        ).toEqual(Option.none());
      }
    }).pipe(
      Effect.provide(testLayer({ projects: new Set(["generated-branch-migration-project"]) })),
    ),
  );

  it.effect("keeps the Workspace identity while selecting a generated branch once", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("generated-branch-project");
      const ticketId = WorkbenchTicketId.make("generated-branch-ticket");
      const now = "2026-09-07T10:00:00.000Z";
      yield* seedTicket({
        store,
        projectId,
        workspaceId: WorkbenchProjectId.make("generated-branch-workspace"),
        ticketId,
        createdAt: now,
      });
      const claim = (attemptId: string, generatedBranchName: string | null) =>
        store.claimTicketWorkspace({
          ticketId,
          attemptId: WorkbenchTicketWorkspaceAttemptId.make(attemptId),
          branchName: "ticket-identity",
          generatedBranchName,
          repositories: [
            {
              projectId,
              isPrimary: true,
              sourcePath: "/repo",
              worktreePath: "/worktree",
              branchName: "pr/head",
            },
          ],
          claimedAt: now,
        });
      expect(yield* store.getTicketWorkspaceGeneratedBranchName(ticketId)).toEqual(Option.none());

      yield* claim("pull-request-attempt", null);
      expect(yield* store.getTicketWorkspaceGeneratedBranchName(ticketId)).toEqual(Option.none());
      yield* store.failTicketWorkspace({
        ticketId,
        attemptId: WorkbenchTicketWorkspaceAttemptId.make("pull-request-attempt"),
        projectId: null,
        errorMessage: "Interrupted",
        failedAt: now,
      });

      const retryAttemptId = WorkbenchTicketWorkspaceAttemptId.make("retry-attempt");
      const retried = yield* claim(retryAttemptId, "feature/selected");
      expect(retried.branchName).toBe("ticket-identity");
      expect(yield* store.getTicketWorkspaceGeneratedBranchName(ticketId)).toEqual(
        Option.some("feature/selected"),
      );
      yield* store.markTicketWorkspaceRepositoryReady({
        ticketId,
        attemptId: retryAttemptId,
        projectId,
        worktreePath: "/worktree",
        branchName: "pr/head",
        updatedAt: now,
      });
      yield* store.completeTicketWorkspace({
        ticketId,
        attemptId: retryAttemptId,
        completedAt: now,
      });

      const reconciled = yield* claim("ready-attempt", "feature/other");
      expect(reconciled.branchName).toBe("ticket-identity");
      expect(yield* store.getTicketWorkspaceGeneratedBranchName(ticketId)).toEqual(
        Option.some("feature/selected"),
      );
    }).pipe(Effect.provide(testLayer({ projects: new Set(["generated-branch-project"]) }))),
  );

  it.effect("rolls back a failed ticket update after acquiring the writer lock", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("native-project");
      const workspaceId = WorkbenchProjectId.make("rollback-workspace");
      const ticketId = WorkbenchTicketId.make("rollback-ticket");
      const createdAt = "2026-09-05T12:00:00.000Z";

      yield* store.createProject({
        id: workspaceId,
        title: "Rollback Workspace",
        linkedProjectIds: [projectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId: workspaceId,
        title: "Original title",
        kind: "story",
        markdown: "Original markdown",
        primaryT3ProjectId: projectId,
        createdAt,
      });

      // Fail after the ticket UPDATE has run so the store transaction must
      // roll the write back along with its revision change.
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TRIGGER fail_ticket_update
        AFTER UPDATE OF title ON workbench_tickets
        WHEN NEW.title = 'Updated title'
        BEGIN
          SELECT RAISE(ABORT, 'test rollback');
        END
      `;

      const error = yield* Effect.flip(
        store.updateTicket({
          id: ticketId,
          expectedRevision: 0,
          title: "Updated title",
          updatedAt: "2026-09-05T12:01:00.000Z",
        }),
      );
      const snapshot = yield* store.getSnapshot;

      expect(error.code).toBe("persistence_failed");
      expect(snapshot.tickets).toEqual([
        expect.objectContaining({
          id: ticketId,
          title: "Original title",
          revision: 0,
        }),
      ]);
    }).pipe(Effect.provide(testLayer({ projects: new Set(["native-project"]) }))),
  );

  it.effect("records the agent that last changed the description until a user edits it", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("provenance-project");
      const ticketId = WorkbenchTicketId.make("provenance-ticket");
      const agent = ThreadId.make("provenance-agent");
      const ticket = yield* seedTicket({
        store,
        projectId,
        workspaceId: WorkbenchProjectId.make("provenance-workspace"),
        ticketId,
      });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("provenance-assignment"),
        ticketId,
        threadId: agent,
        createdAt: ticket.createdAt,
      });
      const update = (input: {
        readonly revision: number;
        readonly markdown?: string;
        readonly status?: "todo" | "in_progress";
        readonly updatedByThreadId?: ThreadId;
      }) =>
        store.updateTicket({
          id: ticketId,
          expectedRevision: input.revision,
          ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.updatedByThreadId === undefined
            ? {}
            : { updatedByThreadId: input.updatedByThreadId }),
          updatedAt: "2026-10-20T10:00:00.000Z",
        });
      const byAgent = yield* update({
        revision: ticket.revision,
        markdown: "## Goal\n\nAgent plan.",
        updatedByThreadId: agent,
      });
      expect(byAgent.updatedByThreadId).toBe(agent);
      // A status change leaves the description's author in place.
      const moved = yield* update({ revision: byAgent.revision, status: "in_progress" });
      expect(Option.getOrThrow(yield* store.getTicket(ticketId)).updatedByThreadId).toBe(agent);
      const byUser = yield* update({ revision: moved.revision, markdown: "User plan." });
      expect(byUser.updatedByThreadId).toBeNull();
      expect((yield* store.getSnapshot).tickets[0]?.updatedByThreadId).toBeNull();
    }).pipe(
      Effect.provide(
        testLayer({
          projects: new Set(["provenance-project"]),
          threads: new Map([["provenance-agent", "provenance-project"]]),
        }),
      ),
    ),
  );

  it.effect("rejects non-Git linked projects before creating a Workspace", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("non-repository-project");
      const workspaceId = WorkbenchProjectId.make("non-repository-workspace");

      const error = yield* Effect.flip(
        store.createProject({
          id: workspaceId,
          title: "Non-repository Workspace",
          linkedProjectIds: [projectId],
          createdAt: "2026-09-07T10:00:00.000Z",
        }),
      );

      expect(error.code).toBe("linked_project_not_repository");
      expect((yield* store.getSnapshot).projects).toEqual([]);
    }).pipe(
      Effect.provide(
        testLayer({
          projects: new Set(["non-repository-project"]),
          repositoryProjects: new Set(),
        }),
      ),
    ),
  );

  it.effect("keeps an existing non-Git link while adding a valid link", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* WorkbenchStore;
      const invalidProjectId = ProjectId.make("legacy-non-repository-project");
      const validProjectId = ProjectId.make("new-repository-project");
      const invalidAdditionId = ProjectId.make("invalid-addition-project");
      const workspaceId = WorkbenchProjectId.make("legacy-link-workspace");
      const createdAt = "2026-09-07T10:00:00.000Z";

      yield* sql`
        INSERT INTO workbench_projects (project_id, title, created_at, updated_at)
        VALUES (${workspaceId}, 'Legacy links', ${createdAt}, ${createdAt})
      `;
      yield* sql`
        INSERT INTO workbench_project_links (workbench_project_id, t3_project_id, position)
        VALUES (${workspaceId}, ${invalidProjectId}, 0)
      `;
      const updated = yield* store.updateProject({
        id: workspaceId,
        title: "Renamed legacy links",
        linkedProjectIds: [invalidProjectId, validProjectId],
        updatedAt: "2026-09-07T10:01:00.000Z",
      });

      expect(updated).toMatchObject({
        id: workspaceId,
        title: "Renamed legacy links",
        linkedProjectIds: [invalidProjectId, validProjectId],
      });

      const rejected = yield* Effect.flip(
        store.updateProject({
          id: workspaceId,
          title: "Should not persist",
          linkedProjectIds: [invalidProjectId, validProjectId, invalidAdditionId],
          updatedAt: "2026-09-07T10:02:00.000Z",
        }),
      );
      expect(rejected.code).toBe("linked_project_not_repository");
      expect((yield* store.getSnapshot).projects).toEqual([
        expect.objectContaining({
          id: workspaceId,
          title: "Renamed legacy links",
          linkedProjectIds: [invalidProjectId, validProjectId],
        }),
      ]);
    }).pipe(
      Effect.provide(
        testLayer({
          projects: new Set([
            "legacy-non-repository-project",
            "new-repository-project",
            "invalid-addition-project",
          ]),
          repositoryProjects: new Set(["new-repository-project"]),
        }),
      ),
    ),
  );

  it.effect("checks native thread existence and project ownership for assignments", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const projectId = ProjectId.make("assignment-project");
      const workspaceId = WorkbenchProjectId.make("assignment-workspace");
      const ticketId = WorkbenchTicketId.make("assignment-ticket");
      const createdAt = "2026-09-05T12:00:00.000Z";

      yield* store.createProject({
        id: workspaceId,
        title: "Assignment Workspace",
        linkedProjectIds: [projectId],
        createdAt,
      });
      yield* store.createTicket({
        id: ticketId,
        projectId: workspaceId,
        title: "Assignment ticket",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: projectId,
        createdAt,
      });

      const missingThread = yield* Effect.flip(
        store.createAssignment({
          id: WorkbenchAssignmentId.make("missing-thread-assignment"),
          ticketId,
          threadId: ThreadId.make("missing-thread"),
          createdAt,
        }),
      );
      const wrongProject = yield* Effect.flip(
        store.createAssignment({
          id: WorkbenchAssignmentId.make("wrong-project-assignment"),
          ticketId,
          threadId: ThreadId.make("wrong-project-thread"),
          createdAt,
        }),
      );

      expect(missingThread.code).toBe("thread_not_found");
      expect(wrongProject.code).toBe("thread_project_mismatch");
    }).pipe(
      Effect.provide(
        testLayer({
          projects: new Set(["assignment-project"]),
          threads: new Map([["wrong-project-thread", "other-project"]]),
        }),
      ),
    ),
  );
});

describe("Workbench Thread roster", () => {
  const projectId = ProjectId.make("roster-project");
  const workspaceId = WorkbenchProjectId.make("roster-workspace");
  const ticketId = WorkbenchTicketId.make("roster-ticket");
  const thread = (name: string) => ThreadId.make(`roster-${name}`);
  const layer = testLayer({
    projects: new Set([projectId]),
    threads: new Map(
      ["first", "second", "replaced", "replacement", "lone"].map((name) => [
        thread(name),
        projectId,
      ]),
    ),
  });
  const assign = (
    store: WorkbenchStore["Service"],
    input: { readonly ticketId: WorkbenchTicketId; readonly name: string; readonly minute: number },
  ) =>
    store.createAssignment({
      id: WorkbenchAssignmentId.make(`roster-assignment-${input.name}`),
      ticketId: input.ticketId,
      threadId: thread(input.name),
      createdAt: `2026-10-20T10:0${input.minute}:00.000Z`,
    });

  it.effect("lists current sibling Threads with their recaps and excludes the Thread itself", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      yield* seedTicket({ store, projectId, workspaceId, ticketId, title: "Ship rosters" });
      const loneTicketId = WorkbenchTicketId.make("roster-lone-ticket");
      yield* store.createTicket({
        id: loneTicketId,
        projectId: workspaceId,
        title: "Alone",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: projectId,
        createdAt: "2026-10-20T10:00:00.000Z",
      });
      yield* assign(store, { ticketId, name: "first", minute: 1 });
      yield* assign(store, { ticketId, name: "second", minute: 2 });
      yield* assign(store, { ticketId, name: "replaced", minute: 3 });
      yield* assign(store, { ticketId: loneTicketId, name: "lone", minute: 4 });
      yield* store.replaceAssignment({
        ticketId,
        previousThreadId: thread("replaced"),
        threadId: thread("replacement"),
        replacedAt: "2026-10-20T10:05:00.000Z",
      });
      // Replacing a planning Thread leaves its draft row working.
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO workbench_ticket_drafts
        (draft_id, workbench_project_id, thread_id, phase, revision, payload_json)
        VALUES (${ticketId}, ${workspaceId}, ${thread("replaced")}, 'working', 1, '{}')`;
      const recap = {
        runId: RunId.make("second-run"),
        text: "Moved validation into the schema.",
        updatedAt: "2026-10-20T11:00:00.000Z",
      };
      yield* store.upsertThreadRecap({ threadId: thread("second"), ...recap });

      const roster = Option.getOrThrow(yield* store.getThreadRoster(thread("first")));
      expect(roster.ticket).toEqual({ id: ticketId, title: "Ship rosters", issueLabel: null });
      expect(roster.recap).toBeNull();
      expect(roster.siblings).toEqual([
        { threadId: thread("second"), recap },
        { threadId: thread("replacement"), recap: null },
      ]);
      expect(Option.getOrThrow(yield* store.getThreadRoster(thread("second"))).recap).toEqual(
        recap,
      );
      expect(Option.getOrThrow(yield* store.getThreadRoster(thread("lone"))).siblings).toEqual([]);
      expect(yield* store.getThreadRoster(thread("replaced"))).toEqual(Option.none());
    }).pipe(Effect.provide(layer)),
  );

  it.effect("resolves a Thread's owner from its active Assignment or its unsaved draft", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      yield* seedTicket({ store, projectId, workspaceId, ticketId });
      yield* assign(store, { ticketId, name: "first", minute: 1 });
      yield* assign(store, { ticketId, name: "replaced", minute: 2 });
      yield* store.replaceAssignment({
        ticketId,
        previousThreadId: thread("replaced"),
        threadId: thread("replacement"),
        replacedAt: "2026-10-20T10:05:00.000Z",
      });
      const sql = yield* SqlClient.SqlClient;
      const draftId = WorkbenchTicketId.make("roster-draft");
      yield* sql`INSERT INTO workbench_ticket_drafts
        (draft_id, workbench_project_id, thread_id, phase, revision, payload_json)
        VALUES (${draftId}, ${workspaceId}, ${thread("planner")}, 'draft', 0, '{}'),
          ('roster-old-plan', ${workspaceId}, ${thread("replaced")}, 'working', 1, '{}')`;

      expect(yield* store.resolveThreadOwner(thread("first"))).toEqual(
        Option.some({ kind: "ticket", ticketId }),
      );
      expect(yield* store.resolveThreadOwner(thread("planner"))).toEqual(
        Option.some({ kind: "draft", draftId }),
      );
      // A superseded Assignment's leftover working draft is not an owner.
      expect(yield* store.resolveThreadOwner(thread("replaced"))).toEqual(Option.none());
      expect(yield* store.resolveThreadOwner(thread("stranger"))).toEqual(Option.none());
    }).pipe(Effect.provide(layer)),
  );

  it.effect("never replaces a recap with one for an earlier run and exposes it in snapshots", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      yield* seedTicket({ store, projectId, workspaceId, ticketId });
      yield* assign(store, { ticketId, name: "first", minute: 1 });
      const threadId = thread("first");
      const write = (run: string, updatedAt: string) =>
        store.upsertThreadRecap({
          threadId,
          runId: RunId.make(run),
          text: `Recap of ${run}`,
          updatedAt,
        });
      yield* write("run-2", "2026-10-20T12:00:00.000Z");
      yield* write("run-1", "2026-10-20T11:00:00.000Z");
      expect((yield* store.getCompactSnapshot).threadRecaps).toEqual([
        { threadId, text: "Recap of run-2", updatedAt: "2026-10-20T12:00:00.000Z" },
      ]);
      yield* write("run-3", "2026-10-20T13:00:00.000Z");
      expect((yield* store.getSnapshot).threadRecaps).toEqual([
        { threadId, text: "Recap of run-3", updatedAt: "2026-10-20T13:00:00.000Z" },
      ]);
    }).pipe(Effect.provide(layer)),
  );
});

describe("Workbench Workspace lifecycle", () => {
  const projectId = ProjectId.make("lifecycle-native-project");
  const workspaceId = WorkbenchProjectId.make("lifecycle-workspace");
  const ticketId = WorkbenchTicketId.make("lifecycle-ticket");
  const epicId = WorkbenchEpicId.make("lifecycle-epic");
  const threadId = ThreadId.make("lifecycle-thread");
  const now = "2026-10-09T10:00:00.000Z";
  const setup = Effect.gen(function* () {
    const store = yield* WorkbenchStore;
    yield* seedTicket({ store, projectId, workspaceId, ticketId });
    yield* store.createEpic({
      id: epicId,
      projectId: workspaceId,
      title: "Keep this Epic",
      markdown: "Planning",
      createdAt: now,
    });
    yield* store.createAssignment({
      id: WorkbenchAssignmentId.make("lifecycle-assignment"),
      ticketId,
      threadId,
      createdAt: now,
    });
    return store;
  });
  const layer = (
    executionSequence?: Effect.Effect<number>,
    threads = new Map([[threadId, projectId]]),
  ) =>
    testLayer({
      projects: new Set([projectId]),
      threads,
      ...(executionSequence === undefined ? {} : { executionSequence }),
    });
  const archive = { id: workspaceId, expectedRevision: 0, archivedAt: now, updatedAt: now };
  const deletion = {
    id: workspaceId,
    expectedRevision: 0,
    expectedTicketCount: 1,
    expectedEpicCount: 1,
    deletedAt: now,
  };

  it.effect("advertises reversible Epic lifecycle support in the host snapshot", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      expect(yield* store.getSnapshot).toHaveProperty("supportsEpicLifecycle", true);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("rejects a replayed restore after a newer archive and clock-skewed content save", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      yield* TestClock.setTime(Date.parse("2026-10-09T12:00:01.000Z"));
      const archived = yield* store.archiveEpic({ id: epicId, archivedAt: now });
      const restore = yield* decodeArchiveEpicInput({
        id: epicId,
        archivedAt: null,
        expectedUpdatedAt: archived.updatedAt,
      });
      yield* TestClock.setTime(Date.parse("2026-10-09T12:00:03.000Z"));
      const restored = yield* store.archiveEpic(restore);
      const rearchived = yield* store.archiveEpic(
        yield* decodeArchiveEpicInput({
          id: epicId,
          archivedAt: now,
          expectedUpdatedAt: restored.updatedAt,
        }),
      );
      const saved = yield* store.updateEpic({
        id: epicId,
        title: "Saved after rearchive",
        markdown: "Content from a client whose clock is behind",
        updatedAt: archived.updatedAt,
      });
      const error = yield* Effect.flip(store.archiveEpic(restore));
      expect(error.code).toBe("epic_changed");
      expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(rearchived.updatedAt));
      expect(saved.archivedAt).toBe(rearchived.archivedAt);
      expect(restored.updatedAt).not.toBe(archived.updatedAt);
      expect(rearchived.updatedAt).not.toBe(archived.updatedAt);
      expect((yield* store.getSnapshot).epics.find((epic) => epic.id === epicId)).toEqual(saved);
      const admission = yield* Effect.flip(
        store.createTicket({
          id: WorkbenchTicketId.make("stale-restore-child"),
          projectId: workspaceId,
          epicId,
          title: "Blocked child",
          kind: "story",
          markdown: "",
          primaryT3ProjectId: projectId,
          createdAt: now,
        }),
      );
      expect(admission.code).toBe("epic_archived");
    }).pipe(Effect.provide(layer())),
  );

  it.effect(
    "archives and restores local Epics while preserving children and enforcing admission",
    () =>
      Effect.gen(function* () {
        const store = yield* setup;
        const child = {
          id: WorkbenchTicketId.make("epic-child"),
          projectId: workspaceId,
          epicId,
          title: "Child",
          kind: "story" as const,
          markdown: "",
          primaryT3ProjectId: projectId,
          createdAt: now,
        };
        yield* store.createTicket(child);
        const archived = yield* store.archiveEpic({ id: epicId, archivedAt: now });
        expect(archived.archivedAt).toBe(now);
        const blocked = yield* Effect.flip(
          store.createTicket({ ...child, id: WorkbenchTicketId.make("blocked-child") }),
        );
        expect(blocked.code).toBe("epic_archived");
        const restore = yield* decodeArchiveEpicInput({
          id: epicId,
          archivedAt: null,
        });
        const restoredAt = "2026-10-10T10:00:00.000Z";
        yield* TestClock.setTime(Date.parse(restoredAt));
        const restored = yield* store.archiveEpic(restore);
        expect(restored).toMatchObject({
          archivedAt: null,
          title: "Keep this Epic",
          markdown: "Planning",
          createdAt: now,
        });
        expect(restored.updatedAt).toBe(restoredAt);
        expect((yield* store.getSnapshot).epics.find((epic) => epic.id === epicId)).toEqual(
          restored,
        );
        yield* store.createTicket({ ...child, id: WorkbenchTicketId.make("restored-child") });
        expect(
          (yield* store.getSnapshot).tickets.find((ticket) => ticket.id === child.id)?.epicId,
        ).toBe(epicId);
      }).pipe(Effect.provide(layer())),
  );

  it.effect("lets former Jira Epics archive, restore, and rename like local Epics", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const importedId = WorkbenchEpicId.make("jira:binding:epic:123");
      yield* store.createEpic({
        id: importedId,
        projectId: workspaceId,
        title: "Imported",
        markdown: "",
        createdAt: now,
      });
      const archived = yield* store.archiveEpic({ id: importedId, archivedAt: now });
      expect(archived.archivedAt).toBe(now);
      expect(
        (yield* store.archiveEpic({ id: importedId, archivedAt: null })).archivedAt,
      ).toBeNull();
      const renamed = yield* store.updateEpic({
        id: importedId,
        title: "Renamed locally",
        markdown: "Local body",
        updatedAt: now,
      });
      expect(renamed).toMatchObject({ title: "Renamed locally", markdown: "Local body" });
    }).pipe(Effect.provide(layer())),
  );

  it.effect("links, changes, and unlinks a Jira issue on an Epic by its version", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const epic = Option.getOrThrow(yield* store.getEpic(epicId));
      expect(epic.jiraIssue).toBeNull();
      const linked = yield* store.setEpicJiraIssueLink({
        epicId,
        jiraIssue: orbitIssue(375),
        expectedUpdatedAt: epic.updatedAt,
      });
      expect(linked.jiraIssue).toEqual(orbitIssue(375));
      expect(linked.updatedAt).not.toBe(epic.updatedAt);
      const stale = yield* Effect.flip(
        store.setEpicJiraIssueLink({
          epicId,
          jiraIssue: orbitIssue(376),
          expectedUpdatedAt: epic.updatedAt,
        }),
      );
      expect(stale.code).toBe("epic_changed");
      const changed = yield* store.setEpicJiraIssueLink({
        epicId,
        jiraIssue: orbitIssue(376),
        expectedUpdatedAt: linked.updatedAt,
      });
      expect(
        (yield* store.getSnapshot).epics.find((candidate) => candidate.id === epicId)?.jiraIssue,
      ).toEqual(orbitIssue(376));
      const unlinked = yield* store.setEpicJiraIssueLink({
        epicId,
        jiraIssue: null,
        expectedUpdatedAt: changed.updatedAt,
      });
      expect(Option.getOrThrow(yield* store.getEpic(epicId))).toEqual(unlinked);
      expect(unlinked.jiraIssue).toBeNull();
    }).pipe(Effect.provide(layer())),
  );

  it.effect("preserves archived planning and rejects every planning mutation until restored", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const before = yield* store.getSnapshot;
      const request = yield* store.requestTicketSummary({ ticketId, requestId: "before-archive" });
      const archived = yield* store.archiveProject(archive);
      expect(archived).toMatchObject({ archivedAt: now, revision: 1 });
      expect(Option.getOrThrow(yield* store.getProject(workspaceId))).toEqual(archived);
      const snapshot = yield* store.getSnapshot;
      expect(snapshot.tickets).toEqual(before.tickets);
      expect(snapshot.epics).toEqual(before.epics);
      expect(snapshot.assignments).toEqual(before.assignments);
      const mutations = [
        store.updateProject({
          id: workspaceId,
          title: "Blocked",
          linkedProjectIds: [projectId],
          updatedAt: now,
        }),
        store.createEpic({
          id: WorkbenchEpicId.make("blocked-epic"),
          projectId: workspaceId,
          title: "Blocked",
          markdown: "",
          createdAt: now,
        }),
        store.updateEpic({ id: epicId, title: "Blocked", markdown: "", updatedAt: now }),
        store.archiveEpic({ id: epicId, archivedAt: now }),
        store.archiveEpic({ id: epicId, archivedAt: null }),
        store.createTicket({
          id: WorkbenchTicketId.make("blocked-ticket"),
          projectId: workspaceId,
          title: "Blocked",
          kind: "story",
          markdown: "",
          primaryT3ProjectId: projectId,
          createdAt: now,
        }),
        store.updateTicket({
          id: ticketId,
          expectedRevision: request.revision,
          title: "Blocked",
          updatedAt: now,
        }),
        store.setEpicJiraIssueLink({
          epicId,
          jiraIssue: orbitIssue(1),
          expectedUpdatedAt: now,
        }),
        store.archiveTicket({
          ticketId,
          expectedRevision: request.revision,
          archivedAt: now,
          updatedAt: now,
        }),
        store.deleteTicket({ ticketId, expectedRevision: request.revision, deletedAt: now }),
        store.unlinkAssignment({ ticketId, threadId }),
        store.addReference({
          ticketId,
          url: "https://github.com/acme/app/issues/7",
          addedByThreadId: threadId,
        }),
        store.removeReference({ ticketId, url: "https://github.com/acme/app/issues/7" }),
        store.replaceAssignment({
          ticketId,
          previousThreadId: threadId,
          threadId: ThreadId.make("replacement-thread"),
          replacedAt: now,
        }),
        store.requestTicketSummary({ ticketId, requestId: "during-archive" }),
        store.claimTicketWorkspace({
          ticketId,
          attemptId: WorkbenchTicketWorkspaceAttemptId.make("blocked-attempt"),
          branchName: "workbench/blocked",
          repositories: [
            { projectId, isPrimary: true, sourcePath: "/repo", worktreePath: "/worktree" },
          ],
          claimedAt: now,
        }),
      ];
      for (const mutation of mutations)
        expect((yield* Effect.flip(mutation)).code).toBe("project_archived");
      expect(yield* store.listTicketsNeedingSummary).toEqual([]);
      expect(Option.isNone(yield* store.getTicketSummaryCandidate(ticketId))).toBe(true);
      expect(
        Option.isNone(
          yield* store.completeTicketSummary({
            ticketId,
            requestId: "before-archive",
            summary: "Late result",
          }),
        ),
      ).toBe(true);
      expect(
        Option.isNone(
          yield* store.failTicketSummary({
            ticketId,
            requestId: "before-archive",
            error: "Late failure",
          }),
        ),
      ).toBe(true);
      expect(
        (yield* Effect.flip(store.archiveProject({ ...archive, archivedAt: null }))).code,
      ).toBe("project_changed");
      const changeFiber = yield* Stream.runHead(store.ticketChanges).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      const restored = yield* store.archiveProject({
        ...archive,
        expectedRevision: 1,
        archivedAt: null,
      });
      expect(restored).toMatchObject({ archivedAt: null, revision: 2 });
      expect(Option.getOrThrow(yield* Fiber.join(changeFiber))).toEqual({ ticketId });
      expect(
        Option.isNone(
          yield* store.completeTicketSummary({
            ticketId,
            requestId: "before-archive",
            summary: "Late result after restore",
          }),
        ),
      ).toBe(true);
      expect((yield* store.getSnapshot).tickets).toEqual(before.tickets);
      yield* store.updateTicket({
        id: ticketId,
        expectedRevision: request.revision,
        title: "Allowed",
        updatedAt: now,
      });
    }).pipe(Effect.provide(layer())),
  );

  it.effect("restores child archive states unchanged and rejects stale Workspace edits", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      yield* store.archiveTicket({
        ticketId,
        expectedRevision: 0,
        archivedAt: now,
        updatedAt: now,
      });
      yield* store.archiveEpic({ id: epicId, archivedAt: now });
      const before = yield* store.getSnapshot;
      yield* store.archiveProject(archive);
      yield* store.archiveProject({ ...archive, expectedRevision: 1, archivedAt: null });
      const restored = yield* store.getSnapshot;
      expect(restored.tickets).toEqual(before.tickets);
      expect(restored.epics).toEqual(before.epics);
      expect(
        (yield* Effect.flip(
          store.updateProject({
            id: workspaceId,
            expectedRevision: 0,
            title: "Stale",
            linkedProjectIds: [projectId],
            updatedAt: now,
          }),
        )).code,
      ).toBe("project_changed");
      expect(
        yield* store.updateProject({
          id: workspaceId,
          expectedRevision: 2,
          title: "Updated",
          linkedProjectIds: [projectId],
          updatedAt: now,
        }),
      ).toMatchObject({ title: "Updated", revision: 3 });
      expect(
        (yield* Effect.flip(store.archiveProject({ ...archive, expectedRevision: 2 }))).code,
      ).toBe("project_changed");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("ignores native executions while archived and delayed executions after restore", () =>
    Effect.gen(function* () {
      const sequence = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const store = yield* setup;
        yield* store.initializeTicketExecution;
        yield* store.archiveProject(archive);
        yield* Ref.set(sequence, 3);
        yield* store.consumeTicketExecution({
          sequence: 1,
          run: { id: RunId.make("archived-run"), threadId, startedAt: now },
        });
        yield* store.archiveProject({ ...archive, expectedRevision: 1, archivedAt: null });
        yield* store.consumeTicketExecution({
          sequence: 2,
          run: { id: RunId.make("delayed-run"), threadId, startedAt: now },
        });
        expect((yield* store.getSnapshot).tickets[0]?.status).toBe("todo");
        yield* store.consumeTicketExecution({
          sequence: 4,
          run: { id: RunId.make("new-run"), threadId, startedAt: now },
        });
        expect((yield* store.getSnapshot).tickets[0]?.status).toBe("in_progress");
      }).pipe(Effect.provide(layer(Ref.get(sequence))));
    }),
  );

  it.effect(
    "tombstones all planning while keeping assignment reservations and retained worktree cleanup",
    () => {
      const threads = new Map([[threadId, projectId]]);
      return Effect.gen(function* () {
        const store = yield* setup;
        const attemptId = WorkbenchTicketWorkspaceAttemptId.make("retained-attempt");
        yield* store.claimTicketWorkspace({
          ticketId,
          attemptId,
          branchName: "workbench/retained",
          repositories: [
            { projectId, isPrimary: true, sourcePath: "/repo", worktreePath: "/worktree" },
          ],
          claimedAt: now,
        });
        expect(yield* store.getTicketWorkspaceGeneratedBranchName(ticketId)).toEqual(
          Option.some("workbench/retained"),
        );
        expect((yield* Effect.flip(store.archiveProject(archive))).code).toBe(
          "ticket_workspace_in_use",
        );
        expect((yield* Effect.flip(store.deleteProject(deletion))).code).toBe(
          "ticket_workspace_in_use",
        );
        yield* store.markTicketWorkspaceRepositoryReady({
          ticketId,
          attemptId,
          projectId,
          worktreePath: "/worktree",
          branchName: "workbench/retained",
          updatedAt: now,
        });
        yield* store.completeTicketWorkspace({ ticketId, attemptId, completedAt: now });
        yield* store.archiveProject(archive);
        expect(
          (yield* Effect.flip(
            store.deleteProject({ ...deletion, expectedRevision: 1, expectedTicketCount: 0 }),
          )).code,
        ).toBe("project_changed");
        yield* store.deleteProject({ ...deletion, expectedRevision: 1 });
        const snapshot = yield* store.getSnapshot;
        expect(snapshot.projects).toEqual([]);
        expect(snapshot.tickets).toEqual([]);
        expect(snapshot.epics).toEqual([]);
        expect(snapshot.assignments).toEqual([]);
        expect(snapshot.reservedThreadIds).toEqual([threadId]);
        expect(snapshot.ticketWorkspaces).toHaveLength(1);
        expect(Option.isNone(yield* store.getProject(workspaceId))).toBe(true);
        expect((yield* Effect.flip(store.requireActiveProject(workspaceId))).code).toBe(
          "project_not_found",
        );
        expect(
          (yield* Effect.flip(
            store.createTicket({
              id: WorkbenchTicketId.make("deleted-parent-ticket"),
              projectId: workspaceId,
              title: "Blocked",
              kind: "story",
              markdown: "",
              primaryT3ProjectId: projectId,
              createdAt: now,
            }),
          )).code,
        ).toBe("project_not_found");
        expect(
          (yield* Effect.flip(
            store.claimTicketWorkspaceRelease({
              ticketId,
              attemptId,
              claimedAt: now,
              requireDeletedTicket: true,
            }),
          )).code,
        ).toBe("ticket_workspace_in_use");
        // Native Thread removal is an explicit prerequisite for retained cleanup.
        threads.delete(threadId);
        yield* store.claimTicketWorkspaceRelease({
          ticketId,
          attemptId,
          claimedAt: now,
          requireDeletedTicket: true,
        });
        yield* store.releaseTicketWorkspaceRepository({
          ticketId,
          attemptId,
          projectId,
          releasedAt: now,
        });
        yield* store.completeTicketWorkspaceRelease({ ticketId, attemptId, completedAt: now });
        expect((yield* store.getSnapshot).ticketWorkspaces[0]?.status).toBe("released");
      }).pipe(Effect.provide(layer(undefined, threads)));
    },
  );

  it.effect("adds and removes References without changing the Ticket revision", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const ticket = Option.getOrThrow(yield* store.getTicket(ticketId));
      const issueUrl = "https://acme.atlassian.net/browse/ORBIT-375";
      const added = yield* store.addReference({
        ticketId,
        url: ` ${issueUrl} `,
        title: "Expire invitations",
        addedByThreadId: threadId,
      });
      expect(added).toMatchObject({
        ticketId,
        url: issueUrl,
        title: "Expire invitations",
        addedByThreadId: threadId,
      });
      // Adding the same URL again returns the stored Reference unchanged.
      expect(
        yield* store.addReference({
          ticketId,
          url: issueUrl,
          title: "Other",
          addedByThreadId: null,
        }),
      ).toEqual(added);
      const design = yield* store.addReference({
        ticketId,
        url: "https://figma.com/file/invite",
        addedByThreadId: null,
      });
      expect(design.title).toBeNull();
      expect((yield* store.getSnapshot).references).toEqual([added, design]);
      expect(
        (yield* Effect.flip(
          store.addReference({ ticketId, url: "file:///spec.md", addedByThreadId: null }),
        )).code,
      ).toBe("reference_url_invalid");
      expect(
        (yield* Effect.flip(
          store.addReference({
            ticketId: WorkbenchTicketId.make("missing"),
            url: issueUrl,
            addedByThreadId: null,
          }),
        )).code,
      ).toBe("reference_owner_not_found");

      yield* store.removeReference({ ticketId, url: issueUrl });
      yield* store.removeReference({ ticketId, url: issueUrl });
      expect((yield* store.getSnapshot).references).toEqual([design]);
      expect(Option.getOrThrow(yield* store.getTicket(ticketId)).revision).toBe(ticket.revision);

      // Archived Tickets keep their References editable; deleted ones hide them.
      const archived = yield* store.archiveTicket({
        ticketId,
        archivedAt: now,
        expectedRevision: ticket.revision,
        updatedAt: now,
      });
      yield* store.addReference({ ticketId, url: issueUrl, addedByThreadId: null });
      yield* store.deleteTicket({ ticketId, expectedRevision: archived.revision, deletedAt: now });
      expect((yield* store.getSnapshot).references).toEqual([]);
      expect((yield* Effect.flip(store.removeReference({ ticketId, url: issueUrl }))).code).toBe(
        "reference_owner_not_found",
      );
    }).pipe(Effect.provide(layer())),
  );

  it.effect("creates a Ticket with its staged References in one transaction", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const sql = yield* SqlClient.SqlClient;
      const create = (id: string, urls: ReadonlyArray<string>) =>
        store.createTicket({
          id: WorkbenchTicketId.make(id),
          projectId: workspaceId,
          title: id,
          kind: "story",
          markdown: "",
          primaryT3ProjectId: projectId,
          references: urls.map((url) => ({ url, title: `Title ${url}` })),
          createdAt: now,
        });
      const rejected = yield* Effect.flip(
        create("rejected", ["https://github.com/acme/web/issues/1", "not a url"]),
      );
      expect(rejected.code).toBe("reference_url_invalid");
      expect(yield* store.getTicket(WorkbenchTicketId.make("rejected"))).toEqual(Option.none());
      expect(yield* sql`SELECT 1 FROM workbench_references`).toEqual([]);

      yield* create("staged", [
        "https://github.com/acme/web/issues/1",
        "https://figma.com/file",
        " https://github.com/acme/web/issues/1",
      ]);
      expect(
        (yield* store.getSnapshot).references.map(({ url, title, addedByThreadId }) => ({
          url,
          title,
          addedByThreadId,
        })),
      ).toEqual([
        {
          url: "https://github.com/acme/web/issues/1",
          title: "Title https://github.com/acme/web/issues/1",
          addedByThreadId: null,
        },
        {
          url: "https://figma.com/file",
          title: "Title https://figma.com/file",
          addedByThreadId: null,
        },
      ]);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("edits, archives, and deletes a former Jira Ticket like a local Ticket", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const importedId = WorkbenchTicketId.make("jira:binding:issue:9");
      const imported = yield* store.createTicket({
        id: importedId,
        projectId: workspaceId,
        title: "Imported",
        kind: "story",
        markdown: "",
        primaryT3ProjectId: projectId,
        createdAt: now,
      });
      const reference = yield* store.addReference({
        ticketId: importedId,
        url: orbitIssue(9).url,
        addedByThreadId: null,
      });
      const edited = yield* store.updateTicket({
        id: importedId,
        expectedRevision: imported.revision,
        title: "Edited locally",
        status: "done",
        updatedAt: now,
      });
      expect(edited).toMatchObject({ title: "Edited locally", status: "done" });
      const archived = yield* store.archiveTicket({
        ticketId: importedId,
        archivedAt: now,
        expectedRevision: edited.revision,
        updatedAt: now,
      });
      expect(archived).toMatchObject({ archivedAt: now });
      expect((yield* store.getSnapshot).references).toEqual([reference]);
      const restored = yield* store.archiveTicket({
        ticketId: importedId,
        archivedAt: null,
        expectedRevision: archived.revision,
        updatedAt: now,
      });
      yield* store.deleteTicket({
        ticketId: importedId,
        expectedRevision: restored.revision,
        deletedAt: now,
      });
      expect(yield* store.getTicket(importedId)).toEqual(Option.none());
    }).pipe(Effect.provide(layer())),
  );

  it.effect("settles held execution runs at startup through local admission", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const sql = yield* SqlClient.SqlClient;
      const startedAt = "2026-10-09T11:00:00.000Z";
      const ticketFor = (id: string) =>
        Effect.gen(function* () {
          const ticket = yield* store.createTicket({
            id: WorkbenchTicketId.make(id),
            projectId: workspaceId,
            title: id,
            kind: "story",
            markdown: "",
            primaryT3ProjectId: projectId,
            createdAt: now,
          });
          const assignment = yield* store.createAssignment({
            id: WorkbenchAssignmentId.make(`${id}-assignment`),
            ticketId: ticket.id,
            threadId: ThreadId.make(`${id}-thread`),
            createdAt: now,
          });
          return { ticket, assignment };
        });
      const holdRun = (input: {
        readonly runId: string;
        readonly sequence: number;
        readonly assignment: { readonly id: string; readonly ticketId: string };
        readonly state: "pending" | "uncertain";
      }) => sql`INSERT INTO workbench_execution_runs
            (run_id, sequence, thread_id, ticket_id, assignment_id, started_at, state)
          VALUES (${input.runId}, ${input.sequence}, 'held-thread', ${input.assignment.ticketId},
            ${input.assignment.id}, ${startedAt}, ${input.state})`;
      const eligible = yield* ticketFor("held-eligible");
      const uncertain = yield* ticketFor("held-uncertain");
      const archived = yield* ticketFor("held-archived");
      const superseded = yield* ticketFor("held-superseded");
      const reset = yield* ticketFor("held-reset");
      const advanced = yield* ticketFor("held-advanced");
      yield* store.archiveTicket({
        ticketId: archived.ticket.id,
        archivedAt: now,
        expectedRevision: archived.ticket.revision,
        updatedAt: now,
      });
      yield* sql`UPDATE workbench_assignments SET superseded_at = ${now}
          WHERE assignment_id = ${superseded.assignment.id}`;
      yield* sql`UPDATE workbench_tickets SET execution_after_sequence = 9
          WHERE ticket_id = ${reset.ticket.id}`;
      yield* store.updateTicket({
        id: advanced.ticket.id,
        expectedRevision: advanced.ticket.revision,
        status: "done",
        updatedAt: now,
      });

      // Startup with an existing cursor is the path a restarted server takes.
      yield* store.initializeTicketExecution;
      yield* holdRun({ runId: "eligible-1", sequence: 1, ...eligible, state: "pending" });
      yield* holdRun({ runId: "eligible-2", sequence: 2, ...eligible, state: "uncertain" });
      yield* holdRun({ runId: "uncertain", sequence: 3, ...uncertain, state: "uncertain" });
      yield* holdRun({ runId: "archived", sequence: 4, ...archived, state: "pending" });
      yield* holdRun({ runId: "superseded", sequence: 5, ...superseded, state: "pending" });
      yield* holdRun({ runId: "reset", sequence: 6, ...reset, state: "pending" });
      yield* holdRun({ runId: "advanced", sequence: 7, ...advanced, state: "pending" });
      const before = yield* store.getSnapshot;
      yield* store.initializeTicketExecution;

      expect(yield* sql`SELECT state FROM workbench_execution_runs WHERE state <> 'done'`).toEqual(
        [],
      );
      const after = yield* store.getSnapshot;
      const statusOf = (snapshot: typeof after, id: WorkbenchTicketId) =>
        snapshot.tickets.find((ticket) => ticket.id === id);
      for (const { ticket } of [eligible, uncertain]) {
        expect(statusOf(after, ticket.id)).toMatchObject({
          status: "in_progress",
          revision: statusOf(before, ticket.id)!.revision + 1,
          updatedAt: startedAt,
        });
      }
      for (const { ticket } of [archived, superseded, reset, advanced]) {
        expect(statusOf(after, ticket.id)).toEqual(statusOf(before, ticket.id));
      }
    }).pipe(
      Effect.provide(
        layer(
          undefined,
          new Map(
            [
              threadId,
              ...[
                "held-eligible",
                "held-uncertain",
                "held-archived",
                "held-superseded",
                "held-reset",
                "held-advanced",
              ].map((id) => ThreadId.make(`${id}-thread`)),
            ].map((thread) => [thread, projectId]),
          ),
        ),
      ),
    ),
  );

  it.effect(
    "migrates legacy Workspaces with active defaults and preserves lifecycle on schema restart",
    () =>
      Effect.gen(function* () {
        const store = yield* setup;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM workbench_schema_migrations WHERE version = 16`;
        yield* sql`ALTER TABLE workbench_projects DROP COLUMN archived_at`;
        yield* sql`ALTER TABLE workbench_projects DROP COLUMN deleted_at`;
        yield* sql`ALTER TABLE workbench_projects DROP COLUMN revision`;
        yield* sql`ALTER TABLE workbench_projects DROP COLUMN execution_after_sequence`;
        yield* ensureWorkbenchSchema;
        expect(Option.getOrThrow(yield* store.getProject(workspaceId))).toMatchObject({
          archivedAt: null,
          revision: 0,
        });
        yield* store.archiveProject(archive);
        yield* ensureWorkbenchSchema;
        expect(Option.getOrThrow(yield* store.getProject(workspaceId))).toMatchObject({
          archivedAt: now,
          revision: 1,
        });
        yield* store.archiveProject({ ...archive, expectedRevision: 1, archivedAt: null });
        yield* store.deleteProject({ ...deletion, expectedRevision: 2 });
        yield* ensureWorkbenchSchema;
        expect((yield* store.getSnapshot).projects).toEqual([]);
        expect((yield* store.getSnapshot).reservedThreadIds).toEqual([threadId]);
      }).pipe(Effect.provide(layer())),
  );

  it.effect("rolls back descendant tombstones if deleting the Workspace fails", () =>
    Effect.gen(function* () {
      const store = yield* setup;
      const sql = yield* SqlClient.SqlClient;
      const before = yield* store.getSnapshot;
      yield* sql`CREATE TRIGGER fail_workspace_delete AFTER UPDATE OF deleted_at ON workbench_projects WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'test rollback'); END`;
      expect((yield* Effect.flip(store.deleteProject(deletion))).code).toBe("persistence_failed");
      expect(yield* store.getSnapshot).toEqual(before);
    }).pipe(Effect.provide(layer())),
  );
});

describe("Ticket Progress and Thread context", () => {
  const projectId = ProjectId.make("progress-project");
  const workspaceId = WorkbenchProjectId.make("progress-workspace");
  const ticketId = WorkbenchTicketId.make("progress-ticket");
  const threadId = ThreadId.make("progress-thread");
  const snapshot = (
    overrides: Partial<WorkbenchThreadContextSnapshot> = {},
  ): WorkbenchThreadContextSnapshot => ({
    ownerId: ticketId,
    revision: 1,
    brief: "Goal",
    progress: "- [ ] PR 1",
    references: [],
    worktrees: [],
    roster: [],
    ...overrides,
  });

  it.effect("keeps Progress apart from the brief and sends snapshots only its counts", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const ticket = yield* seedTicket({ store, projectId, workspaceId, ticketId });
      expect(ticket).toMatchObject({ progress: "", progressDone: 0, progressTotal: 0 });
      const ticked = yield* store.updateTicket({
        id: ticketId,
        expectedRevision: ticket.revision,
        progress: "- [x] PR 1. API\n- [ ] PR 2. Web\nNotes are not items.",
        updatedAt: "2026-09-07T11:00:00.000Z",
      });
      expect(ticked).toMatchObject({ revision: ticket.revision + 1, progressDone: 1 });
      // Progress is not the brief: no Updated by, and the generated summary stays current.
      expect(ticked.updatedByThreadId).toBeNull();
      expect(ticked.generatedSummary).toEqual(ticket.generatedSummary);
      const edited = yield* store.updateTicket({
        id: ticketId,
        expectedRevision: ticked.revision,
        markdown: "A user edit",
        updatedAt: "2026-09-07T12:00:00.000Z",
      });
      expect(edited.progress).toBe(ticked.progress);

      const [snapshotTicket] = (yield* store.getSnapshot).tickets;
      expect(snapshotTicket).not.toHaveProperty("progress");
      expect(snapshotTicket).toMatchObject({ progressDone: 1, progressTotal: 2 });
      expect(Option.getOrThrow(yield* store.getTicket(ticketId)).progress).toBe(ticked.progress);
    }).pipe(Effect.provide(testLayer({ projects: new Set([projectId]) }))),
  );

  it.effect("promotes a run's pending snapshot only when delivered and unambiguous", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const runId = RunId.make("progress-run");
      const record = (brief: string, run = runId) =>
        store.recordPendingThreadContext({
          runId: run,
          threadId,
          snapshot: snapshot({ brief }),
          providerThreadId: "provider-1",
          contextMarker: 2,
        });
      yield* record("First");
      // A repeat of the same snapshot leaves the run unambiguous.
      yield* record("First");
      yield* store.settlePendingThreadContext({
        runId,
        delivered: true,
        providerThreadId: "provider-2",
      });
      expect(Option.getOrThrow(yield* store.getThreadContext(threadId))).toEqual({
        snapshot: snapshot({ brief: "First" }),
        providerThreadId: "provider-2",
        contextMarker: 2,
      });
      // Two different snapshots leave what the run was sent unknown, so it promotes nothing.
      const conflicted = RunId.make("progress-conflicted-run");
      yield* record("Queued", conflicted);
      yield* record("Starting", conflicted);
      yield* store.settlePendingThreadContext({
        runId: conflicted,
        delivered: true,
        providerThreadId: null,
      });
      // Settled once; a replayed completed event finds nothing to promote.
      yield* record("Undelivered", RunId.make("progress-failed-run"));
      yield* store.settlePendingThreadContext({
        runId: RunId.make("progress-failed-run"),
        delivered: false,
        providerThreadId: null,
      });
      yield* store.settlePendingThreadContext({
        runId: RunId.make("progress-failed-run"),
        delivered: true,
        providerThreadId: null,
      });
      expect(Option.getOrThrow(yield* store.getThreadContext(threadId)).snapshot.brief).toBe(
        "First",
      );
    }).pipe(Effect.provide(testLayer())),
  );

  it.effect("records a Thread's own reads into its seen and pending snapshots of that owner", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      const seen = (brief: string) => (current: WorkbenchThreadContextSnapshot) => ({
        ...current,
        brief,
      });
      // Without a record there is nothing to update; the first turn sends everything.
      yield* store.updateSeenThreadContext({ threadId, ownerId: ticketId, update: seen("Read") });
      expect(yield* store.getThreadContext(threadId)).toEqual(Option.none());

      // A first turn's own read reaches its pending snapshot before any record exists.
      const delivered = RunId.make("progress-delivered");
      yield* store.recordPendingThreadContext({
        runId: delivered,
        threadId,
        snapshot: snapshot(),
        providerThreadId: null,
        contextMarker: 0,
      });
      yield* store.updateSeenThreadContext({ threadId, ownerId: ticketId, update: seen("First") });
      yield* store.settlePendingThreadContext({
        runId: delivered,
        delivered: true,
        providerThreadId: null,
      });
      expect(Option.getOrThrow(yield* store.getThreadContext(threadId)).snapshot.brief).toBe(
        "First",
      );
      const running = RunId.make("progress-running");
      yield* store.recordPendingThreadContext({
        runId: running,
        threadId,
        snapshot: snapshot(),
        providerThreadId: null,
        contextMarker: 0,
      });
      yield* store.updateSeenThreadContext({ threadId, ownerId: ticketId, update: seen("Read") });
      yield* store.updateSeenThreadContext({
        threadId,
        ownerId: WorkbenchTicketId.make("another-ticket"),
        update: seen("Elsewhere"),
      });
      expect(Option.getOrThrow(yield* store.getThreadContext(threadId)).snapshot.brief).toBe(
        "Read",
      );
      // The running turn's snapshot is promoted late; it must not bring the old brief back.
      yield* store.settlePendingThreadContext({
        runId: running,
        delivered: true,
        providerThreadId: null,
      });
      expect(Option.getOrThrow(yield* store.getThreadContext(threadId)).snapshot.brief).toBe(
        "Read",
      );
    }).pipe(Effect.provide(testLayer())),
  );

  it.effect("keeps Progress and each Thread's seen context across a restart", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "workbench-progress-" });
      const filename = `${directory}/state.sqlite`;
      const runId = RunId.make("progress-restart-run");
      yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        const ticket = yield* seedTicket({ store, projectId, workspaceId, ticketId });
        yield* store.updateTicket({
          id: ticketId,
          expectedRevision: ticket.revision,
          progress: "- [x] PR 1",
          updatedAt: "2026-09-07T11:00:00.000Z",
        });
        yield* store.recordPendingThreadContext({
          runId,
          threadId,
          snapshot: snapshot({ progress: "- [x] PR 1" }),
          providerThreadId: "provider-1",
          contextMarker: 4,
        });
        yield* store.settlePendingThreadContext({
          runId,
          delivered: true,
          providerThreadId: null,
        });
      }).pipe(Effect.provide(fileLayer(filename, { projects: new Set([projectId]) })));
      yield* Effect.gen(function* () {
        const store = yield* WorkbenchStore;
        expect(Option.getOrThrow(yield* store.getTicket(ticketId)).progress).toBe("- [x] PR 1");
        expect(Option.getOrThrow(yield* store.getThreadContext(threadId))).toEqual({
          snapshot: snapshot({ progress: "- [x] PR 1" }),
          providerThreadId: "provider-1",
          contextMarker: 4,
        });
      }).pipe(Effect.provide(fileLayer(filename)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("retitles a Reference in place and refuses an unknown URL", () =>
    Effect.gen(function* () {
      const store = yield* WorkbenchStore;
      yield* seedTicket({ store, projectId, workspaceId, ticketId });
      yield* store.createAssignment({
        id: WorkbenchAssignmentId.make("progress-assignment"),
        ticketId,
        threadId,
        createdAt: "2026-09-07T10:00:00.000Z",
      });
      const first = yield* store.addReference({
        ticketId,
        url: "/artifacts/progress-ticket/mockup-v1.png",
        title: "Mockup v1 (proposed)",
        addedByThreadId: null,
      });
      const second = yield* store.addReference({
        ticketId,
        url: "/artifacts/progress-ticket/plan.md",
        title: "Plan",
        addedByThreadId: null,
      });
      const retitled = yield* store.updateReference({
        ticketId,
        url: first.url,
        title: "Mockup v1 (approved)",
        actingThreadId: threadId,
      });
      expect(retitled).toEqual({ ...first, title: "Mockup v1 (approved)" });
      expect(yield* store.listReferences(ticketId)).toEqual([retitled, second]);
      const missing = yield* Effect.flip(
        store.updateReference({
          ticketId,
          url: "/artifacts/progress-ticket/missing.png",
          title: "Missing",
          actingThreadId: threadId,
        }),
      );
      expect(missing.code).toBe("reference_not_found");
    }).pipe(
      Effect.provide(
        testLayer({ projects: new Set([projectId]), threads: new Map([[threadId, projectId]]) }),
      ),
    ),
  );
});
