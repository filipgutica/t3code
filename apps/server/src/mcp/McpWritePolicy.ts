import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Environment owners can restrict mutations without replacing native caller authorization. */
export class McpWritePolicy extends Context.Reference<{
  readonly assertAllowed: (
    threadId: ThreadId,
    operation?: "research",
  ) => Effect.Effect<void, OrchestratorMcpFailure>;
}>("t3/mcp/McpWritePolicy", {
  defaultValue: () => ({
    assertAllowed: (_, operation) =>
      operation === "research"
        ? Effect.fail(
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "This read-only credential does not allow browser research operations.",
            }),
          )
        : Effect.void,
  }),
}) {}
