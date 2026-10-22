import { vi } from "vite-plus/test";
import { JiraResearchToolkit } from "../mcp/JiraResearchToolkit.ts";
import type {
  McpServerStatus,
  Options as ClaudeQueryOptions,
} from "@anthropic-ai/claude-agent-sdk";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ClaudeAdapterV2 from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { decorate } from "./ClaudeResearchPolicy.ts";

const bypassSettings = Schema.decodeSync(ClaudeSettings)({
  launchArgs: "--dangerously-skip-permissions",
});

describe("Claude read-only policy", () => {
  it.each(["full-access", "auto", "auto-accept-edits", "approval-required"] as const)(
    "restricts non-research %s queries despite user launch overrides and hooks",
    (runtimeMode) => {
      const native = ClaudeAdapterV2.makeClaudeQueryOptions({
        modelSelection: {
          instanceId: ProviderInstanceId.make("claude"),
          model: "claude-sonnet-4-6",
          options: [],
        },
        nativeThreadId: "read-only-planning",
        resume: false,
        cwd: "/workspace",
        permissionMode: "plan",
        settings: bypassSettings,
        sdkSettings: { disableAllHooks: false },
        allowDangerouslySkipPermissions: true,
      });
      const decoration = decorate({
        runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode,
          interactionMode: "plan",
          cwd: "/workspace",
          sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
          approvalPolicy: "on-request",
        }),
        mcpServerStatus: async () => undefined,
      });
      const options = { ...native, ...decoration.options?.(native) };
      assert.equal(options.permissionMode, "dontAsk");
      assert.equal(options.strictMcpConfig, true);
      assert.isFalse(options.allowDangerouslySkipPermissions);
      assert.include(options.settings, { disableAllHooks: true, showThinkingSummaries: true });
      assert.deepEqual(options.tools, ["Read", "Glob", "Grep"]);
    },
  );

  it("leaves non-research writable queries to native policy", () => {
    assert.deepEqual(
      decorate({
        runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: "/workspace",
          sandboxPolicy: { type: "workspaceWrite" },
        }),
        mcpServerStatus: async () => undefined,
      }),
      {},
    );
  });
});

