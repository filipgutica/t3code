import type { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Environment owners can restrict mutations without replacing native caller authorization. */
export class McpWritePolicy extends Context.Reference<{
  readonly assertAllowed: (threadId: ThreadId) => Effect.Effect<void, OrchestratorMcpFailure>;
}>("t3/mcp/McpWritePolicy", {
  defaultValue: () => ({ assertAllowed: () => Effect.void }),
}) {}
