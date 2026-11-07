// @effect-diagnostics nodeBuiltinImport:off - Demo links and artifacts are written with Node SQLite and the filesystem while the server is stopped.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { demoDatabasePath, resolveHome } from "./environment.mts";
import { DEMO_REPOSITORIES } from "./repositories.mts";

// Synthetic issues on a reserved domain: Workbench stores and shows links but never contacts Jira.
const JIRA_BROWSE_URL = "https://jira.example.invalid/browse/";
const TICKET_LINKS = [
  { id: "orbit-001", key: "ORBIT-101" },
  { id: "orbit-002", key: "ORBIT-102" },
  { id: "orbit-005", key: "ORBIT-105" },
] as const;

const PROGRESS_FIXTURES = [
  {
    id: "orbit-017",
    threadId: "orbit-017-api",
    progress:
      "- [x] PR 1. Orbit API: expiry and resend contract\n- [ ] PR 2. Orbit Web: expired-invitation page\n- [ ] PR 3. Orbit Web: pending invitations in team settings",
  },
  {
    id: "orbit-001",
    threadId: "orbit-001-thread",
    progress:
      "- [x] PR 1. Plan the welcome checklist\n- [ ] PR 2. Save completed steps\n- [ ] PR 3. Cover invitation recovery",
  },
  {
    id: "beacon-009",
    threadId: "beacon-009-thread",
    progress:
      "- [x] PR 1. Define the setup flow\n- [x] PR 2. Validate a profile\n- [ ] PR 3. Explain connection failures",
  },
] as const;

const SHOWCASE_TICKET_ID = "orbit-001";
const SHOWCASE_FILE_NAME = "welcome-checklist-plan.md";
const SHOWCASE_FILE_MARKDOWN = [
  "# Welcome checklist plan (synthetic)",
  "",
  "Synthetic demo artifact. No agent wrote this file; the demo seeds it to show a file Reference.",
  "",
  "1. Show three setup tasks on first sign-in.",
  "2. Save progress for each task.",
  "3. Hide the checklist when every task is done.",
  "",
].join("\n");

const STORY_FILES = [
  {
    name: "requirements.md",
    text: [
      "# Invitation recovery requirements (synthetic)",
      "",
      "Synthetic demo artifact. No provider implemented or verified this work.",
      "",
      "## PR 1. Orbit API: expiry and resend contract",
      "- Links expire after 7 days; expired links cannot accept an invitation.",
      "- Resend issues a fresh link for the original team and role.",
      "- Verify valid, expired, revoked, and repeated resend requests.",
      "",
      "## PR 2. Orbit Web: expired-invitation page",
      "- Explain that the link expired and offer Resend invitation.",
      "- Show success only after the service confirms a resend; retain retry on failure.",
      "- Verify keyboard access, success, failure, and toast timing.",
      "",
      "## PR 3. Orbit Web: pending invitations in team settings",
      "- List pending invitations with their role and expiry; allow resend and revoke.",
      "- Keep accepted and revoked invitations out of the pending list.",
      "- Use a separate pending-invitations checkout and PR.",
      "",
      "Open question: Should a resend also notify the team administrator?",
    ].join("\n"),
  },
  {
    name: "plan.md",
    text: [
      "# Invitation recovery plan (synthetic)",
      "",
      "Synthetic demo artifact. PR states, history, and recaps are illustrative; no provider ran.",
      "",
      "1. PR 1, Orbit API: define 7-day expiry and resend while preserving team and role. Fixture state: merged.",
      "2. PR 2, Orbit Web: build the expired-invitation page against that contract. Fixture state: open, failing Web tests and one unresolved review thread.",
      "3. PR 3, Orbit Web: add pending invitations in team settings in its own pending-invitations checkout. No PR yet.",
      "",
      "Start work prepares Orbit API and Orbit Web worktrees. PR 3's additional checkout belongs to its Thread; it is not another prepared Shared context worktree.",
      "",
      "See requirements.md for scope and acceptance and mockups/expired-invitation.html for the recovery page sketch.",
    ].join("\n"),
  },
  {
    name: "mockups/expired-invitation.html",
    text: `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expired invitation · Synthetic Orbit mockup</title>
<main><p>Synthetic Orbit mockup. Illustrative content; no invitation is sent.</p>
<h1>This invitation has expired</h1><p>Invitation links expire after 7 days. Request a new link to join the same team with the same role.</p>
<button type="button" disabled>Resend invitation</button><p>The demo action is disabled. The built page shows confirmation after the service accepts the resend, or a retry after a failure.</p></main></html>`,
  },
] as const;

