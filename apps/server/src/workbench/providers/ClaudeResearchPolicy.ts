import type { Options as ClaudeQueryOptions, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const CLAUDE_T3_MCP_SERVER_NAME = "t3-code";
const CLAUDE_READ_ONLY_ALLOWED_TOOLS = ["Read", "Glob", "Grep"];
const CLAUDE_RESEARCH_ALLOWED_TOOLS = [
  ...CLAUDE_READ_ONLY_ALLOWED_TOOLS,
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "ToolSearch",
];

// The HTML renderers go to the permission mode's reviewer instead of being
// pre-approved: rendered pages load public network resources, so content could
// leave the sandbox unreviewed. External connector tools, including writes, also
// reach the reviewer; the planning prompt limits writes to what the user asked for.
const researchAllowedTools = (allowedTools: ReadonlyArray<string>) =>
  allowedTools.filter(
    (tool) => tool !== "mcp__t3-code__html_preview" && tool !== "mcp__t3-code__html_render",
  );

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
          }
        : {}),
    }),
  };
};
