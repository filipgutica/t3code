import { resolveProjectProviderInstanceEnabled, WorkbenchOperationError } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { AskForChangeServiceLive as serviceLayer } from "@t3tools/workbench/AskForChangeService";
import { MarkdownRewriteHost } from "@t3tools/workbench/MarkdownRewriteHost";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration, layer as textGenerationLayer } from "../textGeneration/TextGeneration.ts";
import { buildMarkdownRewritePrompt } from "./askForChangeText.ts";
import { OPEN_CODE_FREE_TIER_REJECTION } from "./TicketSummaryService.ts";

export { AskForChangeService } from "@t3tools/workbench/AskForChangeService";

const failed = (message: string) =>
  new WorkbenchOperationError({ code: "ask_for_change_failed", message });

const markdownRewriteHostLayer = Layer.effect(
  MarkdownRewriteHost,
  Effect.gen(function* () {
    const projections = yield* ProjectStoreV2;
    const settings = yield* ServerSettingsService;
    const textGeneration = yield* TextGeneration;
    return MarkdownRewriteHost.of({
      rewrite: Effect.fn("MarkdownRewriteHost.rewrite")(function* (request) {
        const project = yield* projections
          .getShell(request.projectId)
          .pipe(
            Effect.mapError(() =>
              failed(
                "The brief's repository could not be loaded. Check its repositories and ask again.",
              ),
            ),
          );
        if (Option.isNone(project)) {
          return yield* failed(
            "The brief's repository is unavailable. Check its repositories and ask again.",
          );
        }
        const currentSettings = yield* settings.getSettings.pipe(
          Effect.mapError(() =>
            failed("The text generation model settings could not be loaded. Ask again."),
          ),
        );
        const modelSelection = resolveProjectSettings(currentSettings, request.projectId).settings
          .textGenerationModelSelection;
        if (
          !resolveProjectProviderInstanceEnabled(
            currentSettings,
            request.projectId,
            modelSelection.instanceId,
          )
        ) {
          return yield* failed(
            "No text generation provider is enabled for this brief's repository. Enable one in project settings, then ask again.",
          );
        }
        const { prompt, outputSchema } = buildMarkdownRewritePrompt(request);
        return yield* textGeneration
          .generateStructured({
            operation: "rewriteMarkdownBlocks",
            cwd: project.value.workspaceRoot,
            prompt,
            outputSchema,
            modelSelection,
          })
          .pipe(
            Effect.map((result) => result.markdown),
            Effect.mapError((error) =>
              failed(
                error.detail === OPEN_CODE_FREE_TIER_REJECTION
                  ? "The free OpenCode model can't rewrite the brief. If you connect another provider, select it in Settings → General and ask again."
                  : `${error.detail} Check Settings → General → Text generation model, then ask again.`,
              ),
            ),
          );
      }),
    });
  }),
);

export const AskForChangeServiceLive = serviceLayer.pipe(
  Layer.provide(markdownRewriteHostLayer.pipe(Layer.provide(textGenerationLayer))),
);
