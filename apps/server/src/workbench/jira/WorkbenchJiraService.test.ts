import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { WorkbenchStoreLive } from "../WorkbenchStore.ts";
import { JiraApi } from "./JiraApi.ts";
import { JiraAuthService } from "./JiraAuthService.ts";
import { JiraSyncService } from "./JiraSyncService.ts";
import {
  WorkbenchJiraRepository,
  WorkbenchJiraRepositoryError,
  type WorkbenchJiraRepositoryShape,
} from "./WorkbenchJiraRepository.ts";
import * as WorkbenchJiraService from "./WorkbenchJiraService.ts";

const TestLayer = WorkbenchStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

describe("WorkbenchJiraService", () => {
  it.effect("reads a Jira snapshot in one transaction", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE workbench_jira_snapshot_probe (id INTEGER PRIMARY KEY)`;
      const repositoryFailure = new WorkbenchJiraRepositoryError({
        cause: "binding read failed",
      });
      const repository = WorkbenchJiraRepository.of({
        findConnectionByCloudId: () => Effect.succeed(Option.none()),
        getConnection: () => Effect.succeed(Option.none()),
        listConnections: () =>
          sql`INSERT INTO workbench_jira_snapshot_probe (id) VALUES (1)`.pipe(
            Effect.mapError((cause) => new WorkbenchJiraRepositoryError({ cause })),
            Effect.as([]),
          ),
        getCredentialId: () => Effect.succeed(Option.none()),
        upsertConnection: () => Effect.void,
        upsertConnections: () => Effect.void,
        getBinding: () => Effect.succeed(Option.none()),
        listBindings: () => Effect.fail(repositoryFailure),
        upsertBinding: () => Effect.void,
        updateBindingSyncMetadata: () => Effect.succeed(true),
        listIssueLinks: () => Effect.succeed([]),
        replaceIssueLinks: () => Effect.void,
      } satisfies WorkbenchJiraRepositoryShape);
      const api = JiraApi.of({
        listProjects: () => Effect.die("unexpected project read"),
        listBoards: () => Effect.die("unexpected board read"),
        listSprints: () => Effect.die("unexpected sprint read"),
        getBoardConfiguration: () => Effect.die("unexpected configuration read"),
        listAssignedSprintIssues: () => Effect.die("unexpected issue read"),
      });
      const auth = JiraAuthService.of({
        begin: () => Effect.die("unexpected auth start"),
        complete: () => Effect.die("unexpected auth completion"),
        getAccessToken: () => Effect.die("unexpected token read"),
      });
      const sync = JiraSyncService.of({
        withBindingPermit: (_bindingId, effect) => effect,
        syncBinding: () => Effect.die("unexpected Jira synchronization"),
      });
      const service = yield* WorkbenchJiraService.make.pipe(
        Effect.provideService(WorkbenchJiraRepository, repository),
        Effect.provideService(JiraApi, api),
        Effect.provideService(JiraAuthService, auth),
        Effect.provideService(JiraSyncService, sync),
      );

      const error = yield* Effect.flip(service.getSnapshot);
      const probeRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM workbench_jira_snapshot_probe
      `;

      expect(error).toMatchObject({
        code: "persistence_failed",
        message: "Jira connection state could not be saved or loaded.",
      });
      expect(probeRows[0]?.count).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
  );
});
