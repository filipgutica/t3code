import {
  NonNegativeInt,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
  WorkbenchOperationError,
  WorkbenchTicketStatus,
} from "@t3tools/contracts";
import {
  AgentReferenceResult,
  WorkbenchAgentService,
  WorkstreamChangedError,
  WorkstreamNotOwnedError,
  WorkstreamState,
  WorkstreamUpdateResult,
} from "@t3tools/workbench/WorkbenchAgentService";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  WorkbenchAgentService,
];

const WorkbenchToolError = Schema.Union([
  OrchestratorMcpFailure,
  WorkbenchOperationError,
  WorkstreamNotOwnedError,
  WorkstreamChangedError,
]);

const ReferenceUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)).annotate({
  description: "http(s) URL, or an absolute path to a file on this machine.",
});

const WorkstreamUpdateInput = Schema.Struct({
  expectedRevision: NonNegativeInt.annotate({ description: "`revision` from your last read." }),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(240))),
  brief: Schema.optional(
    Schema.String.check(Schema.isMaxLength(120_000)).annotate({
      description: "Markdown. Replaces the whole brief.",
    }),
  ),
  status: Schema.optional(WorkbenchTicketStatus.annotate({ description: "Not for drafts." })),
  repositoryProjectIds: Schema.optional(
    Schema.Array(ProjectId)
      .check(Schema.isMinLength(1))
      .annotate({ description: "The full list, from `repositories[].projectId`." }),
  ),
});

const ReadWorkstreamTool = Tool.make("workbench_workstream_read", {
  description:
    "Read the Workstream this thread belongs to: brief, status, repositories with worktrees, References, Threads, PRs, and `artifactsDir`. The user and other threads edit it while you work, so read it before you rely on it.",
  parameters: Tool.EmptyParams,
  success: WorkstreamState,
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read Workstream")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UpdateWorkstreamTool = Tool.make("workbench_workstream_update", {
  description:
    "Change this thread's Workstream. Pass only the fields to change. A stale `expectedRevision` fails with the current one: read again, then retry. Returns the new state.",
  parameters: WorkstreamUpdateInput,
  success: WorkstreamUpdateResult,
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Update Workstream")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const AddReferenceTool = Tool.make("workbench_reference_add", {
  description:
    "Record a Reference on this thread's Workstream: an issue, PR, spec, design, or doc URL, or a file you saved. Adding a URL again is a no-op.",
  parameters: Schema.Struct({
    url: ReferenceUrl,
    title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
  }),
  success: AgentReferenceResult,
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Add Workstream Reference")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const RemoveReferenceTool = Tool.make("workbench_reference_remove", {
  description: "Remove a Reference from this thread's Workstream by URL. A missing URL is a no-op.",
  parameters: Schema.Struct({ url: ReferenceUrl }),
  success: Schema.Struct({}),
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Remove Workstream Reference")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const WorkbenchToolkit = Toolkit.make(
  ReadWorkstreamTool,
  UpdateWorkstreamTool,
  AddReferenceTool,
  RemoveReferenceTool,
);
