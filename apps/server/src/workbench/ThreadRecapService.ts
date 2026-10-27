import {
  resolveProjectProviderInstanceEnabled,
  TextGenerationError,
  WorkbenchOperationError,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { ThreadRecapHost } from "@t3tools/workbench/ThreadRecapHost";
import { ThreadRecapServiceLive as serviceLayer } from "@t3tools/workbench/ThreadRecapService";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration, layer as textGenerationLayer } from "../textGeneration/TextGeneration.ts";
import { buildThreadRecapPrompt, sanitizeThreadRecap } from "./threadRecapText.ts";

export { ThreadRecapService } from "@t3tools/workbench/ThreadRecapService";

const recapError = (message: string) =>
  new WorkbenchOperationError({ code: "thread_recap_generation_failed", message });

const threadRecapHostLayer = Layer.effect(
  ThreadRecapHost,
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService;
    const projects = yield* ProjectStoreV2;
    const settings = yield* ServerSettingsService;
    const textGeneration = yield* TextGeneration;
    return ThreadRecapHost.of({
      generate: Effect.fn("ThreadRecapHost.generate")(function* ({ threadId, runId }) {
        const records = yield* threads
          .getThreadRecords(threadId, ["messages"], {
            messageRunIds: [runId],
            messageRoles: ["user", "assistant"],
          })
          .pipe(Effect.mapError(() => recapError("The run's messages could not be read.")));
        const messages = records.messages.flatMap((message) =>
          message.role === "system" || message.text.trim().length === 0
            ? []
            : [{ role: message.role, text: message.text }],
        );
        if (messages.length === 0) return yield* recapError("The run has no messages to recap.");
        const projectId = records.thread.projectId;
        const project = yield* projects.getShell(projectId).pipe(
          Effect.mapError(() => recapError("The Thread's project could not be loaded.")),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(recapError("The Thread's project is unavailable.")),
              onSome: Effect.succeed,
            }),
          ),
        );
        const currentSettings = yield* settings.getSettings.pipe(
          Effect.mapError(() => recapError("The text generation settings could not be loaded.")),
        );
        const modelSelection = resolveProjectSettings(currentSettings, projectId).settings
          .textGenerationModelSelection;
        if (
          !resolveProjectProviderInstanceEnabled(
            currentSettings,
            projectId,
            modelSelection.instanceId,
          )
        ) {
          return yield* recapError("No text generation provider is enabled for this project.");
        }
        const { prompt, outputSchema } = buildThreadRecapPrompt({ messages });
        return yield* textGeneration
          .generateStructured({
            operation: "generateThreadRecap",
            cwd: project.workspaceRoot,
            prompt,
            outputSchema,
            modelSelection,
          })
          .pipe(
            Effect.map((result) => sanitizeThreadRecap(result.recap)),
            Effect.filterOrFail(
              (recap) => recap.length > 0,
              () =>
                new TextGenerationError({
                  operation: "generateThreadRecap",
                  detail: "The model returned an empty Thread recap.",
                }),
            ),
            Effect.mapError((error) => recapError(error.detail)),
          );
      }),
    });
  }),
);

export const ThreadRecapServiceLive = serviceLayer.pipe(
  Layer.provide(threadRecapHostLayer.pipe(Layer.provide(textGenerationLayer))),
);
