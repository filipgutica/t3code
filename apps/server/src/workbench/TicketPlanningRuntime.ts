import { ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import { PLANNING_INSTRUCTION } from "./agentInstructions.ts";
import { TicketContextService } from "./TicketContextService.ts";
import * as WorkbenchStore from "./WorkbenchStore.ts";

const RepositoryManifest = Schema.Array(
  Schema.Struct({ id: ProjectId, name: Schema.String, path: Schema.String }),
);
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(RepositoryManifest));
const isRuntimePolicyResolveError = Schema.is(RuntimePolicy.RuntimePolicyResolveError);
type ResolveInput = Parameters<RuntimePolicy.RuntimePolicyV2Shape["resolve"]>[0];

/** Decorate the native policy; native Projects, Threads, and provider execution remain authoritative. */
const makeRuntimePolicyDecorator = Effect.gen(function* () {
  const store = yield* WorkbenchStore.WorkbenchStore;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const contexts = yield* TicketContextService;

  // Workbench context is advisory; a failure to read it must not block the turn.
  const advisory = <E, R>(
    label: string,
    threadId: ThreadId,
    effect: Effect.Effect<string | undefined, E, R>,
  ) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning(`${label} unavailable`, {
              threadId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(undefined)),
      ),
    );

  return {
    decorate: (base: RuntimePolicy.RuntimePolicyV2Shape): RuntimePolicy.RuntimePolicyV2Shape => {
      const resolveTicketPolicy = Effect.fn("TicketPlanningRuntime.resolveTicketPolicy")(
        function* (input: ResolveInput) {
          const policy = yield* base.resolve(input);
          const draft = yield* store.getTicketDraftForThread(input.thread.id);
          if (draft === null) return policy;
          if (draft.phase === "working") {
            // The Ticket instruction lists the prepared worktrees.
            return {
              ...policy,
              instructions:
                "The ticket has been created and Start work has completed. This same conversation now continues in its prepared work area. Earlier ticket-planning-only instructions are historical; follow the user's current request and the repository instructions for this work area.",
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
              cause: "Ticket drafting supports Codex and Claude providers.",
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
          return {
            ...policy,
            // Approvals go to the provider's auto reviewer, not the user. Drafts created before
            // their Threads started in default mode are still stored in plan mode.
            runtimeMode: "auto" as const,
            interactionMode: "default" as const,
            checkpoints: "disabled" as const,
            instructions: [
              PLANNING_INSTRUCTION,
              `Repository manifest: ${manifest}`,
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
      );
      return {
        resolve: Effect.fn("TicketPlanningRuntime.resolve")(function* (input: ResolveInput) {
          const policy = yield* resolveTicketPolicy(input);
          const context = yield* advisory(
            "Ticket context",
            input.thread.id,
            contexts.forTurn(input.thread).pipe(Effect.map(Option.getOrUndefined)),
          );
          if (context === undefined) return policy;
          return {
            ...policy,
            instructions: [
              ...(policy.instructions === undefined ? [] : [policy.instructions]),
              context,
            ].join("\n\n"),
          };
        }),
      };
    },
  };
});

export const layerRuntimePolicyDecorator = Layer.effect(
  RuntimePolicy.RuntimePolicyDecorator,
  makeRuntimePolicyDecorator,
);
