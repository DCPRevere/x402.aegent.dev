import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

/**
 * Single sqlite handle, opened lazily. WAL mode for concurrent reads while a
 * writer is open. Tests can opt into ":memory:" by setting DATABASE_PATH=":memory:".
 *
 * Each product owns its own table prefix; migrations are registered through
 * `runMigrations` and are idempotent (CREATE TABLE IF NOT EXISTS).
 */

let _db: Database.Database | null = null;

function openDb(): Database.Database {
  const target = config.databasePath;
  if (target !== ":memory:") {
    const dir = path.dirname(target);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

export function getDb(): Database.Database {
  if (!_db) _db = openDb();
  return _db;
}

/**
 * Replace the active database handle. Used by tests that need a clean per-test
 * sqlite instance without paying the env-var dance.
 */
export function setDbForTesting(db: Database.Database): void {
  _db = db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Runs a list of CREATE TABLE / CREATE INDEX statements idempotently. Safe to
 * call at every product mount; the IF NOT EXISTS guards make this cheap.
 */
export function runMigrations(statements: string[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    for (const stmt of statements) db.exec(stmt);
  });
  tx();
}
