import { WorkbenchDescription } from "./WorkbenchDescription";

export interface WorkbenchTicketContextSections {
  readonly headerMarkdown: string;
  readonly bodyMarkdown: string;
}

/** Split the generated Ticket preamble from the Ticket's own description. */
export function splitWorkbenchTicketContext(markdown: string): WorkbenchTicketContextSections {
  const lines = markdown.split("\n");
  if (
    lines[0]?.startsWith("# ") !== true ||
    lines[1] !== "" ||
    lines[2]?.startsWith("Ticket type: ") !== true ||
    lines[3] !== "" ||
    lines[4] !== "## Repository scope" ||
    lines[5] !== ""
  ) {
    return { headerMarkdown: markdown, bodyMarkdown: "" };
  }

  let bodyStart = 6;
  while (bodyStart < lines.length && lines[bodyStart]?.startsWith("- ")) {
    bodyStart += 1;
  }
  if (lines[bodyStart] !== "") {
    return { headerMarkdown: markdown, bodyMarkdown: "" };
  }

  return {
    headerMarkdown: lines.slice(0, bodyStart).join("\n"),
    bodyMarkdown: lines.slice(bodyStart + 1).join("\n"),
  };
}

export function WorkbenchTicketContextPreview({
  markdown,
  jira,
}: {
  readonly markdown: string;
  readonly jira: boolean;
}) {
  const { headerMarkdown, bodyMarkdown } = splitWorkbenchTicketContext(markdown);
  return (
    <div className="space-y-3">
      <WorkbenchDescription markdown={headerMarkdown} />
      {bodyMarkdown.trim() ? <WorkbenchDescription markdown={bodyMarkdown} jira={jira} /> : null}
    </div>
  );
}
