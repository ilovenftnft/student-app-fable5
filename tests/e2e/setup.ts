/** 端到端前置：把真实内容库拷一份到 tests/e2e/.tmp，内容启用日设为今天。 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { localDate } from "../../src/server/scheduler/day.ts";

export default function setup(): void {
  const dir = join(import.meta.dirname, ".tmp");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const src = join(import.meta.dirname, "../../data/app.db");
  if (!existsSync(src)) throw new Error("先 npm run load && npm run load:chapters 生成 data/app.db");
  const s = new DatabaseSync(src);
  s.exec(`VACUUM INTO '${join(dir, "app.db")}'`);
  s.close();
  const d = new DatabaseSync(join(dir, "app.db"));
  d.prepare("INSERT OR REPLACE INTO setting (key, value) VALUES ('content_start', ?)").run(localDate(new Date()));
  // 真实库里可能已有今天的会话（家长自己点过），测试副本从零开始
  for (const t of ["review", "reflection", "recall", "checkin", "explanation", "session", "card_state"]) d.exec(`DELETE FROM ${t}`);
  d.exec("DELETE FROM setting WHERE key LIKE 'start:%' OR key LIKE 'start_done:%' OR key LIKE 'checkin_done:%' OR key LIKE 'deferred:%'");
  d.close();
}
