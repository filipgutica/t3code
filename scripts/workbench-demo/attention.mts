// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Disposable demo fixtures own host provisioning outside the application runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { CommandId, ProjectId, ThreadId } from "../../packages/contracts/src/baseSchemas.ts";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "../../packages/contracts/src/providerPolicy.ts";
import type { ModelSelection } from "../../packages/contracts/src/modelSelection.ts";
import { demoDatabasePath } from "./environment.mts";
import { insertVisualMessage, readVisualThread, seedVisualRun } from "./native-projections.mts";
import { WORKBENCH_WS_METHODS } from "../../packages/contracts/src/workbenchRpc.ts";
import {
  WorkbenchAssignmentId,
  WorkbenchEpicId,
  WorkbenchProjectId,
  WorkbenchTicketId,
} from "../../packages/contracts/src/workbench.ts";
import { dispatch, runRpc } from "./local.mts";

const repository = "workbench-synthetic/attention-fixtures";
const apiRepository = "workbench-synthetic/attention-api";
const prefix = "synthetic-attention-";
const BUSY_FEEDBACK_MARKDOWN = [
  "> Synthetic attention fixture. No provider ran. Native turn outcomes and GitHub inspections are simulated; the adapter refuses all GitHub writes, including failed-check reruns.",
  "",
  "## Goal",
  "",
  "Resolve the outstanding review feedback for the invitation journey across Orbit Web and Orbit API. Keep the portal response, the invitation contract, and the expiry behavior consistent while the two existing review threads wait for separate decisions. This ticket deliberately combines a long specification with several live fixture attention sources so it can be used to review the complete ticket workspace.",
  "",
  "## Current review context",
  "",
  "The original assignment links the failed-check PR and the feedback PR. A second assignment shares the feedback PR because both discussions need the same review context; its duplicate link must not create duplicate PR attention. All three native threads belong to the ticket's primary Orbit Web project. The API contract review thread links a distinct clean PR in the API repository. That PR's repository identity should stay visible even when the thread title or PR title is long.",
  "",
  "The failed-check fixture has two failing checks in one workflow. The feedback fixture contains a requested-changes review and two unresolved discussions. Two interrupted native turns add separate unanswered questions. These are genuine fixture inputs to the normal notification and attention derivation, rather than static badges placed in the screenshot.",
  "",
  "## Repository responsibilities",
  "",
  "| Repository | Work to review | Existing fixture source |",
  "| --- | --- | --- |",
  "| Orbit Web | Empty response and recovery UI | Failed checks and unresolved review feedback |",
  "| Orbit API | Expiry contract and retry behavior | Separate clean API PR |",
  "",
  "## Decisions awaiting input",
  "",
  "1. Should an invitation expire after 24 hours or after 7 days? Confirm the policy before changing the displayed recovery text.",
  "2. When the invitation service returns an empty response, should the portal preserve the entered address and offer a retry? Confirm the intended recovery without claiming the invitation was sent.",
  "",
  "## Constraints",
  "",
  "- Preserve the existing invitation route and account authorization behavior.",
  "- Keep a pending invitation distinct from an accepted invitation.",
  "- Use the service response as the completion evidence; a successful click is insufficient.",
  "- Retain the address and current team selection after a temporary failure.",
  "- Repeated PR links should lead to the same inspection, with attention deduplicated by repository and PR identity.",
  "- Historical or settled assignments should remain discoverable without generating active notifications.",
  "",
  "## Example empty-response recovery",
  "",
  "```ts",
  'const exampleInvitation = { teamId: "synthetic-customer-platform-onboarding-team", address: "demo-reviewer@example.invalid", status: "pending", expiresAfterHours: 24 };',
  "// Synthetic illustration only: preserve the entered values if the service returns no invitation.",
  "// Do not interpret an empty response as a completed invitation.",
  "```",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] Read both unanswered thread questions and confirm their distinct sources.",
  "- [ ] Failed checks, requested changes, and unresolved discussions remain individually discoverable.",
  "- [ ] Sharing the feedback PR between assignments does not double its PR actions.",
  "- [ ] The API PR retains its separate repository identity and clean inspection.",
  "- [ ] Visiting one thread clears only its notification; the other question remains visible.",
  "- [ ] PR actions remain until the underlying synthetic inspection source resolves.",
  "- [ ] Long specification content scrolls without burying the primary thread and PR controls.",
  "- [ ] Keyboard focus can move from the description to every attention destination.",
  "",
  "## Verification matrix",
  "",
  "| Review state | Expected presentation | User action |",
  "| --- | --- | --- |",
  "| Waiting for a decision | Question and native thread destination | Open the thread |",
  "| Failed checks | Workflow and failed check names | Inspect the checks |",
  "| Requested changes | Reviewer and review content | Open the requested review |",
  "| Unresolved discussion | File path and specific comment | Inspect that discussion |",
  "| Clean API PR | Explicit open state without a warning | Review the separate change |",
  "",
  "## Visual review notes",
  "",
  "Start with the complete ticket at a wide width, then reduce the available width with the sidebar still present. Read down to this section while checking that the companion threads, PRs, and attention controls remain independently reachable. Repeat in light and dark themes, then use keyboard navigation to open and close an inspection without losing the ticket context.",
  "",
  "Use the long identifier `synthetic-customer-platform-onboarding-and-invitation-expiry-contract-verification` to check wrapping. A long repository URL or inline token should stay within the reading surface, while tables and fenced code may scroll in their own content containers. Essential state and recovery instructions must remain visible without hover.",
  "",
  "## References",
  "",
  "- [Synthetic invitation contract](https://example.invalid/orbit/api/invitations/expiry-and-empty-response-recovery?scenario=multi-repository-review-with-two-unanswered-native-thread-questions)",
  "- [Synthetic review checklist](https://example.invalid/orbit/reviews/invitation-recovery)",
].join("\n");
const fixtures = [
  { id: "waiting", title: "Waiting Thread", state: "interrupted" },
  { id: "review", title: "Review-ready work", state: "completed" },
  { id: "failed", title: "Failed PR checks", pr: 901 },
  { id: "feedback", title: "Unresolved PR feedback", pr: 902 },
  { id: "clean", title: "Clean Ticket" },
  { id: "settled", title: "Excluded settled Thread", state: "interrupted" },
  { id: "archived", title: "Excluded archived Thread", state: "interrupted" },
  { id: "superseded", title: "Excluded superseded Thread", state: "interrupted" },
  { id: "multiple", title: "Non-primary Thread needs input", state: "interrupted" },
  { id: "unavailable", title: "PR inspection unavailable", pr: 903 },
  { id: "incomplete", title: "PR inspection incomplete", pr: 904 },
  { id: "loading", title: "Slow PR inspection", pr: 905 },
] as const;

