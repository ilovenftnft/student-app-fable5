/**
 * 章节树入库：npm run load:chapters [-- 生物-七上 …] [--dry-run]
 * 每个要点的出处逐字核对，核不上的不入库并列出。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { flattenChapters, upsertChapters, type ChapterFile } from "./chapters.ts";
import { ROOT, textbookOf } from "./textbooks.ts";
import { openDb } from "../db/open.ts";

const DIR = join(ROOT, "content/chapters");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const names = args.filter((a) => !a.startsWith("--")).map((n) => basename(n, ".json"));
const files = names.length ? names : (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => basename(f, ".json")).sort() : []);

let all = 0, allMissing = 0;
const rows = [];
for (const name of files) {
  const file = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as ChapterFile;
  const r = flattenChapters(file, textbookOf(file.科目));
  all += r.points; allMissing += r.missing.length;
  console.log(`${name}: ${r.rows.length} 个节点（叶子 ${r.leaves}），要点 ${r.points}（整句 ${r.levels.exact} / 分段 ${r.levels.segments} / 词组 ${r.levels.clauses} / 例外 ${r.levels.exception}），核不上 ${r.missing.length}`);
  for (const m of r.missing) console.log(`    ✗ ${m.chapter}\n      ${m.point.出处.slice(0, 80)}`);
  rows.push(...r.rows);
}
console.log(`合计：要点 ${all}，核不上 ${allMissing}`);
if (!dryRun && rows.length) {
  const n = upsertChapters(openDb(), rows);
  console.log(`已写入 ${n} 个章节节点`);
}
