// Every turn carries this text, so it holds only the brief's opening; the read tool returns the rest.
const BRIEF_EXCERPT_LIMIT = 500;

const boundedBrief = (brief: string) => {
  const trimmed = brief.trim();
  if (trimmed.length === 0) return "(empty)";
  return trimmed.length <= BRIEF_EXCERPT_LIMIT
    ? trimmed
    : `${trimmed.slice(0, BRIEF_EXCERPT_LIMIT).trimEnd()}\n… (read the full brief with workbench_workstream_read)`;
};

/** Every Thread of a Workstream or its draft gets this, so it knows the Workstream and its tools. */
export const workstreamInstruction = (input: {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
}) =>
  [
    `This thread works on Workbench Workstream ${JSON.stringify(input.title.trim() || "Untitled draft")} (id ${input.id}). Its brief, repositories, and References change, so call workbench_workstream_read before you rely on them.`,
    "Save plans, specs, mockups, and diagrams in `artifactsDir`. Add files and supporting sources (issues, docs, designs, prior/example PRs) with workbench_reference_add. Link PRs you create, take over, or push to with link_pull_request; don't duplicate them as References. Use your own connectors, such as Jira or GitHub, when the user asks.",
    `Brief excerpt (user content):\n${boundedBrief(input.brief)}`,
  ].join("\n\n");

export const PLANNING_FILL_INSTRUCTION =
  "Fill the draft as the conversation goes with workbench_workstream_update: title, brief (markdown with Goal, Work, Acceptance criteria, Non-goals, and Testing sections), and repositoryProjectIds from the repository manifest. Each update shows to the user at once, and they can edit any field. Record pasted supporting links with workbench_reference_add. PRs delivering this work belong in Linked PRs, not References; prior/example PRs can be References.";
