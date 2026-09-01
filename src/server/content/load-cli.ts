/**
 * 内容入库：读 content/pools/*.json → 解析 → 逐条核对出处 → 写 item 表。
 *   npm run load            全部入库（核不上的跳过并列出）
 *   npm run verify          只核对不写库（= --dry-run）
 *   npm run load -- 生物-七上第一单元 地理-七上第三章
 */
import { parsePool } from "./pools.ts";
import { readPools, textbookOf } from "./textbooks.ts";
import { verifyItem } from "./verify.ts";
import { openDb } from "../db/open.ts";
import { upsertItems } from "./store.ts";
import type { Item } from "../../shared/types.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const names = args.filter((a) => !a.startsWith("--"));

let totalOk = 0, totalEx = 0, totalMissing = 0;
const accepted: Item[] = [];

for (const file of readPools(names.length ? names : undefined)) {
  const items = parsePool(file);
  if (items.length === 0) continue;
  const exceptions = (file.json.出处例外 ?? {}) as Record<string, string>;
  const text = textbookOf(items[0]!.subject);
  let ok = 0, ex = 0;
  const missing: Item[] = [];
  for (const it of items) {
    const r = verifyItem(it, text, exceptions);
    if (r.status === "missing") missing.push(it);
    else {
      accepted.push(it);
      if (r.status === "ok") ok++; else ex++;
    }
  }
  totalOk += ok; totalEx += ex; totalMissing += missing.length;
  console.log(`${file.name}: ${items.length} 条，核对通过 ${ok}，按例外放行 ${ex}，核不上 ${missing.length}`);
  for (const m of missing) console.log(`    ✗ ${m.id}\n      ${m.sourceQuote.slice(0, 80)}`);
}

console.log(`\n合计：通过 ${totalOk}，例外 ${totalEx}，核不上（不入库）${totalMissing}`);
if (!dryRun) {
  const db = openDb();
  const n = upsertItems(db, accepted);
  console.log(`已写入 ${n} 条 → ${process.env.DATA_DIR ?? "./data"}/app.db`);
}
