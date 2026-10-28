// @effect-diagnostics nodeBuiltinImport:off - Demo Jira links are written with Node SQLite while the demo is stopped.
import * as NodeSqlite from "node:sqlite";

import { demoDatabasePath, requireHome, resetHome } from "./environment.mts";

// Synthetic issues on a reserved domain: Workbench stores and shows links but never contacts Jira.
const JIRA_BROWSE_URL = "https://jira.example.invalid/browse/";
const EPIC_LINKS = [{ id: "orbit-onboarding", key: "ORBIT-100" }] as const;
const TICKET_LINKS = [
  { id: "orbit-001", key: "ORBIT-101" },
  { id: "orbit-002", key: "ORBIT-102" },
  { id: "orbit-005", key: "ORBIT-105" },
] as const;

/** Link seeded Orbit records to Jira issues; the server must be stopped. */
export const seedDemoJiraLinks = (input: string): void => {
  const home = requireHome(input);
  // Reuse the stopped-server checks of local reset; preview mutates nothing.
  resetHome({ home, apply: false });
  const db = new NodeSqlite.DatabaseSync(demoDatabasePath(home));
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const link of EPIC_LINKS) {
        const { changes } = db
          .prepare(
            "UPDATE workbench_epics SET jira_issue_key = ?, jira_issue_url = ? WHERE epic_id = ?",
          )
          .run(link.key, `${JIRA_BROWSE_URL}${link.key}`, link.id);
        if (changes !== 1) throw new Error(`Demo fixture ${link.id} is missing its seeded record.`);
      }
      // Ticket issue links are References; a seeded Ticket has none yet, so each takes position 0.
      for (const link of TICKET_LINKS) {
        const { changes } = db
          .prepare(
            `INSERT INTO workbench_references (ticket_id, url, title, added_by_thread_id, position, created_at)
             SELECT ticket_id, ?, NULL, NULL, 0, created_at FROM workbench_tickets WHERE ticket_id = ?`,
          )
          .run(`${JIRA_BROWSE_URL}${link.key}`, link.id);
        if (changes !== 1) throw new Error(`Demo fixture ${link.id} is missing its seeded record.`);
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
