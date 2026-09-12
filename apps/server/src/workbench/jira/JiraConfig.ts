import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { JiraConfig } from "@t3tools/workbench/jira/JiraConfig";

import { resolveWorkbenchJiraBrokerUrl } from "./publicConfig.ts";

/** Reads the existing environment variables lazily for each auth operation. */
export const layer = Layer.effect(
  JiraConfig,
  Effect.gen(function* () {
    const environment = yield* HostProcessEnvironment;
    return JiraConfig.of({
      get: Effect.sync(() => {
        const clientId = environment.T3_WORKBENCH_JIRA_CLIENT_ID?.trim() ?? "";
        const clientSecret = environment.T3_WORKBENCH_JIRA_CLIENT_SECRET?.trim() ?? "";
        const brokerUrl = resolveWorkbenchJiraBrokerUrl(environment);
        // Explicit credentials remain the escape hatch for local development and
        // self-hosted deployments. Production builds use the public broker and
        // never require an Atlassian client secret in the desktop bundle.
        if (clientId.length === 0 || clientSecret.length === 0) {
          return brokerUrl === null ? null : { brokerUrl };
        }
        return {
          clientId,
          clientSecret,
          ...(brokerUrl === null ? {} : { brokerUrl }),
        };
      }),
    });
  }),
);
