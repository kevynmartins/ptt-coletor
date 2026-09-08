import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DATA_DIR, db } from "./db";
import type { ActivityEntry } from "./protocol";

const MAX_RECENT = 200;

function migrateFromLegacyLogIfNeeded(): void {
  const countRow = db.prepare("SELECT COUNT(*) as count FROM activity").get() as { count: number };
  if (countRow.count > 0) return;

  const legacyFile = join(DATA_DIR, "activity.log");
  if (!existsSync(legacyFile)) return;

  try {
    const lines = readFileSync(legacyFile, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) return;
    const insert = db.prepare(
      "INSERT INTO activity (time, channel, userId, userName, action, durationMs) VALUES (@time, @channel, @userId, @userName, @action, @durationMs)"
    );
    const insertMany = db.transaction((entries: ActivityEntry[]) => {
      for (const e of entries) insert.run({ ...e, durationMs: e.durationMs ?? null });
    });
    insertMany(lines.map((line) => JSON.parse(line) as ActivityEntry));
    console.log(`Migradas ${lines.length} entrada(s) de activity.log para o banco SQLite.`);
  } catch (err) {
    console.error("Falha ao migrar activity.log para SQLite:", (err as Error).message);
  }
}

export function loadActivityLog(): void {
  migrateFromLegacyLogIfNeeded();
}

export function appendActivity(entry: ActivityEntry): void {
  db.prepare(
    "INSERT INTO activity (time, channel, userId, userName, action, durationMs) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(entry.time, entry.channel, entry.userId, entry.userName, entry.action, entry.durationMs ?? null);
}

export function getRecentActivity(): ActivityEntry[] {
  const rows = db
    .prepare(
      "SELECT time, channel, userId, userName, action, durationMs FROM activity ORDER BY id DESC LIMIT ?"
    )
    .all(MAX_RECENT) as (ActivityEntry & { durationMs: number | null })[];
  return rows.map((r) => ({ ...r, durationMs: r.durationMs ?? undefined }));
}
