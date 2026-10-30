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
import { REFERENCES_RULE } from "../agentInstructions.ts";

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
      description: "Goal, open questions, decisions. Replaces the brief.",
    }),
  ),
  progress: Schema.optional(
    Schema.String.check(Schema.isMaxLength(20_000)).annotate({
      description: "One `- [ ]` per task or PR. Replaces the list.",
    }),
  ),
  status: Schema.optional(WorkbenchTicketStatus.annotate({ description: "Not for drafts." })),
  repositoryProjectIds: Schema.optional(
    Schema.Array(ProjectId)
      .check(Schema.isMinLength(1))
      .annotate({ description: "The full list, from `repositories[].projectId`." }),
  ),
});

const ReadWorkstreamTool = Tool.make("workbench_ticket_read", {
  description:
    "Read your Ticket: brief, progress, status, repositories, References, Threads, PRs, `artifactsDir`.",
  parameters: Tool.EmptyParams,
  success: WorkstreamState,
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read Ticket")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UpdateWorkstreamTool = Tool.make("workbench_ticket_update", {
  description:
    "Change this thread's Ticket. Pass only the fields to change. A stale `expectedRevision` fails; read again and retry.",
  parameters: WorkstreamUpdateInput,
  success: WorkstreamUpdateResult,
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Update Ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const AddReferenceTool = Tool.make("workbench_reference_add", {
  description:
    `${REFERENCES_RULE} Link delivery PRs with link_pull_request instead. Existing URLs are a no-op.`,
  parameters: Schema.Struct({
    url: ReferenceUrl,
    title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
  }),
  success: AgentReferenceResult,
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Add Ticket Reference")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const RemoveReferenceTool = Tool.make("workbench_reference_remove", {
  description: "Remove a Reference by URL.",
  parameters: Schema.Struct({ url: ReferenceUrl }),
  success: Schema.Struct({}),
  failure: WorkbenchToolError,
  dependencies,
})
  .annotate(Tool.Title, "Remove Ticket Reference")
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
