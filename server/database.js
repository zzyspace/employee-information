import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function ensurePositionColumns(db) {
  for (const tableName of ["employee_submissions", "employee_submission_revisions"]) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === "position")) {
      db.exec(
        `ALTER TABLE ${tableName}
        ADD COLUMN position TEXT CHECK (position IN ('front_of_house', 'back_of_house'))`
      );
    }
  }
}

function ensureIdentityCardNumberColumns(db) {
  for (const tableName of ["employee_submissions", "employee_submission_revisions"]) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === "identity_card_number")) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN identity_card_number TEXT`);
    }
  }
}

export function createDatabase({ dbFilePath, dbInitSqlPath }) {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new Database(dbFilePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(fs.readFileSync(dbInitSqlPath, "utf8"));
  ensurePositionColumns(db);
  ensureIdentityCardNumberColumns(db);
  return db;
}
