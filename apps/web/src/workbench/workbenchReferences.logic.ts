import {
  parseWorkbenchReferenceUrl,
  workbenchTicketIssueReferences,
  type ProjectId,
  type WorkbenchParsedReferenceUrl,
  type WorkbenchReference,
  type WorkbenchTicketId,
} from "@t3tools/contracts";
import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type WorkbenchReferencesByTicket = ReadonlyMap<
  WorkbenchTicketId,
  ReadonlyArray<WorkbenchReference>
>;

const NO_REFERENCES: ReadonlyArray<WorkbenchReference> = [];

/** Groups a snapshot's References by owner once, keeping list order. */
export function groupWorkbenchReferences(
  references: ReadonlyArray<WorkbenchReference>,
): WorkbenchReferencesByTicket {
  const byTicket = new Map<WorkbenchTicketId, Array<WorkbenchReference>>();
  for (const reference of references) {
    const owned = byTicket.get(reference.ticketId);
    if (owned) owned.push(reference);
    else byTicket.set(reference.ticketId, [reference]);
  }
  return byTicket;
}

export const getTicketReferences = (
  byTicket: WorkbenchReferencesByTicket,
  ticketId: WorkbenchTicketId,
): ReadonlyArray<WorkbenchReference> => byTicket.get(ticketId) ?? NO_REFERENCES;

export interface WorkbenchReferenceView {
  readonly reference: WorkbenchReference;
  readonly parsed: WorkbenchParsedReferenceUrl;
}

// Stored URLs that no longer parse (legacy data) still show as plain links.
const viewOf = (reference: WorkbenchReference): WorkbenchReferenceView => ({
  reference,
  parsed: parseWorkbenchReferenceUrl(reference.url) ?? {
    url: reference.url,
    kind: "link",
    label: reference.url,
  },
});

/** Pull request References belong to the Pull requests section, not the References list. */
export function splitWorkbenchReferences(references: ReadonlyArray<WorkbenchReference>): {
  readonly listed: ReadonlyArray<WorkbenchReferenceView>;
  readonly pullRequests: ReadonlyArray<WorkbenchReferenceView>;
} {
  const listed: Array<WorkbenchReferenceView> = [];
  const pullRequests: Array<WorkbenchReferenceView> = [];
  for (const view of references.map(viewOf)) {
    (view.parsed.kind === "github_pull_request" ? pullRequests : listed).push(view);
  }
  return { listed, pullRequests };
}

export interface WorkbenchDescriptionLink {
  readonly parsed: WorkbenchParsedReferenceUrl;
  /** The link's text, or `null` for an autolink whose text is its URL. */
  readonly title: string | null;
}

const descriptionParser = unified().use(remarkParse).use(remarkGfm);

const plainText = (node: Nodes): string =>
  "value" in node ? node.value : "children" in node ? node.children.map(plainText).join("") : "";

/** Links in description Markdown that are valid References, deduped in order. */
export function workbenchDescriptionLinks(
  markdown: string,
): ReadonlyArray<WorkbenchDescriptionLink> {
  const tree = descriptionParser.parse(markdown);
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: Nodes) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
    if ("children" in node) for (const child of node.children) collectDefinitions(child);
  };
  collectDefinitions(tree);
  const linkUrl = (node: Nodes) =>
    node.type === "link"
      ? node.url
      : node.type === "linkReference"
        ? definitions.get(node.identifier)
        : undefined;
  const links = new Map<string, WorkbenchDescriptionLink>();
  const addLink = (url: string, text: string) => {
    const parsed = parseDescriptionHref(url);
    if (parsed === null || links.has(parsed.url)) return;
    const isAutolink = text === "" || text === url || text === parsed.url;
    links.set(parsed.url, { parsed, title: isAutolink ? null : text });
  };
  const visit = (node: Nodes) => {
    const url = linkUrl(node);
    if (url !== undefined) addLink(url, plainText(node).trim());
    else if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return [...links.values()];
}

/** A link destination may be percent-encoded, by its author or by rendering, but a host path needs its own characters. */
export function parseDescriptionHref(href: string): WorkbenchParsedReferenceUrl | null {
  const parsed = parseWorkbenchReferenceUrl(href);
  if (parsed?.kind !== "file") return parsed;
  try {
    return parseWorkbenchReferenceUrl(decodeURI(href)) ?? parsed;
  } catch {
    // A lone `%` is no escape, so the path is already literal.
    return parsed;
  }
}

