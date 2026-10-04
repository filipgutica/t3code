import {
  OrchestrationV2AppThread,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const encodeThreadPayload = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2AppThread));

/** A complete native V2 shell for Workbench adapter tests. */
export const nativeThreadShell = ({
  threadId,
  projectId,
  title = "Ticket work",
  createdAt,
  worktreePath = null,
  archivedAt = null,
  deletedAt = null,
}: {
  threadId: string;
  projectId: string;
  title?: string;
  createdAt: string;
  worktreePath?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
}): OrchestrationV2ThreadShell => {
  const id = ThreadId.make(threadId);
  const providerInstanceId = ProviderInstanceId.make("codex");
  return {
    id,
    projectId: ProjectId.make(projectId),
    title,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    activeProviderThreadId: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: DateTime.makeUnsafe(createdAt),
    updatedAt: DateTime.makeUnsafe(createdAt),
    archivedAt: archivedAt === null ? null : DateTime.makeUnsafe(archivedAt),
    settledOverride: null,
    settledAt: null,
    deletedAt: deletedAt === null ? null : DateTime.makeUnsafe(deletedAt),
  };
};

/** Uses the caller's SQL client so uncommitted native rows share Workbench's transaction. */
export const seedNativeThread = (input: Parameters<typeof nativeThreadShell>[0]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const thread = nativeThreadShell(input);
    const payload = yield* encodeThreadPayload({
      ...thread,
      lastVisitedAt: thread.lastVisitedAt ?? null,
    });
    yield* sql`
      INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, provider_instance_id,
        runtime_mode, interaction_mode, active_provider_thread_id,
        created_at, updated_at, archived_at, deleted_at, payload_json
      ) VALUES (
        ${thread.id}, ${thread.projectId}, ${thread.title}, ${thread.providerInstanceId},
        ${thread.providerInstanceId}, ${thread.runtimeMode}, ${thread.interactionMode}, NULL,
        ${input.createdAt}, ${input.createdAt}, ${input.archivedAt ?? null},
        ${input.deletedAt ?? null}, ${payload}
      )
    `;
  });
