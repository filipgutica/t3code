import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface JiraOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface JiraConfigShape {
  /** Read the current server-provided OAuth configuration. */
  readonly get: Effect.Effect<JiraOAuthConfig | null>;
}

/**
 * The package consumes configuration through this small service. The server
 * provides the reader so environment and deployment policy stay outside the
 * Workbench package.
 */
export class JiraConfig extends Context.Service<JiraConfig, JiraConfigShape>()(
  "@t3tools/workbench/jira/JiraConfig",
) {}
