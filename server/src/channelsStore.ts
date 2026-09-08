import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DATA_DIR, db } from "./db";

export const DEFAULT_CHANNELS = ["Canal 1", "Canal 2", "Canal 3", "Canal 4", "Canal 5"];

function migrateFromJsonIfNeeded(): string[] | null {
  const legacyFile = join(DATA_DIR, "channels.json");
  if (!existsSync(legacyFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(legacyFile, "utf8"));
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === "string") && parsed.length > 0) {
      console.log(`Migrando ${parsed.length} canal(is) de channels.json para o banco SQLite.`);
      return parsed;
    }
  } catch {
    // arquivo corrompido, ignora
  }
  return null;
}

export function loadChannels(): string[] {
  const countRow = db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number };
  if (countRow.count === 0) {
    const migrated = migrateFromJsonIfNeeded();
    saveChannels(migrated ?? DEFAULT_CHANNELS);
  }
  const rows = db.prepare("SELECT name FROM channels ORDER BY position").all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function saveChannels(channels: string[]): void {
  const replace = db.transaction((names: string[]) => {
    db.prepare("DELETE FROM channels").run();
    const insert = db.prepare("INSERT INTO channels (name, position) VALUES (?, ?)");
    names.forEach((name, index) => insert.run(name, index));
  });
  replace(channels);
}