/** The Ticket's folder under the server's state directory, where agents save artifacts. */
const artifactsDirectory = (databasePath: string, ticketId: string) =>
  NodePath.join(NodePath.dirname(databasePath), "workbench-artifacts", ticketId);

/** One Reference of each other kind; the GitHub issue URL is not backed by a real issue. */
const showcaseReferences = (artifactsDir: string) => [
  {
    url: `https://github.com/${DEMO_REPOSITORIES["orbit-web"].repository}/issues/1`,
    title: "[Synthetic] Review the welcome checklist copy",
  },
  {
    url: "https://example.com/orbit/welcome-checklist-design",
    title: "[Synthetic] Welcome checklist design",
  },
  {
    url: NodePath.join(artifactsDir, SHOWCASE_FILE_NAME),
    title: "[Synthetic] Implementation plan",
  },
];

/**
 * Give Orbit Tickets synthetic References after the native seed has created them.
 * The server must be stopped.
 */
export const seedDemoReferences = (home: string): void => {
  // Refuses the live ~/.t3 home; the path stays as given so it matches the server's artifacts path.
  resolveHome(home);
  const databasePath = demoDatabasePath(home);
  const artifactsDir = artifactsDirectory(databasePath, SHOWCASE_TICKET_ID);
  NodeFS.mkdirSync(artifactsDir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(artifactsDir, SHOWCASE_FILE_NAME), SHOWCASE_FILE_MARKDOWN);
  const storyDir = artifactsDirectory(databasePath, "orbit-017");
  for (const file of STORY_FILES) {
    const path = NodePath.join(storyDir, file.name);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, file.text + "\n");
  }
  const db = new NodeSqlite.DatabaseSync(databasePath);
  const addReference = db.prepare(
    `INSERT INTO workbench_references (ticket_id, url, title, added_by_thread_id, position, created_at)
     SELECT ticket.ticket_id, ?, ?, NULL,
       (SELECT COALESCE(MAX(position), -1) + 1 FROM workbench_references WHERE ticket_id = ticket.ticket_id),
       ticket.created_at
     FROM workbench_tickets AS ticket WHERE ticket.ticket_id = ?`,
  );
  const requireSeeded = (changes: number | bigint, id: string) => {
    if (changes !== 1) throw new Error(`Demo fixture ${id} is missing its seeded record.`);
  };
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      // The Jira issue comes first, so it stays the Ticket's identity label.
      for (const link of TICKET_LINKS) {
        requireSeeded(
          addReference.run(`${JIRA_BROWSE_URL}${link.key}`, null, link.id).changes,
          link.id,
        );
      }
      for (const reference of showcaseReferences(artifactsDir)) {
        requireSeeded(
          addReference.run(reference.url, reference.title, SHOWCASE_TICKET_ID).changes,
          SHOWCASE_TICKET_ID,
        );
      }
      for (const file of STORY_FILES) {
        requireSeeded(
          addReference.run(NodePath.join(storyDir, file.name), file.name, "orbit-017").changes,
          "orbit-017",
        );
      }
      for (const fixture of PROGRESS_FIXTURES) {
        requireSeeded(
          db
            .prepare(
              "UPDATE workbench_tickets SET progress = ?, progress_updated_by_thread_id = ?, revision = revision + 1 WHERE ticket_id = ?",
            )
            .run(fixture.progress, fixture.threadId, fixture.id).changes,
          fixture.id,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
};
