import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface JiraOAuthConfig {
  /** The direct OAuth client is retained for local development and self-hosted setups. */
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** Public broker URL used by production builds; it never contains credentials. */
  readonly brokerUrl?: string;
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
