/**
 * 内容入库：读 content/pools/*.json → 解析 → 逐条核对出处 → 写 item 表。
 *   npm run load            全部入库（核不上的跳过并列出）
 *   npm run verify          只核对不写库（= --dry-run）
 *   npm run load -- 生物-七上第一单元 地理-七上第三章
 *   --vocab 本册新词|小学段|all（默认 all）  --no-listen
 */
import { applyFilter, collect, filterFromArgs, positional, printReport } from "./pipeline.ts";
import { openDb } from "../db/open.ts";
import { upsertItems } from "./store.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const names = positional(args);

const { files, accepted } = collect(names.length ? names : undefined);
printReport(files);
const filter = filterFromArgs(args);
const selected = applyFilter(accepted, filter);
console.log(`装载范围：词汇=${filter.vocab}，听写=${filter.listen ? "开" : "关"} → ${selected.length} 条`);
if (!dryRun) {
  const db = openDb();
  const n = upsertItems(db, selected);
  console.log(`已写入 ${n} 条 → ${process.env.DATA_DIR ?? "./data"}/app.db`);
}
