// @effect-diagnostics nodeBuiltinImport:off - Demo Jira links are written with Node SQLite while the demo is stopped.
import * as NodeSqlite from "node:sqlite";

import { demoDatabasePath, requireHome, resetHome } from "./environment.mts";

// Synthetic issues on a reserved domain: Workbench stores and shows links but never contacts Jira.
const JIRA_BROWSE_URL = "https://jira.example.invalid/browse/";
const LINKS = [
  { table: "workbench_epics", idColumn: "epic_id", id: "orbit-onboarding", key: "ORBIT-100" },
  { table: "workbench_tickets", idColumn: "ticket_id", id: "orbit-001", key: "ORBIT-101" },
  { table: "workbench_tickets", idColumn: "ticket_id", id: "orbit-002", key: "ORBIT-102" },
  { table: "workbench_tickets", idColumn: "ticket_id", id: "orbit-005", key: "ORBIT-105" },
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
      for (const link of LINKS) {
        const { changes } = db
          .prepare(
            `UPDATE ${link.table} SET jira_issue_key = ?, jira_issue_url = ? WHERE ${link.idColumn} = ?`,
          )
          .run(link.key, `${JIRA_BROWSE_URL}${link.key}`, link.id);
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
