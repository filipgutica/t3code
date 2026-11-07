// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Synthetic story projections are written only to stopped disposable demos.
import * as NodeSqlite from "node:sqlite";
import { demoDatabasePath, requireHome, resetHome } from "./environment.mts";
import { insertVisualMessage, readVisualThread, seedVisualRun } from "./native-projections.mts";

/** Screenshot data only: native Projects, Threads and Assignments were created by RPC. */
export const seedStoryOutcomes = (input: string) => {
  const home = requireHome(input);
  resetHome({ home, apply: false });
  const db = new NodeSqlite.DatabaseSync(demoDatabasePath(home));
  const timestamp = new Date().toISOString();
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const threadId of ["orbit-017-api", "orbit-017-web", "orbit-017-settings"])
      readVisualThread({ db, threadId });
    const summary = db
      .prepare(`UPDATE workbench_tickets
      SET generated_summary = ?, generated_summary_status = 'ready',
        generated_summary_stale = 0, generated_summary_error = NULL,
        generated_summary_request_id = NULL
      WHERE ticket_id = 'orbit-017'`)
      .run(
        "[Synthetic summary] API expiry and resend are merged. The recovery page awaits passing Web tests and one review; the pending-invitations list is planned. No provider ran.",
      );
    if (summary.changes !== 1) throw new Error("Missing story Ticket orbit-017.");
    for (const [threadId, text] of [
      [
        "orbit-017-api",
        "Merged 7-day expiry and the resend endpoint. Resend keeps the team and role. [Synthetic recap; no provider ran.]",
      ],
      [
        "orbit-017-web",
        "Web tests fail on toast timing; 1 review open. The page and Resend button are built. [Synthetic recap; no provider ran.]",
      ],
    ] as const) {
      db.prepare(`INSERT INTO workbench_thread_recaps (thread_id, run_id, text, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE
        SET run_id = excluded.run_id, text = excluded.text, updated_at = excluded.updated_at`).run(
        threadId,
        threadId === "orbit-017-web"
          ? "synthetic-story-web-reply"
          : `synthetic-story-recap-${threadId}`,
        text,
        timestamp,
      );
    }
    for (const [role, text] of [
      [
        "user",
        "[Synthetic demo conversation] Keep the 7-day expiry and preserve the invitation's team and role when resending.",
      ],
      [
        "assistant",
        "[Synthetic demo conversation] The API contract and resend endpoint are represented as merged in this fixture. No provider ran or verified an implementation.",
      ],
    ] as const)
      insertVisualMessage({
        db,
        messageId: `synthetic-story-api-${role}`,
        threadId: "orbit-017-api",
        role,
        text,
        timestamp,
      });
    // No nonterminal run is fabricated: native startup recovery would interrupt it.
    seedVisualRun({
      db,
      threadId: "orbit-017-web",
      runId: "synthetic-story-web-reply",
      status: "completed",
      timestamp,
    });
    insertVisualMessage({
      db,
      messageId: "synthetic-story-web-assistant",
      threadId: "orbit-017-web",
      role: "assistant",
      text: "[Synthetic demo conversation] Web tests fail on toast timing; one review remains open. No provider ran.",
      timestamp,
    });
    insertVisualMessage({
      db,
      messageId: "synthetic-story-settings-label",
      threadId: "orbit-017-settings",
      role: "user",
      text: "[Synthetic demo conversation] PR 3 is planned in this Thread's separate pending-invitations checkout. No provider is running and no PR exists yet.",
      timestamp,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
};
