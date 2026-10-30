// @effect-diagnostics nodeBuiltinImport:off - Exercises the demo seed against the real Workbench schema.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  parseWorkbenchReferenceUrl,
  workbenchProgressCounts,
} from "../../packages/contracts/src/workbench.ts";
import * as NodeSqliteClient from "../../packages/shared/src/nodeSqliteClient.ts";
import { ensureWorkbenchSchema } from "../../packages/workbench/src/WorkbenchSchema.ts";
import { seedDemoReferences } from "./issue-links.mts";

const NOW = "2026-01-01T00:00:00.000Z";

it.effect("seeds Orbit References of every listed kind after the current migrations", () =>
  Effect.gen(function* () {
    const home = yield* Effect.tryPromise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-demo-references-")),
    );
    try {
      const userdata = NodePath.join(home, "userdata");
      NodeFS.mkdirSync(userdata);
      const filename = NodePath.join(userdata, "statev2.sqlite");
      yield* ensureWorkbenchSchema.pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
      const db = new NodeSqlite.DatabaseSync(filename);
      try {
        db.prepare(
          "INSERT INTO workbench_projects (project_id, title, created_at, updated_at) VALUES ('orbit', 'Orbit', ?, ?)",
        ).run(NOW, NOW);
        db.prepare(
          "INSERT INTO workbench_projects (project_id, title, created_at, updated_at) VALUES ('beacon', 'Beacon', ?, ?)",
        ).run(NOW, NOW);
        db.prepare(
          "INSERT INTO workbench_epics (epic_id, workbench_project_id, title, markdown, created_at, updated_at) VALUES ('orbit-onboarding', 'orbit', 'Onboarding', '', ?, ?)",
        ).run(NOW, NOW);
        for (const id of ["orbit-001", "orbit-002", "orbit-005"]) {
          db.prepare(
            `INSERT INTO workbench_tickets (ticket_id, workbench_project_id, title, markdown, primary_t3_project_id, status, blocked, created_at, updated_at)
             VALUES (?, 'orbit', ?, '', 'orbit-web', 'todo', 0, ?, ?)`,
          ).run(id, id, NOW, NOW);
        }
        db.prepare(
          `INSERT INTO workbench_tickets (ticket_id, workbench_project_id, title, markdown, primary_t3_project_id, status, blocked, created_at, updated_at)
           VALUES ('beacon-009', 'beacon', 'Setup command', '', 'beacon-cli', 'in_progress', 0, ?, ?)`,
        ).run(NOW, NOW);
      } finally {
        db.close();
      }

      seedDemoReferences(home);

      const read = new NodeSqlite.DatabaseSync(filename, { readOnly: true });
      try {
        const progress = read
          .prepare(
            "SELECT ticket_id, progress, progress_updated_by_thread_id FROM workbench_tickets WHERE progress != '' ORDER BY ticket_id",
          )
          .all();
        assert.deepStrictEqual(
          progress.map((row) => ({
            id: row.ticket_id,
            threadId: row.progress_updated_by_thread_id,
            ...workbenchProgressCounts(String(row.progress)),
          })),
          [
            { id: "beacon-009", threadId: "beacon-009-thread", done: 2, total: 3 },
            { id: "orbit-001", threadId: "orbit-001-thread", done: 1, total: 3 },
          ],
        );
        const references = read
          .prepare(
            "SELECT ticket_id AS ticketId, url FROM workbench_references ORDER BY ticket_id, position",
          )
          .all()
          .map((row) => ({
            ticketId: String(row.ticketId),
            kind: parseWorkbenchReferenceUrl(String(row.url))?.kind,
            url: String(row.url),
          }));
        assert.deepStrictEqual(
          references.map(({ ticketId, kind }) => [ticketId, kind]),
          [
            ["orbit-001", "jira_issue"],
            ["orbit-001", "github_issue"],
            ["orbit-001", "link"],
            ["orbit-001", "file"],
            ["orbit-002", "jira_issue"],
            ["orbit-005", "jira_issue"],
          ],
        );
        const file = references.find((reference) => reference.kind === "file")?.url ?? "";
        assert.strictEqual(
          NodePath.dirname(file),
          NodePath.join(userdata, "workbench-artifacts", "orbit-001"),
        );
        assert.include(NodeFS.readFileSync(file, "utf8"), "Synthetic demo artifact");
        assert.deepStrictEqual(
          { ...read.prepare("SELECT jira_issue_key AS key FROM workbench_epics").get() },
          { key: "ORBIT-100" },
        );
      } finally {
        read.close();
      }
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);
