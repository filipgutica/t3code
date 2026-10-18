import type {
  HookCallback,
  HookJSONOutput,
  McpServerStatus,
  Options as ClaudeQueryOptions,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";

const CLAUDE_T3_MCP_SERVER_NAME = "t3-code";
const CLAUDE_READ_ONLY_ALLOWED_TOOLS = ["Read", "Glob", "Grep"];
const CLAUDE_RESEARCH_ALLOWED_TOOLS = [
  ...CLAUDE_READ_ONLY_ALLOWED_TOOLS,
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "ToolSearch",
];

// Research may also read Workbench Jira without review. Other T3 tools go to the
// permission mode's reviewer, including the HTML renderers: rendered pages load
// public network resources, so content could leave the sandbox unreviewed.
const researchAllowedTools = (allowedTools: ReadonlyArray<string>) => [
  ...allowedTools.filter(
    (tool) => tool !== "mcp__t3-code__html_preview" && tool !== "mcp__t3-code__html_render",
  ),
  "mcp__t3-code__workbench_jira_read_issue",
  "mcp__t3-code__workbench_jira_search_issues",
];

const CLAUDE_RESEARCH_MCP_TOOL_DENIAL = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      "Research is read-only. This MCP tool is not marked read-only by its server, so it is unavailable here.",
  },
} satisfies HookJSONOutput;

// Mirrors Claude Code's MCP name normalization: mcp__<server>__<tool>, with
// characters outside [A-Za-z0-9_-] replaced by "_", and claude.ai connector
// names also collapsing and trimming underscores.
function claudeMcpNameSegment(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_-]/g, "_");
  return name.startsWith("claude.ai ")
    ? normalized.replace(/_+/g, "_").replace(/^_|_$/g, "")
    : normalized;
}

function claudeMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${claudeMcpNameSegment(serverName)}__${claudeMcpNameSegment(toolName)}`;
}

// Research may run an MCP tool from the injected T3 server, identified by its
// exact name because normalized tool names can collide across servers, or an
// external tool its server marks read-only and not destructive. Classifier
// approval alone must not admit writes.
function claudeResearchMcpToolIsAllowed(input: {
  readonly toolName: string;
  readonly serverName: string | undefined;
  readonly servers: ReadonlyArray<McpServerStatus>;
}): boolean {
  if (input.serverName === CLAUDE_T3_MCP_SERVER_NAME) return true;
  const matches = input.servers
    .filter((server) => input.serverName === undefined || server.name === input.serverName)
    .flatMap((server) =>
      (server.tools ?? [])
        .filter(
          (candidate) =>
            candidate.name === input.toolName ||
            claudeMcpToolName(server.name, candidate.name) === input.toolName,
        )
        .map((tool) => ({ server, tool })),
    );
  const match = matches.length === 1 ? matches[0] : undefined;
  return (
    match !== undefined &&
    (match.server.name === CLAUDE_T3_MCP_SERVER_NAME ||
      (match.tool.annotations?.readOnly === true && match.tool.annotations.destructive !== true))
  );
}

// Research never asks the user, so a dialog takes the CLI's default behavior.
const cancelClaudeUserDialog: NonNullable<ClaudeQueryOptions["onUserDialog"]> = async () => ({
  behavior: "cancelled",
});

const readOnlyOptions = (options: ClaudeQueryOptions): Partial<ClaudeQueryOptions> => ({
  permissionMode: "dontAsk",
  tools: [...CLAUDE_READ_ONLY_ALLOWED_TOOLS],
  allowDangerouslySkipPermissions: false,
  strictMcpConfig: true,
  settings: {
    ...(typeof options.settings === "object" ? options.settings : {}),
    disableAllHooks: true,
  },
});

export const decorate = (input: {
  readonly runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
  readonly mcpServerStatus: () => Promise<ReadonlyArray<McpServerStatus> | undefined>;
}): {
  readonly permissionMode?: PermissionMode;
  readonly reuseKey?: string;
  readonly options?: (native: ClaudeQueryOptions) => Partial<ClaudeQueryOptions>;
} => {
  const auto = input.runtimePolicy.runtimeMode === "auto";
  const sandbox = input.runtimePolicy.sandboxPolicy;
  const readOnly =
    typeof sandbox === "object" &&
    sandbox !== null &&
    "type" in sandbox &&
    sandbox.type === "readOnly";
  if (input.runtimePolicy.toolAccess !== "research") {
    return readOnly ? { reuseKey: "read-only", options: readOnlyOptions } : {};
  }
  // Fails closed: a hook that rejects or times out would not block the tool.
  const researchPreToolUse: HookCallback = (hookInput) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (
          hookInput.hook_event_name !== "PreToolUse" ||
          !hookInput.tool_name.startsWith("mcp__")
        ) {
          return {} satisfies HookJSONOutput;
        }
        const serverName = hookInput.mcp_server?.name;
        const servers =
          serverName === CLAUDE_T3_MCP_SERVER_NAME
            ? []
            : yield* Effect.tryPromise(input.mcpServerStatus).pipe(Effect.timeout("10 seconds"));
        return claudeResearchMcpToolIsAllowed({
          toolName: hookInput.tool_name,
          serverName,
          servers: servers ?? [],
        })
          ? ({} satisfies HookJSONOutput)
          : CLAUDE_RESEARCH_MCP_TOOL_DENIAL;
      }).pipe(Effect.catchCause(() => Effect.succeed(CLAUDE_RESEARCH_MCP_TOOL_DENIAL))),
    );
  return {
    reuseKey: `research:${auto ? "auto" : "plan"}:${readOnly}`,
    ...(auto ? { permissionMode: "auto" as const } : {}),
    options: (options: ClaudeQueryOptions) => ({
      onUserDialog: cancelClaudeUserDialog,
      ...(readOnly
        ? {
            ...readOnlyOptions(options),
            permissionMode: auto ? ("auto" as const) : ("plan" as const),
            tools: [...CLAUDE_RESEARCH_ALLOWED_TOOLS],
            ...(options.mcpServers?.[CLAUDE_T3_MCP_SERVER_NAME] === undefined
              ? {}
              : {
                  allowedTools: researchAllowedTools(options.allowedTools ?? []),
                }),
            strictMcpConfig: false,
            ...(auto ? { permissionPrompts: "none" as const } : {}),
            // SDK callback hooks still run under disableAllHooks, before the permission classifier.
            hooks: { PreToolUse: [{ hooks: [researchPreToolUse] }] },
          }
        : {}),
    }),
  };
};
