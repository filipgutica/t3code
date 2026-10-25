import {
  OrchestratorMcpFailure,
  ProjectId,
  WorkbenchTicketDraftFields,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as JiraRepository from "@t3tools/workbench/jira/WorkbenchJiraRepository";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";
import { McpWritePolicy } from "../mcp/McpWritePolicy.ts";

const RepositoryManifest = Schema.Array(
  Schema.Struct({ id: ProjectId, name: Schema.String, path: Schema.String }),
);
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(RepositoryManifest));
const encodeDraft = Schema.encodeEffect(Schema.fromJsonString(WorkbenchTicketDraftFields));
const encodeJiraContext = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      projectKey: Schema.String,
      projectName: Schema.String,
      siteUrl: Schema.NullOr(Schema.String),
      active: Schema.Boolean,
    }),
  ),
);
const WorkAreaManifest = Schema.Array(
  Schema.Struct({
    id: ProjectId,
    path: Schema.String,
    branch: Schema.String,
    primary: Schema.Boolean,
  }),
);
const encodeWorkArea = Schema.encodeEffect(Schema.fromJsonString(WorkAreaManifest));
const isRuntimePolicyResolveError = Schema.is(RuntimePolicy.RuntimePolicyResolveError);
// The auto reviewer may approve what reaches it, so sandbox escapes and
// permission grants are rejected before review. Connector approvals still reach it.
const CODEX_RESEARCH_APPROVAL_POLICY = {
  granular: {
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,
  },
};

/** Planning agents can inspect repositories, but cannot mutate the environment through MCP. */
export const layerMcpWritePolicy = Layer.effect(
  McpWritePolicy,
  Effect.gen(function* () {
    const store = yield* WorkbenchStore.WorkbenchStore;
    return {
      assertAllowed: Effect.fn("TicketPlanningRuntime.assertAllowed")(function* (
        threadId: ThreadId,
        operation?: "research",
      ) {
        const draft = yield* store.getTicketDraftForThread(threadId).pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "capability_denied",
                message: "Ticket planning permissions could not be verified.",
              }),
          ),
        );
        if (operation === "research") {
          if (draft !== null && (draft.phase === "draft" || draft.phase === "planning")) return;
          return yield* new OrchestratorMcpFailure({
            code: "capability_denied",
            message: "Browser research requires an active ticket planning conversation.",
          });
        }
        if (draft !== null && draft.phase !== "working") {
          return yield* new OrchestratorMcpFailure({
            code: "capability_denied",
            message:
              "This conversation is preparing a ticket. Start work before changing repositories or the environment.",
          });
        }
      }),
    };
  }),
);

