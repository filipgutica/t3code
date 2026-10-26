import { WorkbenchDescription } from "./WorkbenchDescription";

export interface WorkbenchTicketContextSections {
  readonly headerMarkdown: string;
  readonly bodyMarkdown: string;
  /** The preamble names a linked Jira issue, so the description may use Jira wiki text. */
  readonly jira: boolean;
}

/** Split the generated Ticket preamble from the Ticket's own description. */
export function splitWorkbenchTicketContext(markdown: string): WorkbenchTicketContextSections {
  const unsplit = { headerMarkdown: markdown, bodyMarkdown: "", jira: false };
  const lines = markdown.split("\n");
  const scopeIndex = lines.indexOf("## Repository scope");
  if (
    lines[0]?.startsWith("# ") !== true ||
    lines[1] !== "" ||
    lines[2]?.startsWith("Ticket type: ") !== true ||
    scopeIndex < 0 ||
    lines[scopeIndex + 1] !== ""
  ) {
    return unsplit;
  }

  let bodyStart = scopeIndex + 2;
  while (bodyStart < lines.length && lines[bodyStart]?.startsWith("- ")) {
    bodyStart += 1;
  }
  if (lines[bodyStart] !== "") {
    return unsplit;
  }

  return {
    headerMarkdown: lines.slice(0, bodyStart).join("\n"),
    bodyMarkdown: lines.slice(bodyStart + 1).join("\n"),
    jira: lines.slice(3, scopeIndex).some((line) => line.startsWith("Jira issue: ")),
  };
}

export function WorkbenchTicketContextPreview({ markdown }: { readonly markdown: string }) {
  const { headerMarkdown, bodyMarkdown, jira } = splitWorkbenchTicketContext(markdown);
  return (
    <div className="space-y-3">
      <WorkbenchDescription markdown={headerMarkdown} />
      {bodyMarkdown.trim() ? <WorkbenchDescription markdown={bodyMarkdown} jira={jira} /> : null}
    </div>
  );
}
