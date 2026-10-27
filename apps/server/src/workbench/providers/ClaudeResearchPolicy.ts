import type { Options as ClaudeQueryOptions, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as HostProcess from "@t3tools/shared/HostProcess";
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

// The HTML renderers go to the permission mode's reviewer instead of being
// pre-approved: rendered pages load public network resources, so content could
// leave the sandbox unreviewed. External connector tools, including writes, also
// reach the reviewer; the planning prompt limits writes to what the user asked for.
const researchAllowedTools = (allowedTools: ReadonlyArray<string>) =>
  allowedTools.filter(
    (tool) => tool !== "mcp__t3-code__html_preview" && tool !== "mcp__t3-code__html_render",
  );

// Claude's sandbox is Seatbelt on macOS. Elsewhere it may be missing or run
// commands unsandboxed, so research there keeps the shell unavailable.
export const researchShellAvailable = (platform: NodeJS.Platform) => platform === "darwin";

// Sandboxed commands run without prompts; writes are denied in cwd and home, temp stays
// writable, and hosts outside the user's allowlist are refused. Flag settings outrank user
// settings, so filesystem isolation stays on; user excludedCommands and allowWrite still merge.
const researchShellSettings = (input: {
  readonly cwd: string;
  readonly homeDirectory: string;
}) => ({
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: { disabled: false, denyWrite: [input.cwd, input.homeDirectory] },
    network: { strictAllowlist: true },
  },
});

// Research never asks the user, so a dialog takes the CLI's default behavior.
const cancelClaudeUserDialog: NonNullable<ClaudeQueryOptions["onUserDialog"]> = async () => ({
  behavior: "cancelled",
});

const readOnlySettings = (options: ClaudeQueryOptions) => ({
  ...(typeof options.settings === "object" ? options.settings : {}),
  disableAllHooks: true,
});

const readOnlyOptions = (options: ClaudeQueryOptions): Partial<ClaudeQueryOptions> => ({
  permissionMode: "dontAsk",
  tools: [...CLAUDE_READ_ONLY_ALLOWED_TOOLS],
  allowDangerouslySkipPermissions: false,
  strictMcpConfig: true,
  settings: readOnlySettings(options),
});

export const decorate = (input: {
  readonly runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
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
  // The sandbox needs a concrete directory to deny writes in.
  const shellCwd =
    readOnly && auto && researchShellAvailable(input.platform) ? input.runtimePolicy.cwd : null;
  const shell = shellCwd !== null;
  return {
    reuseKey: `research:${auto ? "auto" : "plan"}:${readOnly}:${shell}`,
    ...(auto ? { permissionMode: "auto" as const } : {}),
    options: (options: ClaudeQueryOptions) => ({
      onUserDialog: cancelClaudeUserDialog,
      ...(readOnly
        ? {
            ...readOnlyOptions(options),
            permissionMode: auto ? ("auto" as const) : ("plan" as const),
            tools: shell
              ? [...CLAUDE_RESEARCH_ALLOWED_TOOLS, "Bash"]
              : [...CLAUDE_RESEARCH_ALLOWED_TOOLS],
            ...(options.mcpServers?.[CLAUDE_T3_MCP_SERVER_NAME] === undefined
              ? {}
              : {
                  allowedTools: researchAllowedTools(options.allowedTools ?? []),
                }),
            strictMcpConfig: false,
            ...(auto ? { permissionPrompts: "none" as const } : {}),
            ...(shellCwd !== null
              ? {
                  settings: {
                    ...readOnlySettings(options),
                    ...researchShellSettings({
                      cwd: shellCwd,
                      homeDirectory: input.homeDirectory,
                    }),
                  },
                }
              : {}),
          }
        : {}),
    }),
  };
};

export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  return {
    decorate: (input: { readonly runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy }) =>
      decorate({ ...input, platform, homeDirectory }),
  };
});
