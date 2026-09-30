// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Disposable demo fixtures own host provisioning outside the application runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { CommandId, ProjectId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
} from "../../packages/contracts/src/orchestration.ts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import {
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "../../packages/contracts/src/workbench.ts";
import { dispatch, runRpc } from "./local.mts";

const repository = "workbench-synthetic/attention-fixtures";
const prefix = "synthetic-attention-";
const fixtures = [
  { id: "waiting", title: "Waiting Thread", state: "interrupted" },
  { id: "review", title: "Review-ready work", state: "completed" },
  { id: "failed", title: "Failed PR checks", pr: 901 },
  { id: "feedback", title: "Unresolved PR feedback", pr: 902 },
  { id: "clean", title: "Clean Ticket" },
  { id: "settled", title: "Excluded settled Thread", state: "interrupted" },
  { id: "archived", title: "Excluded archived Thread", state: "interrupted" },
  { id: "superseded", title: "Excluded superseded Thread", state: "interrupted" },
  { id: "multiple", title: "Non-primary Thread needs input", state: "interrupted" },
  { id: "unavailable", title: "PR inspection unavailable", pr: 903 },
  { id: "incomplete", title: "PR inspection incomplete", pr: 904 },
  { id: "loading", title: "Slow PR inspection", pr: 905 },
] as const;

/** Installed only in a disposable, credential-free preview. It never forwards to real gh. */
export const installAttentionGitHubAdapter = async (
  home: string,
  environment: NodeJS.ProcessEnv,
) => {
  const bin = NodePath.join(home, "attention-bin");
  await NodeFSP.mkdir(bin, { recursive: true });
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await NodeFSP.writeFile(
    NodePath.join(bin, "gh"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(NodePath.join(import.meta.dirname, "gh-attention.mjs"))} "$@"\n`,
    { mode: 0o700 },
  );
  return { ...environment, PATH: `${bin}${NodePath.delimiter}${environment.PATH ?? ""}` };
};

/** Native RPC receipts create all records; provider outcomes are seeded offline afterwards. */
export const seedAttentionRecords = async ({
  home,
  wsUrl,
  token,
  modelSelection,
}: {
  home: string;
  wsUrl: string;
  token: string;
  modelSelection: ModelSelection;
}) => {
  const timestamp = new Date().toISOString();
  const projectId = ProjectId.make("orbit-web");
  const epicId = WorkbenchEpicId.make(prefix + "epic");
  await runRpc(wsUrl, token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchCreateEpic]({
      id: epicId,
      projectId: WorkbenchProjectId.make("orbit"),
      title: "Synthetic attention fixtures",
      createdAt: timestamp,
      markdown: "Synthetic review data. No provider executed and no GitHub request is sent.",
    }),
  );
  for (const fixture of fixtures) {
    const ticketId = WorkbenchTicketId.make(prefix + fixture.id);
    const threadId = ThreadId.make(prefix + fixture.id);
    await runRpc(wsUrl, token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateTicket]({
        id: ticketId,
        projectId: WorkbenchProjectId.make("orbit"),
        epicId,
        title: `[Synthetic attention] ${fixture.title}`,
        kind: "story",
        primaryT3ProjectId: projectId,
        repositoryProjectIds: [projectId],
        createdAt: timestamp,
        markdown:
          "Synthetic attention fixture. Thread outcomes and linked PR inspections are simulated. No provider ran. GitHub writes, including reruns, are refused by the demo adapter.",
      }),
    );
    const createThread = async (id: ThreadId, createdAt: string) => {
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.create",
          commandId: CommandId.make(id + "-create"),
          threadId: id,
          projectId,
          title: `[Synthetic attention] ${fixture.title}${id === threadId ? "" : " — newest clean assignment"}`,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      );
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.auto-settle.set",
          commandId: CommandId.make(id + "-no-auto-settle"),
          threadId: id,
          enabled: false,
        }),
      );
    };
    await createThread(threadId, timestamp);
    await runRpc(wsUrl, token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateAssignment]({
        id: WorkbenchAssignmentId.make(threadId + "-assignment"),
        ticketId,
        threadId,
        createdAt: timestamp,
      }),
    );
    if ("pr" in fixture)
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.pull-request.link",
          commandId: CommandId.make(threadId + "-pr"),
          threadId,
          host: "github.com",
          repository,
          number: fixture.pr,
          url: `https://github.com/${repository}/pull/${fixture.pr}`,
          source: "manual",
        }),
      );
    if (fixture.id === "settled" || fixture.id === "archived")
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: fixture.id === "settled" ? "thread.settle" : "thread.archive",
          commandId: CommandId.make(threadId + "-exclude"),
          threadId,
        }),
      );
    if (fixture.id === "superseded" || fixture.id === "multiple") {
      const nextThreadId = ThreadId.make(threadId + "-newest-clean");
      const later = new Date(Date.parse(timestamp) + 1000).toISOString();
      await createThread(nextThreadId, later);
      if (fixture.id === "superseded")
        await runRpc(wsUrl, token, (client) =>
          client[WORKBENCH_WS_METHODS.workbenchReplaceAssignment]({
            id: WorkbenchAssignmentId.make(nextThreadId + "-assignment"),
            ticketId,
            previousThreadId: threadId,
            threadId: nextThreadId,
            replacedAt: later,
          }),
        );
      else
        await runRpc(wsUrl, token, (client) =>
          client[WORKBENCH_WS_METHODS.workbenchCreateAssignment]({
            id: WorkbenchAssignmentId.make(nextThreadId + "-assignment"),
            ticketId,
            threadId: nextThreadId,
            createdAt: later,
          }),
        );
    }
  }
  await NodeFSP.writeFile(
    NodePath.join(home, ".synthetic-attention-owned"),
    "synthetic-attention-v1\n",
    { mode: 0o600 },
  );
};

