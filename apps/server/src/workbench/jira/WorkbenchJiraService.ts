import * as Layer from "effect/Layer";

import * as WorkbenchJira from "@t3tools/workbench/jira/WorkbenchJiraService";
import { layer as jiraApiLayer } from "@t3tools/workbench/jira/JiraApi";
import { layer as jiraAuthLayer } from "@t3tools/workbench/jira/JiraAuthService";
import { layer as jiraOAuthClientLayer } from "@t3tools/workbench/jira/JiraOAuthClient";
import { layer as jiraSyncLayer } from "@t3tools/workbench/jira/JiraSyncService";
import { layer as jiraTicketImporterLayer } from "@t3tools/workbench/jira/JiraTicketImporter";
import { layer as jiraTicketWriteServiceLayer } from "@t3tools/workbench/jira/JiraTicketWriteService";
import { layerSql as workbenchJiraRepositoryLayer } from "@t3tools/workbench/jira/WorkbenchJiraRepository";

import { layer as jiraConfigLayer } from "./JiraConfig.ts";
import { layer as jiraCredentialStoreLayer } from "./JiraCredentialStore.ts";

export * from "@t3tools/workbench/jira/WorkbenchJiraService";

const authLayer = jiraAuthLayer.pipe(
  Layer.provide(jiraCredentialStoreLayer),
  Layer.provide(jiraOAuthClientLayer),
  Layer.provide(jiraConfigLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

const apiLayer = jiraApiLayer.pipe(
  Layer.provide(authLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

const syncLayer = jiraSyncLayer.pipe(
  Layer.provide(apiLayer),
  Layer.provide(jiraTicketImporterLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

const ticketWriteLayer = jiraTicketWriteServiceLayer.pipe(
  Layer.provide(apiLayer),
  Layer.provide(jiraTicketImporterLayer),
  Layer.provideMerge(syncLayer),
  Layer.provideMerge(authLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);

/** Server composition supplies the secret-store and environment adapters. */
export const layerLive = WorkbenchJira.layer.pipe(
  Layer.provideMerge(authLayer),
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(syncLayer),
  Layer.provideMerge(jiraTicketImporterLayer),
  Layer.provideMerge(ticketWriteLayer),
  Layer.provideMerge(workbenchJiraRepositoryLayer),
);
