import type { Options as ClaudeQueryOptions } from "@anthropic-ai/claude-agent-sdk";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ClaudeAdapterV2 from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { decorate } from "./ClaudeResearchPolicy.ts";

const linuxHost = { platform: "linux", homeDirectory: "/home/planner" } as const;

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
        ...linuxHost,
        runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode,
          interactionMode: "plan",
          cwd: "/workspace",
          sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
          approvalPolicy: "on-request",
        }),
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
        ...linuxHost,
        runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: "/workspace",
          sandboxPolicy: { type: "workspaceWrite" },
        }),
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
  const researchOptions = (options: ClaudeQueryOptions, platform: NodeJS.Platform = "linux") => ({
    ...options,
    ...decorate({ ...linuxHost, runtimePolicy, platform }).options?.(options),
  });
  it("routes research planning approvals to Auto without exposing shell or file writes", () => {
    const options = researchOptions({
      ...nativeOptions,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    });
    assert.equal(options.permissionMode, "auto");
    assert.equal(options.permissionPrompts, "none");
    assert.isFalse(options.strictMcpConfig);
    assert.isFalse(options.allowDangerouslySkipPermissions);
    assert.include(options.settings, { disableAllHooks: true, showThinkingSummaries: true });
    if (!Array.isArray(options.tools)) return assert.fail("Expected explicit research tools");
    assert.includeMembers(options.tools, ["Read", "WebFetch", "WebSearch", "ToolSearch"]);
    assert.notIncludeMembers(options.tools, ["Bash", "Edit", "Write", "Agent"]);
    assert.notProperty(options.settings, "sandbox");
  });

  it("runs macOS research shell commands in a write-denied sandbox without prompts", () => {
    const options = researchOptions(nativeOptions, "darwin");
    assert.equal(options.permissionPrompts, "none");
    if (!Array.isArray(options.tools)) return assert.fail("Expected explicit research tools");
    assert.includeMembers(options.tools, ["Bash", "Read", "WebFetch"]);
    assert.notIncludeMembers(options.tools, ["Edit", "Write", "NotebookEdit", "Agent"]);
    assert.include(options.settings, { disableAllHooks: true, showThinkingSummaries: true });
    if (typeof options.settings !== "object") return assert.fail("Expected settings object");
    const sandbox = options.settings.sandbox;
    // Without the sandbox, Claude would run Bash unsandboxed or route it to approval.
    assert.include(sandbox, {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    });
    assert.isFalse(sandbox?.filesystem?.disabled);
    assert.includeMembers(sandbox?.filesystem?.denyWrite ?? [], ["/workspace", "/home/planner"]);
    assert.isTrue(sandbox?.network?.strictAllowlist);
  });

  it("keeps the shell unavailable outside Auto research", () => {
    const options = {
      ...nativeOptions,
      ...decorate({
        runtimePolicy: { ...runtimePolicy, runtimeMode: "approval-required" },
        ...linuxHost,
        platform: "darwin",
      }).options?.(nativeOptions),
    };
    if (!Array.isArray(options.tools)) return assert.fail("Expected explicit research tools");
    assert.notInclude(options.tools, "Bash");
    if (typeof options.settings !== "object") return assert.fail("Expected settings object");
    assert.notProperty(options.settings, "sandbox");
  });
  it.effect("lets external connector writes reach the Auto reviewer during planning", () =>
    Effect.gen(function* () {
      const options = researchOptions(nativeOptions);
      assert.equal(options.permissionMode, "auto");
      // Anything the Auto reviewer and rules leave undecided is denied, not shown.
      assert.equal(options.permissionPrompts, "none");
      // T3's HTML renderers are not pre-approved; other T3 tools keep their server-side gates.
      assert.deepEqual(options.allowedTools, [
        "Read",
        "Glob",
        "Grep",
        "mcp__t3-code__orchestrator_capabilities",
      ]);
      const hooks = (options.hooks?.PreToolUse ?? []).flatMap((matcher) => matcher.hooks);
      for (const hook of hooks) {
        const output = yield* Effect.promise(() =>
          hook(
            {
              hook_event_name: "PreToolUse",
              session_id: "research",
              transcript_path: "/tmp/transcript.jsonl",
              cwd: "/workspace",
              tool_name: "mcp__claude_ai_Atlassian__createJiraIssue",
              tool_input: {},
              tool_use_id: "create-issue",
              mcp_server: { name: "claude.ai Atlassian", source: "user" },
            },
            "create-issue",
            { signal: new AbortController().signal },
          ),
        );
        assert.isFalse(
          "hookSpecificOutput" in output &&
            output.hookSpecificOutput?.hookEventName === "PreToolUse" &&
            output.hookSpecificOutput.permissionDecision === "deny",
        );
      }
    }),
  );

  it("keeps non-Auto research in plan mode without changing native prompt settings", () => {
    const decoration = decorate({
      ...linuxHost,
      runtimePolicy: { ...runtimePolicy, runtimeMode: "approval-required" },
    });
    const options = { ...nativeOptions, ...decoration.options?.(nativeOptions) };
    assert.equal(options.permissionMode, "plan");
    assert.isUndefined(options.permissionPrompts);
  });

  it.effect("applies the resume dialog default in research instead of asking the user", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const options = researchOptions(nativeOptions);
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
