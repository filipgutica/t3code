// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Optional offline screenshot fixtures use Node SQLite after the demo has stopped.
import * as NodeSqlite from "node:sqlite";
import * as NodePath from "node:path";
import { requireHome, resetHome } from "./environment.mts";

/** Projection-only content for screenshots; this is not an orchestration event history. */
export const seedVisualHistory = (input: string) => {
  const home = requireHome(input);
  // Reuse the same conservative stopped-server checks as local reset; preview mutates nothing.
  resetHome({ home, apply: false });
  const db = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata", "state.sqlite"));
  const threads = [
    "orbit-001-thread",
    "orbit-005-thread",
    "beacon-009-thread",
    "beacon-014-thread",
  ];
  try {
    for (const id of threads) {
      if (!db.prepare("SELECT thread_id FROM projection_threads WHERE thread_id = ?").get(id))
        throw new Error("Run seed before adding screenshot history.");
    }
    const backup = NodePath.join(home, `before-visual-history-${Date.now()}.sqlite`);
    db.prepare("VACUUM INTO ?").run(backup);
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare(
        "INSERT OR IGNORE INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      );
      const texts = [
        [
          "user",
          "[Synthetic demo conversation] Please work through this ticket's acceptance criteria and describe the checks you would run.",
        ],
        [
          "assistant",
          "[Synthetic demo conversation] I have outlined the implementation and verification steps. This transcript is a screenshot fixture; no provider was invoked and no implementation was performed.",
        ],
      ];
      for (const id of threads) {
        for (const [index, entry] of texts.entries()) {
          const timestamp = new Date(Date.UTC(2026, 0, 1, 12, index)).toISOString();
          insert.run(`demo-history-${id}-${index}`, id, entry[0]!, entry[1]!, timestamp, timestamp);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      backup,
      syntheticMessages: 8,
      kind: "projection-only screenshot fixture",
      next: "Start the demo again. Reset local state before using it for provider behavior tests.",
    };
  } finally {
    db.close();
  }
};
