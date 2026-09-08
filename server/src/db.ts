import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(__dirname, "..", "data");
const DB_FILE = join(DATA_DIR, "ptt.db");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    defaultChannel TEXT
  );

  CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    channel TEXT NOT NULL,
    userId TEXT NOT NULL,
    userName TEXT NOT NULL,
    action TEXT NOT NULL,
    durationMs INTEGER
  );
`);

export { DATA_DIR };