export type WorkbenchReferenceOpenTarget =
  | "pull_request_panel"
  | "pull_request_sheet"
  | "browser_panel"
  | "system_browser"
  | "file_panel"
  | "file_sheet"
  | "none";

/** Where clicking a Reference opens it; the click handler and its hover text both follow this. */
export function workbenchReferenceOpenTarget(
  reference: Pick<WorkbenchParsedReferenceUrl, "kind" | "url">,
  page: {
    /** The floating chat shows a Thread, whose side panel the page hosts. */
    readonly hasThread: boolean;
    /** The Thread's browser panel can open pages here. */
    readonly canOpenInApp: boolean;
    /** Settings › Browser opens links in the app. */
    readonly linksOpenInApp: boolean;
    readonly hasFileSheet: boolean;
  },
): WorkbenchReferenceOpenTarget {
  if (reference.kind === "github_pull_request") {
    return page.hasThread ? "pull_request_panel" : "pull_request_sheet";
  }
  if (reference.kind === "file") {
    if (!page.hasThread) return page.hasFileSheet ? "file_sheet" : "none";
    return "file_panel";
  }
  return page.hasThread && page.canOpenInApp && page.linksOpenInApp
    ? "browser_panel"
    : "system_browser";
}

export const WORKBENCH_REFERENCE_OPEN_TARGET_TEXT = {
  pull_request_panel: "Opens in the side panel beside the chat",
  pull_request_sheet: "Opens in the pull request preview",
  browser_panel: "Opens in the browser panel beside the chat",
  system_browser: "Opens in your browser",
  file_panel: "Opens in the side panel beside the chat",
  file_sheet: "Opens in a file preview",
  none: "Show a Thread in the chat to open this file",
} satisfies Record<WorkbenchReferenceOpenTarget, string>;

export type WorkbenchListedReference =
  | ({ readonly source: "saved" } & WorkbenchReferenceView)
  | ({ readonly source: "description" } & WorkbenchDescriptionLink);

/**
 * The References list: saved References, then description links no saved one covers.
 * Pull request links of either kind belong to the Pull requests section.
 */
export function listWorkbenchTicketReferences(
  references: ReadonlyArray<WorkbenchReference>,
  descriptionLinks: ReadonlyArray<WorkbenchDescriptionLink>,
): {
  readonly listed: ReadonlyArray<WorkbenchListedReference>;
  readonly descriptionPullRequests: ReadonlyArray<WorkbenchDescriptionLink>;
} {
  const { listed } = splitWorkbenchReferences(references);
  const saved = new Set(references.map((reference) => viewOf(reference).parsed.url));
  const fromDescription = descriptionLinks.filter((link) => !saved.has(link.parsed.url));
  return {
    listed: [
      ...listed.map((view) => ({ source: "saved" as const, ...view })),
      ...fromDescription
        .filter((link) => link.parsed.kind !== "github_pull_request")
        .map((link) => ({ source: "description" as const, ...link })),
    ],
    descriptionPullRequests: fromDescription.filter(
      (link) => link.parsed.kind === "github_pull_request",
    ),
  };
}

/** The first issue Reference, which supplies a Ticket's short identity label. */
export const getTicketIssue = (
  references: ReadonlyArray<WorkbenchReference>,
): WorkbenchParsedReferenceUrl | null => workbenchTicketIssueReferences(references)[0] ?? null;

/** Jira-imported descriptions use wiki markup; a Jira Reference keeps their preview readable. */
export const hasJiraReference = (references: ReadonlyArray<WorkbenchReference>) =>
  workbenchTicketIssueReferences(references).some((issue) => issue.kind === "jira_issue");

/** Every Reference label and title, which Board and sidebar search match. */
export const getWorkbenchReferenceSearchTerms = (
  references: ReadonlyArray<WorkbenchReference>,
): ReadonlyArray<string> =>
  references.flatMap((reference) => {
    const { label } = viewOf(reference).parsed;
    return reference.title === null ? [label] : [label, reference.title];
  });

/** A repository the host can anchor a file read at; the first of `projectIds` that is known. */
export const getReferenceFileCwd = (
  projects: ReadonlyArray<{ readonly id: ProjectId; readonly workspaceRoot: string }>,
  projectIds: ReadonlyArray<ProjectId | null>,
): string | null => {
  for (const projectId of projectIds) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (project) return project.workspaceRoot;
  }
  return null;
};
