import { WorkbenchAgentService } from "@t3tools/workbench/WorkbenchAgentService";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { WorkbenchToolkit } from "./tools.ts";

// Ownership comes from the calling Thread, so no tool takes a Ticket id.
const callerThreadId = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "This Workbench tool")),
  Effect.map((scope) => scope.thread.threadId),
);

const handlers = {
  workbench_ticket_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const service = yield* WorkbenchAgentService;
      return yield* service.read(yield* callerThreadId);
    }),
  ),
  workbench_ticket_update: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const service = yield* WorkbenchAgentService;
      return yield* service.update({ ...input, threadId: yield* callerThreadId });
    }),
  ),
  workbench_reference_add: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const service = yield* WorkbenchAgentService;
      return yield* service.addReference({ ...input, threadId: yield* callerThreadId });
    }),
  ),
  workbench_reference_remove: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const service = yield* WorkbenchAgentService;
      yield* service.removeReference({ ...input, threadId: yield* callerThreadId });
      return {};
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof WorkbenchToolkit.tools>;

export const layer = McpToolAccess.toLayer(WorkbenchToolkit, handlers);
