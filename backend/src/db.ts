import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.sqlite");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT 'system', -- system | light | dark
      reset_token TEXT,
      reset_expires INTEGER
    );

    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      city TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'en',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_searches_user_time ON searches(user_id, created_at DESC);
  `);
}