/** Installed only in disposable demos. It never forwards to real gh. */
export const installAttentionGitHubAdapter = async (
  home: string,
  environment: NodeJS.ProcessEnv,
) => {
  const bin = NodePath.join(home, "attention-bin");
  await NodeFSP.mkdir(bin, { recursive: true });
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await NodeFSP.writeFile(
    NodePath.join(bin, "gh"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(NodePath.join(import.meta.dirname, "gh-attention.mjs"))} "$@"\n`,
    { mode: 0o700 },
  );
  return {
    ...environment,
    PATH: `${bin}${NodePath.delimiter}${environment.PATH ?? ""}`,
    T3CODE_PATH_PREPEND: bin,
  };
};

/** Native RPC receipts create all records; provider outcomes are seeded offline afterwards. */
export const seedAttentionRecords = async ({
  home,
  wsUrl,
  token,
  modelSelection,
}: {
  home: string;
  wsUrl: string;
  token: string;
  modelSelection: ModelSelection;
}) => {
  const timestamp = new Date().toISOString();
  const projectId = ProjectId.make("orbit-web");
  const epicId = WorkbenchEpicId.make(prefix + "epic");
  await runRpc(wsUrl, token, (client) =>
    client[WORKBENCH_WS_METHODS.workbenchCreateEpic]({
      id: epicId,
      projectId: WorkbenchProjectId.make("orbit"),
      title: "Synthetic attention fixtures",
      createdAt: timestamp,
      markdown: "Synthetic review data. No provider executed and no GitHub request is sent.",
    }),
  );
  for (const fixture of fixtures) {
    const ticketId = WorkbenchTicketId.make(prefix + fixture.id);
    const threadId = ThreadId.make(prefix + fixture.id);
    await runRpc(wsUrl, token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateTicket]({
        id: ticketId,
        projectId: WorkbenchProjectId.make("orbit"),
        epicId,
        title: `[Synthetic attention] ${fixture.title}`,
        kind: "story",
        primaryT3ProjectId: projectId,
        repositoryProjectIds:
          fixture.id === "feedback" ? [projectId, ProjectId.make("orbit-api")] : [projectId],
        createdAt: timestamp,
        markdown:
          fixture.id === "feedback"
            ? BUSY_FEEDBACK_MARKDOWN
            : "Synthetic attention fixture. Thread outcomes and linked PR inspections are simulated. No provider ran. GitHub writes, including reruns, are refused by the demo adapter.",
      }),
    );
    const createThread = async (id: ThreadId) => {
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.create",
          commandId: CommandId.make(id + "-create"),
          threadId: id,
          projectId,
          title: `[Synthetic attention] ${fixture.title}${id === threadId ? "" : id.endsWith("-newest-clean") ? " — newest clean assignment" : id.endsWith("-api") ? " — API contract review" : " — shared PR assignment"}`,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "server",
        }),
      );
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.auto-settle.set",
          commandId: CommandId.make(id + "-no-auto-settle"),
          threadId: id,
          enabled: false,
        }),
      );
    };
    await createThread(threadId);
    await runRpc(wsUrl, token, (client) =>
      client[WORKBENCH_WS_METHODS.workbenchCreateAssignment]({
        id: WorkbenchAssignmentId.make(threadId + "-assignment"),
        ticketId,
        threadId,
        createdAt: timestamp,
      }),
    );
    if ("pr" in fixture)
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.pull-request.link",
          commandId: CommandId.make(threadId + "-pr"),
          threadId,
          host: "github.com",
          repository,
          number: fixture.pr,
          url: `https://github.com/${repository}/pull/${fixture.pr}`,
          source: "manual",
        }),
      );
    if (fixture.id === "feedback") {
      const sharedThreadId = ThreadId.make(threadId + "-shared-pr");
      const later = new Date(Date.parse(timestamp) + 1000).toISOString();
      await createThread(sharedThreadId);
      await runRpc(wsUrl, token, (client) =>
        client[WORKBENCH_WS_METHODS.workbenchCreateAssignment]({
          id: WorkbenchAssignmentId.make(sharedThreadId + "-assignment"),
          ticketId,
          threadId: sharedThreadId,
          createdAt: later,
        }),
      );
      for (const [targetId, number] of [
        [threadId, 901],
        [sharedThreadId, 902],
      ] as const)
        await runRpc(wsUrl, token, (client) =>
          dispatch(client, {
            type: "thread.pull-request.link",
            commandId: CommandId.make(targetId + "-pr-" + number),
            threadId: targetId,
            host: "github.com",
            repository,
            number,
            url: `https://github.com/${repository}/pull/${number}`,
            source: "manual",
          }),
        );
      const apiThreadId = ThreadId.make(threadId + "-api");
      const apiCreatedAt = new Date(Date.parse(timestamp) + 2000).toISOString();
      await createThread(apiThreadId);
      await runRpc(wsUrl, token, (client) =>
        client[WORKBENCH_WS_METHODS.workbenchCreateAssignment]({
          id: WorkbenchAssignmentId.make(apiThreadId + "-assignment"),
          ticketId,
          threadId: apiThreadId,
          createdAt: apiCreatedAt,
        }),
      );
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: "thread.pull-request.link",
          commandId: CommandId.make(apiThreadId + "-pr-906"),
          threadId: apiThreadId,
          host: "github.com",
          repository: apiRepository,
          number: 906,
          url: `https://github.com/${apiRepository}/pull/906`,
          source: "manual",
        }),
      );
    }
    if (fixture.id === "settled" || fixture.id === "archived")
      await runRpc(wsUrl, token, (client) =>
        dispatch(client, {
          type: fixture.id === "settled" ? "thread.settle" : "thread.archive",
          commandId: CommandId.make(threadId + "-exclude"),
          threadId,
        }),
      );
    if (fixture.id === "superseded" || fixture.id === "multiple") {
      const nextThreadId = ThreadId.make(threadId + "-newest-clean");
      const later = new Date(Date.parse(timestamp) + 1000).toISOString();
      await createThread(nextThreadId);
      if (fixture.id === "superseded")
        await runRpc(wsUrl, token, (client) =>
          client[WORKBENCH_WS_METHODS.workbenchReplaceAssignment]({
            id: WorkbenchAssignmentId.make(nextThreadId + "-assignment"),
            ticketId,
            previousThreadId: threadId,
            threadId: nextThreadId,
            replacedAt: later,
          }),
        );
      else
        await runRpc(wsUrl, token, (client) =>
          client[WORKBENCH_WS_METHODS.workbenchCreateAssignment]({
            id: WorkbenchAssignmentId.make(nextThreadId + "-assignment"),
            ticketId,
            threadId: nextThreadId,
            createdAt: later,
          }),
        );
    }
  }
  await NodeFSP.writeFile(
    NodePath.join(home, ".synthetic-attention-owned"),
    "synthetic-attention-v1\n",
    { mode: 0o600 },
  );
};

