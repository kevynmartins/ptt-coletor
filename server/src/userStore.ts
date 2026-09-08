import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { DATA_DIR, db } from "./db";

interface StoredUser {
  username: string;
  salt: string;
  hash: string;
  defaultChannel: string | null;
}

export interface UserAccount {
  username: string;
  defaultChannel: string | null;
}

export interface OpResult {
  ok: boolean;
  error?: string;
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64);
}

function migrateFromJsonIfNeeded(): void {
  const countRow = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (countRow.count > 0) return;

  const legacyFile = join(DATA_DIR, "users.json");
  if (!existsSync(legacyFile)) return;

  try {
    const parsed = JSON.parse(readFileSync(legacyFile, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    const insert = db.prepare(
      "INSERT INTO users (username, salt, hash, defaultChannel) VALUES (@username, @salt, @hash, @defaultChannel)"
    );
    const insertMany = db.transaction((users: StoredUser[]) => {
      for (const u of users) insert.run({ ...u, defaultChannel: u.defaultChannel ?? null });
    });
    insertMany(parsed.map((u) => ({ defaultChannel: null, ...u })));
    console.log(`Migrado ${parsed.length} usuário(s) de users.json para o banco SQLite.`);
  } catch (err) {
    console.error("Falha ao migrar users.json para SQLite:", (err as Error).message);
  }
}

migrateFromJsonIfNeeded();

export function listUsers(): UserAccount[] {
  const rows = db.prepare("SELECT username, defaultChannel FROM users ORDER BY username").all() as UserAccount[];
  return rows;
}

export function getUser(username: string): UserAccount | null {
  const row = db
    .prepare("SELECT username, defaultChannel FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as UserAccount | undefined;
  return row ?? null;
}

export function createUser(username: string, password: string, defaultChannel: string | null = null): OpResult {
  const trimmed = username.trim();
  if (!trimmed) return { ok: false, error: "Usuário não pode ser vazio" };
  if (!password || password.length < 4) {
    return { ok: false, error: "Senha precisa ter pelo menos 4 caracteres" };
  }
  const existing = db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(trimmed);
  if (existing) return { ok: false, error: "Já existe um usuário com esse nome" };

  const salt = randomBytes(16);
  const hash = hashPassword(password, salt);
  db.prepare("INSERT INTO users (username, salt, hash, defaultChannel) VALUES (?, ?, ?, ?)").run(
    trimmed,
    salt.toString("hex"),
    hash.toString("hex"),
    defaultChannel
  );
  return { ok: true };
}

export function updateUser(
  username: string,
  changes: { password?: string; defaultChannel?: string | null }
): OpResult {
  const row = db
    .prepare("SELECT username FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as { username: string } | undefined;
  if (!row) return { ok: false, error: "Usuário não encontrado" };

  if (changes.password) {
    if (changes.password.length < 4) {
      return { ok: false, error: "Senha precisa ter pelo menos 4 caracteres" };
    }
    const salt = randomBytes(16);
    const hash = hashPassword(changes.password, salt);
    db.prepare("UPDATE users SET salt = ?, hash = ? WHERE username = ?").run(
      salt.toString("hex"),
      hash.toString("hex"),
      row.username
    );
  }
  if (changes.defaultChannel !== undefined) {
    db.prepare("UPDATE users SET defaultChannel = ? WHERE username = ?").run(changes.defaultChannel, row.username);
  }
  return { ok: true };
}

export function deleteUser(username: string): OpResult {
  const result = db.prepare("DELETE FROM users WHERE username = ? COLLATE NOCASE").run(username);
  if (result.changes === 0) return { ok: false, error: "Usuário não encontrado" };
  return { ok: true };
}

export function verifyUser(username: string, password: string): boolean {
  if (!username || !password) return false;
  const row = db
    .prepare("SELECT salt, hash FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as { salt: string; hash: string } | undefined;
  if (!row) return false;
  const salt = Buffer.from(row.salt, "hex");
  const expected = Buffer.from(row.hash, "hex");
  const actual = hashPassword(password, salt);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
