import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data");

const schemaPath = join(dirname(new URL(import.meta.url).pathname), "schema.sql");

/**
 * 已发布后新增的列：schema.sql 里的 CREATE TABLE IF NOT EXISTS 不会给老库补列，这里按列名补。
 * 规则：只加列、不删不改；新列必须有默认值或可空。
 */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "card_state", column: "last_pass_session", ddl: "INTEGER REFERENCES session(id)" },
  { table: "chapter", column: "points", ddl: "TEXT NOT NULL DEFAULT '[]'" },
];

export function migrate(db: DatabaseSync): string[] {
  const applied: string[] = [];
  for (const m of ADDED_COLUMNS) {
    const cols = (db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[]).map((c) => c.name);
    if (cols.length === 0 || cols.includes(m.column)) continue;
    db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`);
    applied.push(`${m.table}.${m.column}`);
  }
  return applied;
}

/** 打开（或建立）数据库并应用 schema 与迁移。`:memory:` 用于测试。 */
export function openDb(path: string = join(DATA_DIR, "app.db")): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(schemaPath, "utf8"));
  migrate(db);
  return db;
}
