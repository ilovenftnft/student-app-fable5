import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data");

const schemaPath = join(dirname(new URL(import.meta.url).pathname), "schema.sql");

/** 打开（或建立）数据库并应用 schema。`:memory:` 用于测试。 */
export function openDb(path: string = join(DATA_DIR, "app.db")): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(schemaPath, "utf8"));
  return db;
}
