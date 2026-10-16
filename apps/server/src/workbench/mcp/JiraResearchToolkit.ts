import {
  OrchestratorMcpFailure,
  WorkbenchJiraOperationError,
  WorkbenchJiraReadIssueInput,
  WorkbenchJiraResearchIssue,
  WorkbenchJiraSearchIssuesInput,
  WorkbenchJiraSearchIssuesResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as JiraResearch from "./JiraResearchService.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, JiraResearch.JiraResearchService];

export const JiraResearchToolkit = Toolkit.make(
  Tool.make("workbench_jira_read_issue", {
    description:
      "Read an issue, its description, parent and linked issues using this ticket conversation's workspace Jira connection. The issue may be outside the selected sprint. Credentials stay on the server; no browser is needed. A truncated result is marked; open its URL for the full source.",
    parameters: WorkbenchJiraReadIssueInput,
    success: WorkbenchJiraResearchIssue,
    failure: Schema.Union([OrchestratorMcpFailure, WorkbenchJiraOperationError]),
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true),
  Tool.make("workbench_jira_search_issues", {
    description:
      "Search accessible Jira issues with JQL using this ticket conversation's workspace connection. Returns at most 25 issue summaries and an optional next page token. Use workbench_jira_read_issue for descriptions. Search is not restricted to the selected sprint.",
    parameters: WorkbenchJiraSearchIssuesInput,
    success: WorkbenchJiraSearchIssuesResult,
    failure: Schema.Union([OrchestratorMcpFailure, WorkbenchJiraOperationError]),
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true),
);

export const layerHandlers = McpToolAccess.toLayer(JiraResearchToolkit, {
  workbench_jira_read_issue: McpToolAccess.readsAsCaller((input) =>
    Effect.flatMap(JiraResearch.JiraResearchService, (service) => service.getIssue(input)),
  ),
  workbench_jira_search_issues: McpToolAccess.readsAsCaller((input) =>
    Effect.flatMap(JiraResearch.JiraResearchService, (service) => service.searchIssues(input)),
  ),
});

export const layer = McpHttpServer.toolkitRegistration(JiraResearchToolkit, layerHandlers);