/** Decorate the native policy; native Projects, Threads, and provider execution remain authoritative. */
const makeRuntimePolicyDecorator = Effect.gen(function* () {
  const store = yield* WorkbenchStore.WorkbenchStore;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const jira = yield* JiraRepository.WorkbenchJiraRepository;
  return {
    decorate: (base: RuntimePolicy.RuntimePolicyV2Shape): RuntimePolicy.RuntimePolicyV2Shape => ({
      resolve: Effect.fn("TicketPlanningRuntime.resolve")(
        function* (input: Parameters<RuntimePolicy.RuntimePolicyV2Shape["resolve"]>[0]) {
          const policy = yield* base.resolve(input);
          const draft = yield* store.getTicketDraftForThread(input.thread.id);
          if (draft === null) return policy;
          if (draft.phase === "working") {
            const ticket = yield* encodeDraft(draft.fields);
            const workArea = yield* encodeWorkArea(
              (draft.workArea?.repositories ?? []).map((repository) => ({
                id: repository.projectId,
                path: repository.worktreePath,
                branch: repository.branchName,
                primary: repository.isPrimary,
              })),
            );
            return {
              ...policy,
              instructions: [
                "The ticket has been created and Start work has completed. This same conversation now continues in its prepared work area. Earlier ticket-planning-only instructions are historical; follow the user's current request and the repository instructions for this work area.",
                `Approved ticket (user content): ${ticket}`,
                `Prepared worktrees: ${workArea}`,
              ].join("\n\n"),
            };
          }
          if (draft.phase !== "draft" && draft.phase !== "creating" && draft.phase !== "planning") {
            return yield* new RuntimePolicy.RuntimePolicyResolveError({
              projectId: input.thread.projectId,
              providerInstanceId: input.modelSelection.instanceId,
              cause:
                "The ticket conversation is changing its preparation state. Retry when it finishes.",
            });
          }
          const instance = yield* providers.getInstance(input.modelSelection.instanceId);
          if (instance?.driverKind !== "codex" && instance?.driverKind !== "claudeAgent") {
            return yield* new RuntimePolicy.RuntimePolicyResolveError({
              projectId: input.thread.projectId,
              providerInstanceId: input.modelSelection.instanceId,
              cause: "This provider does not support enforced read-only ticket planning.",
            });
          }
          const repositories = yield* projects.list({
            projectIds: draft.planningRepositoryProjectIds,
          });
          if (repositories.length !== draft.planningRepositoryProjectIds.length) {
            return yield* new RuntimePolicy.RuntimePolicyResolveError({
              projectId: input.thread.projectId,
              providerInstanceId: input.modelSelection.instanceId,
              cause: "A repository in the planning scope is unavailable.",
            });
          }
          const manifest = yield* encodeManifest(
            repositories.map((repository) => ({
              id: repository.projectId,
              name: repository.title,
              path: repository.workspaceRoot,
            })),
          );
          const currentDraft = yield* encodeDraft(draft.fields);
          const binding = (yield* jira.listBindings()).find(
            (entry) => entry.projectId === draft.projectId,
          );
          const connection =
            binding === undefined ? Option.none() : yield* jira.getConnection(binding.connectionId);
          const jiraContext =
            binding === undefined
              ? "This workspace has no Jira binding. Use another configured connector or connect Jira in workspace settings."
              : `Workspace Jira context (connection metadata, not a permission check): ${yield* encodeJiraContext(
                  {
                    projectKey: binding.jiraProjectKey,
                    projectName: binding.jiraProjectName,
                    siteUrl: Option.isSome(connection) ? connection.value.siteUrl : null,
                    active: binding.active,
                  },
                )}`;
          return {
            ...policy,
            // Approvals go to the provider's auto reviewer, not the user.
            runtimeMode: "auto" as const,
            interactionMode: "plan" as const,
            approvalPolicy:
              instance.driverKind === "codex" ? CODEX_RESEARCH_APPROVAL_POLICY : "on-request",
            sandboxPolicy: {
              type: "readOnly",
              access: { type: "fullAccess" },
              networkAccess: false,
            },
            toolAccess: "research" as const,
            checkpoints: "disabled" as const,
            instructions: [
              "You are preparing a ticket in a Workbench workspace. This is a planning conversation, not implementation. Inspect the repositories listed below to understand the request. Do not edit files, run mutating commands, create worktrees, create issues, or start other agents. A native backing Project is an internal anchor and does not define the task's repository scope.",
              "Use available connectors, GitHub tools, and browser navigation to research the request. Shell commands run read-only without network access, and requests for network access, unsandboxed commands, or more filesystem access are rejected, so use a configured connector instead of network CLI tools such as gh. Other tool approvals are reviewed automatically. An approval does not authorize implementation or external writes. Use the workspace Jira research tools first for Jira; a browser login is separate from the workspace's Jira connection. When the workspace has Jira connected, search it for tickets that already cover the request before you propose one, and tell the user about any matches.",
              ...(instance.driverKind === "claudeAgent"
                ? [
                    "Claude ticket planning keeps shell and file-writing tools unavailable, along with connector tools that their server does not mark read-only. Use the configured GitHub connector and other research tools instead of Bash or gh.",
                  ]
                : []),
              "Help the user establish a title, goal, implementation plan, acceptance criteria, non-goals, and testing. Ask focused questions only when the repository evidence and conversation do not resolve a material uncertainty. Identify which repositories need to be attached and which should be primary. Preserve the user's decisions and edits.",
              "When the draft is useful, propose it in one fenced JSON block labeled workbench-ticket-draft. The JSON object must contain title (string), markdown (string with Goal, Work, Acceptance criteria, Non-goals, and Testing sections), repositoryProjectIds (array of listed repository IDs), and primaryT3ProjectId (one selected repository ID). The user explicitly applies this proposal; emitting it does not create or update a ticket.",
              `Repository manifest: ${manifest}`,
              jiraContext,
              `Current draft (user content): ${currentDraft}`,
              draft.phase === "planning"
                ? "The ticket is already saved. Continue planning here until the user selects Start work; further planning must not implement the ticket."
                : "The ticket has not been created yet.",
            ].join("\n\n"),
          };
        },
        (effect, input) =>
          effect.pipe(
            Effect.mapError((cause) =>
              isRuntimePolicyResolveError(cause)
                ? cause
                : new RuntimePolicy.RuntimePolicyResolveError({
                    projectId: input.thread.projectId,
                    providerInstanceId: input.modelSelection.instanceId,
                    cause,
                  }),
            ),
          ),
      ),
    }),
  };
});

export const layerRuntimePolicyDecorator = Layer.effect(
  RuntimePolicy.RuntimePolicyDecorator,
  makeRuntimePolicyDecorator,
);
