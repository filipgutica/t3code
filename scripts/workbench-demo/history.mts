// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Optional offline screenshot fixtures use Node SQLite after the demo has stopped.
import * as NodeSqlite from "node:sqlite";
import * as NodePath from "node:path";
import { demoDatabasePath, requireHome, resetHome } from "./environment.mts";
import { insertVisualMessage, readVisualThread } from "./native-projections.mts";

/** Projection-only content for screenshots; this is not an orchestration event history. */
export const seedVisualHistory = (input: string) => {
  const home = requireHome(input);
  // Reuse the same conservative stopped-server checks as local reset; preview mutates nothing.
  resetHome({ home, apply: false });
  const db = new NodeSqlite.DatabaseSync(demoDatabasePath(home));
  const threads = [
    "orbit-001-thread",
    "orbit-005-thread",
    "beacon-009-thread",
    "beacon-014-thread",
  ];
  try {
    for (const id of threads) {
      readVisualThread({ db, threadId: id });
    }
    const backup = NodePath.join(home, `before-visual-history-${Date.now()}.sqlite`);
    db.prepare("VACUUM INTO ?").run(backup);
    db.exec("BEGIN IMMEDIATE");
    try {
      const texts = [
        [
          "user",
          "[Synthetic demo conversation] Please work through this ticket's acceptance criteria and describe the checks you would run.",
        ],
        [
          "assistant",
          "[Synthetic demo conversation] I have outlined the implementation and verification steps. This transcript is a screenshot fixture; no provider was invoked and no implementation was performed.",
        ],
      ] as const;
      for (const id of threads) {
        for (const [index, entry] of texts.entries()) {
          const timestamp = new Date(Date.UTC(2026, 0, 1, 12, index)).toISOString();
          insertVisualMessage({
            db,
            messageId: `demo-history-${id}-${index}`,
            threadId: id,
            role: entry[0],
            text: entry[1],
            timestamp,
          });
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
