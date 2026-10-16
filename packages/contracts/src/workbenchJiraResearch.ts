import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkbenchJiraReadIssueInput = Schema.Struct({
  issueKey: TrimmedNonEmptyString.check(
    Schema.isMaxLength(100),
    Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/u),
  ),
});
export type WorkbenchJiraReadIssueInput = typeof WorkbenchJiraReadIssueInput.Type;

export const WorkbenchJiraSearchIssuesInput = Schema.Struct({
  jql: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  maxResults: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 25 }))),
  nextPageToken: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
});
export type WorkbenchJiraSearchIssuesInput = typeof WorkbenchJiraSearchIssuesInput.Type;

const IssueReference = Schema.Struct({ key: Schema.String, summary: Schema.String });
export const WorkbenchJiraResearchIssueSummary = Schema.Struct({
  key: Schema.String,
  url: Schema.String,
  summary: Schema.String,
  issueType: Schema.String,
  status: Schema.String,
  parent: Schema.NullOr(IssueReference),
  relationships: Schema.Array(
    Schema.Struct({
      relationship: Schema.String,
      issue: IssueReference,
    }),
  ),
  updatedAt: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean.annotate({
    description:
      "True when text or relationships were shortened. Open the issue URL for the complete source.",
  }),
});
export type WorkbenchJiraResearchIssueSummary = typeof WorkbenchJiraResearchIssueSummary.Type;
export const WorkbenchJiraResearchIssue = Schema.Struct({
  ...WorkbenchJiraResearchIssueSummary.fields,
  description: Schema.String,
});
export type WorkbenchJiraResearchIssue = typeof WorkbenchJiraResearchIssue.Type;
export const WorkbenchJiraSearchIssuesResult = Schema.Struct({
  issues: Schema.Array(WorkbenchJiraResearchIssueSummary),
  nextPageToken: Schema.NullOr(Schema.String),
});
export type WorkbenchJiraSearchIssuesResult = typeof WorkbenchJiraSearchIssuesResult.Type;
