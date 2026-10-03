// @effect-diagnostics nodeBuiltinImport:off - Only stopped disposable demos use these projection-only screenshot fixtures.
import type * as NodeSqlite from "node:sqlite";
import {
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
} from "../../packages/contracts/src/baseSchemas.ts";
import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2RunJson,
  OrchestrationV2TurnItemJson,
  type OrchestrationV2Run,
} from "../../packages/contracts/src/orchestrationV2.ts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const decodeThread = Schema.decodeSync(Schema.fromJsonString(OrchestrationV2AppThreadJson));
const encodeThread = Schema.encodeSync(Schema.fromJsonString(OrchestrationV2AppThreadJson));
const encodeMessage = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationV2ConversationMessageJson),
);
const encodeRun = Schema.encodeSync(Schema.fromJsonString(OrchestrationV2RunJson));
const encodeTurnItem = Schema.encodeSync(Schema.fromJsonString(OrchestrationV2TurnItemJson));

export const readVisualThread = ({
  db,
  threadId,
}: {
  db: NodeSqlite.DatabaseSync;
  threadId: string;
}) => {
  const row = db
    .prepare("SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = ?")
    .get(threadId);
  if (typeof row?.payload_json !== "string")
    throw new Error(
      "Run seed before adding synthetic history; native Thread is missing: " + threadId,
    );
  return decodeThread(row.payload_json);
};

/** Native projection payloads are schema-encoded; neither events nor provider sessions are fabricated. */
export const insertVisualMessage = ({
  db,
  messageId,
  threadId,
  role,
  text,
  timestamp,
  runId = null,
}: {
  db: NodeSqlite.DatabaseSync;
  messageId: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  runId?: RunId | null;
}) => {
  readVisualThread({ db, threadId });
  const id = MessageId.make(messageId);
  const thread = ThreadId.make(threadId);
  const at = DateTime.makeUnsafe(timestamp);
  const payload = encodeMessage({
    id,
    threadId: thread,
    runId,
    nodeId: null,
    role,
    text,
    createdBy: "system",
    creationSource: "server",
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
  });
  db.prepare(`INSERT OR IGNORE INTO orchestration_v2_projection_messages
    (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
    VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?)`).run(
    id,
    thread,
    runId,
    role,
    timestamp,
    timestamp,
    payload,
  );
  const ordinalRow = db
    .prepare(
      "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM orchestration_v2_projection_turn_items WHERE thread_id = ?",
    )
    .get(threadId);
  if (typeof ordinalRow?.ordinal !== "number")
    throw new Error("Invalid synthetic timeline ordinal.");
  const base = {
    id: TurnItemId.make(messageId + "-item"),
    threadId: thread,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: ordinalRow.ordinal,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
  const item =
    role === "assistant"
      ? { ...base, type: "assistant_message" as const, messageId: id, text, streaming: false }
      : {
          ...base,
          type: "user_message" as const,
          messageId: id,
          text,
          attachments: [],
          inputIntent: "turn_start" as const,
          createdBy: "system" as const,
          creationSource: "server" as const,
        };
  const itemPayload = encodeTurnItem(item);
  db.prepare(`INSERT OR IGNORE INTO orchestration_v2_projection_turn_items
    (turn_item_id, thread_id, run_id, node_id, provider_thread_id, provider_turn_id,
      parent_item_id, ordinal, type, status, updated_at, payload_json)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 'completed', ?, ?)`).run(
    base.id,
    thread,
    runId,
    base.ordinal,
    item.type,
    timestamp,
    itemPayload,
  );
};

export const seedVisualRun = ({
  db,
  threadId,
  runId,
  status,
  timestamp,
}: {
  db: NodeSqlite.DatabaseSync;
  threadId: string;
  runId: string;
  status: Extract<OrchestrationV2Run["status"], "completed" | "interrupted">;
  timestamp: string;
}) => {
  const thread = readVisualThread({ db, threadId });
  const ordinalRow = db
    .prepare(
      "SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM orchestration_v2_projection_runs WHERE thread_id = ?",
    )
    .get(threadId);
  if (typeof ordinalRow?.ordinal !== "number") throw new Error("Invalid synthetic run ordinal.");
  const at = DateTime.makeUnsafe(timestamp);
  const id = RunId.make(runId);
  const userMessageId = MessageId.make(runId + "-user");
  const payload = encodeRun({
    id,
    threadId: thread.id,
    ordinal: ordinalRow.ordinal,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    providerThreadId: null,
    userMessageId,
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at,
    startedAt: at,
    completedAt: at,
    checkpointId: null,
    contextHandoffId: null,
  });
  db.prepare(`INSERT INTO orchestration_v2_projection_runs
    (run_id, thread_id, ordinal, provider, provider_instance_id, provider_thread_id,
      status, requested_at, completed_at, payload_json)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(
    id,
    thread.id,
    ordinalRow.ordinal,
    thread.providerInstanceId,
    thread.providerInstanceId,
    status,
    timestamp,
    timestamp,
    payload,
  );
  insertVisualMessage({
    db,
    messageId: userMessageId,
    threadId,
    runId: id,
    role: "user",
    text: "[Synthetic attention fixture] Show the simulated outcome. No provider executed this request.",
    timestamp,
  });
  // Shell readers derive run status from runs, and freshness from the native Thread payload.
  const updated = encodeThread({
    ...thread,
    updatedAt: at,
  });
  db.prepare(
    "UPDATE orchestration_v2_projection_threads SET updated_at = ?, payload_json = ? WHERE thread_id = ?",
  ).run(timestamp, updated, thread.id);
};
