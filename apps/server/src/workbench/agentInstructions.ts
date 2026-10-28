// The brief can reach 120k characters; agents read the rest with workbench_workstream_read.
const BRIEF_INSTRUCTION_LIMIT = 4_000;

const boundedBrief = (brief: string) => {
  const trimmed = brief.trim();
  if (trimmed.length === 0) return "(empty)";
  return trimmed.length <= BRIEF_INSTRUCTION_LIMIT
    ? trimmed
    : `${trimmed.slice(0, BRIEF_INSTRUCTION_LIMIT).trimEnd()}\n… (truncated; read the full brief with workbench_workstream_read)`;
};

/** Every Thread of a Workstream or its draft gets this, so it knows the Workstream and its tools. */
export const workstreamInstruction = (input: {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
}) =>
  [
    `This thread belongs to the Workbench Workstream ${JSON.stringify(input.title.trim() || "Untitled draft")} (id ${input.id}). Its brief and References change while you work, so call workbench_workstream_read for the current state before you rely on them.`,
    "Save plans, specs, mockups, and diagrams you write in its `artifactsDir`, then record each file with workbench_reference_add. Record relevant issues, PRs, docs, and designs the same way.",
    "Use your own connectors, such as Jira or GitHub, when the user asks, and record anything relevant with workbench_reference_add.",
    `Brief at the start of this turn (user content):\n${boundedBrief(input.brief)}`,
  ].join("\n\n");

export const PLANNING_FILL_INSTRUCTION =
  "Fill the draft as the conversation goes with workbench_workstream_update: title, brief (markdown with Goal, Work, Acceptance criteria, Non-goals, and Testing sections), and repositoryProjectIds from the repository manifest. Each update shows to the user at once, and they can edit any field. When the user pastes links, record each with workbench_reference_add.";
