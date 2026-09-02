/**
 * 给 content/pools/英语-音标与拼读.json 里没有音块的词补自然拼读拆分（家长 2026-09-02 定）。
 *   node scripts/fill-phonics.ts            补全部缺口
 *   node scripts/fill-phonics.ts --limit 40 只跑一批（试）
 * 用本机 codex exec（medium 档、--output-schema scripts/phonics-schema.json），每批 40 词，硬 deadline 5 分钟。
 * 程序核对（核不上的不写，列在末尾）：音块拼回去逐字等于原词；规律在 拼读规律表 里；规律 key 的字母组合（"-"前的部分）真的出现在词里（CVC、magic-e 除外）。
 * 写入：音块、拼读规律、拼读规律说法、拆分来源 = "codex"。规律可以为空（缩写、字母词、专有名词）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCodex } from "../src/server/inbox/engine.ts";

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "content/pools/英语-音标与拼读.json");
const SCHEMA = join(ROOT, "scripts/phonics-schema.json");
const BATCH = 40;

interface Entry { 词: string; 音标: string; 音块?: string[]; 拼读规律?: string; 拼读规律说法?: string; 拆分来源?: string; [k: string]: unknown }
interface Data { 拼读规律表: Record<string, string>; 词表: Entry[]; [k: string]: unknown }
interface Out { items: { word: string; chunks: string[]; rule: string | null }[] }

const data = JSON.parse(readFileSync(FILE, "utf8")) as Data;
const names = data.拼读规律表;
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const todo = data.词表.filter((w) => !w.音块).slice(0, limit);
console.log(`缺拆分 ${data.词表.filter((w) => !w.音块).length} 词，这次跑 ${todo.length}`);

const examples = data.词表.filter((w) => w.音块 && w.拆分来源 === "card").slice(0, 40)
  .map((w) => `${w.词} /${w.音标}/ → ${JSON.stringify(w.音块)} 规律 ${w.拼读规律 ?? "null"}`).join("\n");
const catalog = Object.entries(names).map(([k, v]) => `${k}：${v}`).join("\n");

function check(e: Entry, r: Out["items"][number]): string | null {
  if (r.chunks.join("") !== e.词) return `音块拼不回原词：${JSON.stringify(r.chunks)}`;
  if (r.chunks.some((c) => !c)) return "有空音块";
  if (r.rule === null) return null;
  if (!names[r.rule]) return `规律不在表里：${r.rule}`;
  const base = r.rule.split("-")[0]!.toLowerCase();
  if (!["cvc", "magic"].includes(base) && !e.词.toLowerCase().includes(base)) return `规律 ${r.rule} 的字母组合 ${base} 不在词里`;
  return null;
}

const rejected: string[] = [];
let written = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const list = batch.map((w) => `${w.词} /${w.音标}/`).join("\n");
  const prompt = `你是英语自然拼读（phonics）老师，给中国初一学生的单词卡做拆分。
对下面每个词给出：chunks = 自然拼读音块（按发音单位把字母分块，如 fear→["f","ear"]、across→["a","cross"]、treachery→["treach","er","y"]），按顺序拼接必须逐字等于原词（保留大小写、连字符、撇号，不加不减任何字符）；rule = 最能代表这个词读法的一条规律的 key，只能从下面的规律表里选，没有合适的（缩写、字母词、专有名词、不规则词）填 null。宁可 null 也不要硬套。

规律表（key：说明）：
${catalog}

已有的拆分示例（照这个风格）：
${examples}

要拆的词（词 /音标/）：
${list}

输出 JSON：{"items":[{"word","chunks","rule"}]}，items 顺序与输入一致，word 逐字照抄。`;
  process.stdout.write(`批 ${i / BATCH + 1}/${Math.ceil(todo.length / BATCH)}（${batch.length} 词）… `);
  const r = await runCodex<Out>({ schemaPath: SCHEMA, prompt, effort: "medium", deadlineMs: 5 * 60_000, cwd: ROOT });
  if (!r.ok || !r.json) { console.log(`失败：${r.error}`); rejected.push(...batch.map((w) => `${w.词}：这批调用失败`)); continue; }
  const byWord = new Map(r.json.items.map((x) => [x.word, { ...x, rule: !x.rule || x.rule === "null" ? null : x.rule }])); // 模型偶尔把 null 写成字符串
  let ok = 0;
  for (const e of batch) {
    const x = byWord.get(e.词);
    if (!x) { rejected.push(`${e.词}：没返回`); continue; }
    const why = check(e, x);
    if (why) { rejected.push(`${e.词}：${why}`); continue; }
    e.音块 = x.chunks;
    if (x.rule) { e.拼读规律 = x.rule; e.拼读规律说法 = names[x.rule]; } else { delete e.拼读规律; delete e.拼读规律说法; }
    e.拆分来源 = "codex";
    ok++; written++;
  }
  console.log(`写入 ${ok}/${batch.length}，用时 ${Math.round(r.elapsedMs / 1000)} 秒`);
  writeFileSync(FILE, JSON.stringify(data, null, 1) + "\n"); // 每批落盘，中途断了不丢
}
console.log(`\n共写入 ${written}，核不上或失败 ${rejected.length}：`);
for (const x of rejected) console.log("  " + x);