/** Projection-only outcomes, called after the seeding server has exited. Never an event history. */
export const seedAttentionOutcomes = async (home: string) => {
  if (
    (await NodeFSP.readFile(NodePath.join(home, ".synthetic-attention-owned"), "utf8")) !==
    "synthetic-attention-v1\n"
  )
    throw new Error("Synthetic attention records have not been seeded in this home.");
  const runtimePath = NodePath.join(home, "userdata", "server-runtime.json");
  const runtime: unknown = await NodeFSP.readFile(runtimePath, "utf8").then(
    (text) => JSON.parse(text),
    (error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (runtime !== null) {
    if (typeof runtime !== "object" || !("pid" in runtime) || typeof runtime.pid !== "number")
      throw new Error("Invalid demo server runtime record.");
    let active = true;
    try {
      process.kill(runtime.pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") active = false;
      else throw error;
    }
    if (active) throw new Error("Stop the demo server before seeding synthetic outcomes.");
  }
  const db = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata", "state.sqlite"));
  const timestamp = new Date().toISOString();
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const fixture of fixtures) {
      const id = prefix + fixture.id;
      if (!db.prepare("SELECT thread_id FROM projection_threads WHERE thread_id = ?").get(id))
        throw new Error("Synthetic attention native Thread is missing: " + id);
      if ("state" in fixture) {
        const turn = id + "-turn";
        db.prepare(
          "INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, started_at, completed_at, checkpoint_files_json) VALUES (?, ?, ?, ?, ?, ?, '[]')",
        ).run(id, turn, fixture.state, timestamp, timestamp, timestamp);
        db.prepare("UPDATE projection_threads SET latest_turn_id = ? WHERE thread_id = ?").run(
          turn,
          id,
        );
      }
      const sampleContext =
        fixture.id === "waiting" || fixture.id === "multiple"
          ? "\n\n[Synthetic waiting question] Should invitation links expire after 24 hours or 7 days? Choose one before continuing."
          : fixture.id === "review"
            ? "\n\n[Synthetic review summary] Example outcomes to review: valid invitations show the next step, empty or malformed addresses show a useful error, and expired links offer a recovery action. This is sample review context only; no provider ran and no actual code diff exists."
            : "";
      db.prepare(
        "INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at) VALUES (?, ?, 'assistant', ?, 0, ?, ?)",
      ).run(
        id + "-label",
        id,
        "[Synthetic attention fixture] No provider ran. Turn outcomes and PR inspections are simulated; rerun requests are refused. See the fixture guide." +
          sampleContext,
        timestamp,
        timestamp,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
};
