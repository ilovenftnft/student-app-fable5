/** 内容池 → 解析 → 核对，入库脚本与负荷模拟共用；只有核对通过（或按例外放行）的条目往下走。 */
import { parsePool } from "./pools.ts";
import { readPools, textbookOf } from "./textbooks.ts";
import { verifyItem, type VerifyLevel } from "./verify.ts";
import type { Item } from "../../shared/types.ts";

export interface FileReport {
  name: string;
  total: number;
  levels: Record<VerifyLevel, number>;
  exceptions: number;
  missing: Item[];
  accepted: Item[];
}

export function collect(names?: string[]): { files: FileReport[]; accepted: Item[] } {
  const files: FileReport[] = [];
  const accepted: Item[] = [];
  for (const file of readPools(names)) {
    const items = parsePool(file);
    if (items.length === 0) continue;
    const exceptions = (file.json.出处例外 ?? {}) as Record<string, string>;
    const text = textbookOf(items[0]!.subject);
    const r: FileReport = { name: file.name, total: items.length, levels: { exact: 0, segments: 0, clauses: 0 }, exceptions: 0, missing: [], accepted: [] };
    for (const it of items) {
      const v = verifyItem(it, text, exceptions);
      if (v.status === "missing") { r.missing.push(it); continue; }
      if (v.status === "ok") r.levels[v.level!]++; else r.exceptions++;
      r.accepted.push(it);
    }
    accepted.push(...r.accepted);
    files.push(r);
  }
  return { files, accepted };
}

export function printReport(files: FileReport[], verbose = true): void {
  let ok = 0, ex = 0, miss = 0;
  for (const f of files) {
    const n = f.accepted.length - f.exceptions;
    ok += n; ex += f.exceptions; miss += f.missing.length;
    console.log(`${f.name}: ${f.total} 条，核对通过 ${n}（整句 ${f.levels.exact} / 分段 ${f.levels.segments} / 词组 ${f.levels.clauses}），按例外放行 ${f.exceptions}，核不上 ${f.missing.length}`);
    if (verbose) for (const m of f.missing) console.log(`    ✗ ${m.id}\n      ${m.sourceQuote.slice(0, 80)}`);
  }
  console.log(`合计：通过 ${ok}，例外 ${ex}，核不上（不入库）${miss}`);
}

/** 装载范围（硬约束 8"只装一部分"的落点）。默认全装：小学段词已按 365 天铺开（pools.ts VOCAB_SPAN_BY_GROUP）。 */
export interface LoadFilter {
  /** 词汇组：本册新词 | 小学段 | all */
  vocab: string;
  listen: boolean;
}
export const DEFAULT_FILTER: LoadFilter = { vocab: "all", listen: true };

export function applyFilter(items: Item[], f: LoadFilter = DEFAULT_FILTER): Item[] {
  return items.filter((i) => {
    if (i.kind === "listen" && !f.listen) return false;
    if ((i.kind === "vocab" || i.kind === "listen") && f.vocab !== "all" && i.meta.组 !== f.vocab) return false;
    return true;
  });
}

/** 解析 CLI 里的 --vocab / --no-listen。 */
export function filterFromArgs(args: string[]): LoadFilter {
  const i = args.indexOf("--vocab");
  return { vocab: i >= 0 ? args[i + 1]! : DEFAULT_FILTER.vocab, listen: !args.includes("--no-listen") };
}

/** 去掉 --k v 与 --flag 之后剩下的位置参数。 */
export function positional(args: string[], valued: string[] = ["--vocab", "--days", "--seed"]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valued.includes(a)) { i++; continue; }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}