const attentionFixtureContext = (fixture: (typeof fixtures)[number]) => {
  if (["waiting", "multiple"].includes(fixture.id))
    return "\n\n[Synthetic waiting question] Should invitation links expire after 24 hours or 7 days? Choose one before continuing.";
  if (fixture.id === "review")
    return "\n\n[Synthetic review summary] Example outcomes to review: valid invitations show the next step, empty or malformed addresses show a useful error, and expired links offer a recovery action. This is sample review context only; no provider ran and no actual code diff exists.";
  if (fixture.id === "feedback")
    return "\n\n[Synthetic waiting question] Should invitation links expire after 24 hours or 7 days? Confirm the policy before updating the recovery text.";
  return "";
};

const attentionNotificationThreadIds = (fixture: (typeof fixtures)[number]) => {
  const id = prefix + fixture.id;
  return fixture.id === "feedback" ? [id, id + "-shared-pr"] : "state" in fixture ? [id] : [];
};

const seedAttentionFixtureTurn = ({
  db,
  fixture,
  threadId,
  timestamp,
}: {
  db: NodeSqlite.DatabaseSync;
  fixture: (typeof fixtures)[number];
  threadId: string;
  timestamp: string;
}) => {
  seedVisualRun({
    db,
    threadId,
    runId: threadId + "-turn",
    status: "state" in fixture ? fixture.state : "interrupted",
    timestamp,
  });
};

