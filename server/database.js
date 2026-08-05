import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export function createDatabase({ dbFilePath, dbInitSqlPath }) {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new Database(dbFilePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(fs.readFileSync(dbInitSqlPath, "utf8"));
  return db;
}