describe("Claude research policy", () => {
  const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
    runtimeMode: "auto",
    interactionMode: "plan",
    cwd: "/workspace",
    toolAccess: "research",
    sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
    approvalPolicy: "on-request",
  });
  const nativeOptions: ClaudeQueryOptions = {
    model: "claude-sonnet-4-6",
    permissionMode: "dontAsk",
    tools: ["Read", "Glob", "Grep"],
    allowedTools: [
      "Read",
      "Glob",
      "Grep",
      "mcp__t3-code__orchestrator_capabilities",
      "mcp__t3-code__html_preview",
      "mcp__t3-code__html_render",
    ],
    mcpServers: { "t3-code": { type: "http", url: "http://localhost/mcp" } },
    strictMcpConfig: true,
    allowDangerouslySkipPermissions: false,
    settings: { disableAllHooks: true, showThinkingSummaries: true },
  };
  const researchOptions = (
    options: ClaudeQueryOptions,
    mcpServerStatus: () => Promise<ReadonlyArray<McpServerStatus> | undefined>,
  ) => ({
    ...options,
    ...decorate({ runtimePolicy, mcpServerStatus }).options?.(options),
  });
  const startResearchTurn = (input: { readonly mcpServers?: ReadonlyArray<McpServerStatus> }) =>
    Effect.sync(() => researchOptions(nativeOptions, async () => input.mcpServers));
  it("routes research planning approvals to Auto without exposing shell or file writes", () => {
    const options = researchOptions(
      {
        ...nativeOptions,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
      async () => undefined,
    );
    assert.equal(options.permissionMode, "auto");
    assert.equal(options.permissionPrompts, "none");
    assert.isFalse(options.strictMcpConfig);
    assert.isFalse(options.allowDangerouslySkipPermissions);
    assert.include(options.settings, { disableAllHooks: true, showThinkingSummaries: true });
    if (!Array.isArray(options.tools)) return assert.fail("Expected explicit research tools");
    assert.includeMembers(options.tools, ["Read", "WebFetch", "WebSearch", "ToolSearch"]);
    assert.notIncludeMembers(options.tools, ["Bash", "Edit", "Write", "Agent"]);
  });
  it("pre-approves the workspace Jira toolkit for Claude ticket planning", () => {
    const options = researchOptions(nativeOptions, async () => undefined);
    assert.deepEqual(
      options.allowedTools?.filter((name) => name.startsWith("mcp__t3-code__workbench_jira_")),
      Object.values(JiraResearchToolkit.tools).map((tool) => `mcp__t3-code__${tool.name}`),
    );
  });
  it.effect(
    "denies unannotated external MCP tools in Auto research before review, without prompts",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const options = yield* startResearchTurn({
            mcpServers: [
              {
                name: "claude.ai GitHub (Work)",
                status: "connected",
                tools: [
                  { name: "get_issue", annotations: { readOnly: true } },
                  { name: "delete_branch", annotations: { readOnly: true, destructive: true } },
                ],
              },
              {
                name: "filesystem",
                status: "connected",
                tools: [
                  { name: "read_file", annotations: { readOnly: true } },
                  { name: "write_file" },
                ],
              },
              {
                name: "t3-code",
                status: "connected",
                tools: [{ name: "workbench_jira_read_issue" }],
              },
              {
                // Normalizes to mcp__t3-code___write_file, sharing the T3 prefix.
                name: "t3-code_",
                status: "connected",
                tools: [{ name: "write_file" }],
              },
            ],
          });
          assert.equal(options.permissionMode, "auto");
          // Anything the Auto reviewer and rules leave undecided is denied, not shown.
          assert.equal(options.permissionPrompts, "none");
          const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
          assert.isFunction(hook);
          const decide = (toolName: string, serverName?: string) =>
            Effect.promise(() =>
              hook!(
                {
                  hook_event_name: "PreToolUse",
                  session_id: "native-thread-claude-research",
                  transcript_path: "/tmp/transcript.jsonl",
                  cwd: "/workspace",
                  tool_name: toolName,
                  tool_input: {},
                  tool_use_id: `tool-${toolName}`,
                  ...(serverName === undefined
                    ? {}
                    : { mcp_server: { name: serverName, source: "user" } }),
                },
                `tool-${toolName}`,
                { signal: new AbortController().signal },
              ),
            ).pipe(
              Effect.map((output) =>
                "hookSpecificOutput" in output &&
                output.hookSpecificOutput?.hookEventName === "PreToolUse"
                  ? output.hookSpecificOutput.permissionDecision
                  : undefined,
              ),
            );

          // A deny here applies before the Auto classifier could approve the call.
          assert.equal(yield* decide("mcp__filesystem__write_file", "filesystem"), "deny");
          assert.equal(yield* decide("mcp__filesystem__unknown_tool", "filesystem"), "deny");
          assert.equal(
            yield* decide("mcp__claude_ai_GitHub_Work__delete_branch", "claude.ai GitHub (Work)"),
            "deny",
          );
          // Read-only tools get no decision, so the Auto reviewer still sees them.
          assert.isUndefined(yield* decide("mcp__filesystem__read_file", "filesystem"));
          assert.isUndefined(
            yield* decide("mcp__claude_ai_GitHub_Work__get_issue", "claude.ai GitHub (Work)"),
          );
          // The injected T3 server is exempt by exact name, not by tool-name prefix.
          assert.isUndefined(yield* decide("mcp__t3-code__workbench_jira_read_issue"));
          assert.isUndefined(yield* decide("mcp__t3-code__workbench_jira_read_issue", "t3-code"));
          assert.equal(yield* decide("mcp__t3-code___write_file", "t3-code_"), "deny");
          assert.equal(yield* decide("mcp__t3-code___write_file"), "deny");
          assert.isUndefined(yield* decide("Read"));
        }),
      ),
  );

  it.each(["missing", "failed", "timeout"] as const)(
    "denies external MCP tools when inventory is %s",
    async (status) => {
      vi.useFakeTimers();
      try {
        const options = researchOptions(nativeOptions, () => {
          if (status === "failed") return Promise.reject(new Error("inventory unavailable"));
          if (status === "timeout") return new Promise(() => {});
          return Promise.resolve(undefined);
        });
        const result = options.hooks!.PreToolUse![0]!.hooks[0]!(
          {
            hook_event_name: "PreToolUse",
            session_id: "research",
            transcript_path: "/tmp/transcript.jsonl",
            cwd: "/workspace",
            tool_name: "mcp__filesystem__read_file",
            tool_input: {},
            tool_use_id: "read-file",
          },
          "read-file",
          { signal: new AbortController().signal },
        );
        await vi.advanceTimersByTimeAsync(10_000);
        assert.deepEqual(await result, {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "Research is read-only. This MCP tool is not marked read-only by its server, so it is unavailable here.",
          },
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps non-Auto research in plan mode without changing native prompt settings", () => {
    const decoration = decorate({
      runtimePolicy: { ...runtimePolicy, runtimeMode: "approval-required" },
      mcpServerStatus: async () => undefined,
    });
    const options = { ...nativeOptions, ...decoration.options?.(nativeOptions) };
    assert.equal(options.permissionMode, "plan");
    assert.isUndefined(options.permissionPrompts);
    assert.isFunction(options.hooks?.PreToolUse?.[0]?.hooks[0]);
  });

  it.effect("applies the resume dialog default in research instead of asking the user", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const options = yield* startResearchTurn({});
        const result = yield* Effect.promise(() =>
          options.onUserDialog!(
            {
              dialogKind: "resume_return",
              payload: { sessionAgeMinutes: 90, estimatedTokens: 120_000 },
            },
            { signal: new AbortController().signal, requestId: "request-resume-research" },
          ),
        );
        assert.deepEqual(result, { behavior: "cancelled" });
      }),
    ),
  );
});