const seedAttentionFixtureOutcome = ({
  db,
  fixture,
  timestamp,
}: {
  db: NodeSqlite.DatabaseSync;
  fixture: (typeof fixtures)[number];
  timestamp: string;
}) => {
  const id = prefix + fixture.id;
  readVisualThread({ db, threadId: id });
  for (const threadId of attentionNotificationThreadIds(fixture))
    seedAttentionFixtureTurn({ db, fixture, threadId, timestamp });
  insertVisualMessage({
    db,
    messageId: id + "-label",
    threadId: id,
    role: "assistant",
    text:
      "[Synthetic attention fixture] No provider ran. Turn outcomes and PR inspections are simulated; rerun requests are refused. See the fixture guide." +
      attentionFixtureContext(fixture),
    timestamp,
  });
  if (fixture.id === "feedback")
    insertVisualMessage({
      db,
      messageId: id + "-shared-pr-label",
      threadId: id + "-shared-pr",
      role: "assistant",
      text: "[Synthetic attention fixture] No provider ran. [Synthetic waiting question] Should an empty invitation response preserve the entered address and offer a retry? Confirm the intended recovery before continuing.",
      timestamp,
    });
};

/** Projection-only outcomes, called after the seeding server has exited. Never an event history. */
export const seedAttentionOutcomes = async (home: string) => {
  if (
    (await NodeFSP.readFile(NodePath.join(home, ".synthetic-attention-owned"), "utf8")) !==
    "synthetic-attention-v1\n"
  )
    throw new Error("Synthetic attention records have not been seeded in this home.");
  const runtimePath = NodePath.join(home, "userdata", "server-runtime.json");
  const runtime: unknown = await NodeFSP.readFile(runtimePath, "utf8").then(
    (text) => JSON.parse(text),
    (error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (runtime !== null) {
    if (typeof runtime !== "object" || !("pid" in runtime) || typeof runtime.pid !== "number")
      throw new Error("Invalid demo server runtime record.");
    let active = true;
    try {
      process.kill(runtime.pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") active = false;
      else throw error;
    }
    if (active) throw new Error("Stop the demo server before seeding synthetic outcomes.");
  }
  const db = new NodeSqlite.DatabaseSync(demoDatabasePath(home));
  const timestamp = new Date().toISOString();
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const fixture of fixtures) seedAttentionFixtureOutcome({ db, fixture, timestamp });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
};
