/**
 * 负荷模拟：npm run sim [-- 池文件名…] [--days 150] [--seed 1] [--vocab 本册新词|小学段|all] [--no-listen]
 * 只算核对通过、且在装载范围内的条目（和 npm run load 装进去的一致）。
 */
import { applyFilter, collect, filterFromArgs, positional, printReport } from "./pipeline.ts";
import { DEFAULT_SIM, simulate } from "./sim.ts";

const args = process.argv.slice(2);
const opt = (k: string, dflt: number) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : dflt; };
const names = positional(args);

const { files, accepted } = collect(names.length ? names : undefined);
printReport(files, false);
const filter = filterFromArgs(args);
const selected = applyFilter(accepted, filter);
console.log(`装载范围：词汇=${filter.vocab}，听写=${filter.listen ? "开" : "关"}`);

const r = simulate(selected, { days: opt("--days", DEFAULT_SIM.days), seed: opt("--seed", DEFAULT_SIM.seed) });
const fmt = (n: number) => n.toFixed(1).padStart(5);
console.log(`\n参与 FSRS 的条目：${r.totalItems}（${Object.entries(r.byKind).map(([k, v]) => `${k} ${v}`).join("，")}），${r.days.length} 天内引入 ${r.introduced}`);
console.log(`每日复习分钟：中位 ${fmt(r.medianMinutes)}  p90 ${fmt(r.p90Minutes)}  最大 ${fmt(r.maxMinutes)}  超 20 分钟 ${r.over20Days} 天（${(r.over20Ratio * 100).toFixed(0)}%）`);
console.log("按 30 天分段（中位 / p90）：");
for (let s = 0; s < r.days.length; s += 30) {
  const seg = r.days.slice(s, s + 30).map((d) => d.minutes).sort((a, b) => a - b);
  const q = (p: number) => seg[Math.min(seg.length - 1, Math.floor(p * seg.length))] ?? 0;
  console.log(`  第 ${String(s + 1).padStart(3)}–${String(Math.min(s + 30, r.days.length)).padEnd(3)} 天  ${fmt(q(0.5))} / ${fmt(q(0.9))}`);
}
console.log(`\n${r.pass ? "通过" : "不通过"}（标准：中位 ≤ ${DEFAULT_SIM.medianMax}，超 20 分钟天数 ≤ ${DEFAULT_SIM.over20RatioMax * 100}%）`);
process.exitCode = r.pass ? 0 : 1;
