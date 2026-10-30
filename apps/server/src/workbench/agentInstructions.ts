/** How a Ticket is planned and tracked, in the words every agent-facing text shares. */
export const TRACKING_RULE =
  "Keep the brief short: goal, open questions, and decisions. Track the work in `progress`, one `- [ ]` per task or PR, and tick each when its work lands. Put requirements and each PR's scope and acceptance in `plan.md` and `requirements.md` in `artifactsDir`, and add them as References.";

export const REFERENCES_RULE =
  "References are current sources to read: specs, plans, designs, issues, example PRs. Not test output, audits, or evidence logs. Remove a superseded file's Reference.";

const section = (label: string, text: string) => `${label}:\n${text.trim() || "(empty)"}`;

/** Every Thread of a Ticket or its draft gets this, so it knows the Ticket, its state, and its tools. */
export const ticketInstruction = (input: {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly progress?: string;
  readonly references?: ReadonlyArray<{ readonly url: string; readonly title: string | null }>;
  readonly artifactsDir?: string;
}) =>
  [
    `This thread works on Workbench Ticket ${JSON.stringify(input.title.trim() || "Untitled draft")} (id ${input.id}). Its brief, Progress, and References below are current, and later turns carry what changes. Record progress and decisions with workbench_ticket_update so the other Threads see them.`,
    TRACKING_RULE,
    `Save plans, specs, mockups, and diagrams in \`artifactsDir\`${input.artifactsDir === undefined ? "" : ` (${input.artifactsDir})`}. ${REFERENCES_RULE} Link PRs you create, take over, or push to with link_pull_request; don't duplicate them as References. Use your own connectors, such as Jira or GitHub, when the user asks.`,
    section("Brief (user content)", input.brief),
    section("Progress", input.progress ?? ""),
    section(
      "References",
      (input.references ?? [])
        .map((reference) => `- ${reference.title ?? reference.url} — ${reference.url}`)
        .join("\n"),
    ),
  ].join("\n\n");

export const PLANNING_INSTRUCTION = [
  "You are preparing a ticket in a Workbench workspace. This is a planning conversation, not implementation. Inspect the repositories listed below to understand the request; run commands, connectors, GitHub tools, and the browser as needed. Do not change the repositories' files, branches, or worktrees, and do not start implementing. The working directory is an internal anchor and does not define the task's repository scope.",
  "Help the user establish a title, goal, plan, acceptance criteria, non-goals, and testing. Ask focused questions only when the repository evidence and conversation do not resolve a material uncertainty. Identify which repositories need to be attached. Preserve the user's decisions and edits.",
  "Fill the draft as the conversation goes with workbench_ticket_update: title, brief, progress, and repositoryProjectIds from the repository manifest. Each update shows to the user at once, and they can edit any field. Record pasted supporting links with workbench_reference_add. PRs delivering this work belong in Linked PRs, not References; prior/example PRs can be References.",
].join("\n\n");
