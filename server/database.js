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

function ensureProfileTextColumns(db) {
  for (const tableName of ["employee_submissions", "employee_submission_revisions"]) {
    const columnNames = new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
    for (const columnName of ["identity_card_number", "work_experience"]) {
      if (!columnNames.has(columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} TEXT`);
      }
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
  db.transaction(() => {
    if (!db.prepare('PRAGMA table_info(employee_submission_revisions)').all().some(column => column.name === 'actor_display_name')) db.exec('ALTER TABLE employee_submission_revisions ADD COLUMN actor_display_name TEXT');
    ensurePositionColumns(db);
    ensureProfileTextColumns(db);
  }).immediate();
  return db;
}
