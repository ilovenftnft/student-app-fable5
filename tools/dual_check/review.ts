/**
 * 双模型审阅（AGENTS.md）：Codex 只读审阅当前 diff，输出首行 ALLOW:/BLOCK: + 理由。未知格式按 BLOCK。
 *   npm run review              审阅工作区相对 HEAD 的改动（含未跟踪文件）
 *   npm run review -- HEAD~3    审阅相对某提交的改动
 * 最多 3 轮由人来跑；这里只做一轮。退出码：ALLOW 0，BLOCK 1，失败 2。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex } from "../../src/server/inbox/engine.ts";

const base = process.argv[2] ?? "HEAD";
const diff = execFileSync("git", ["diff", base, "--", ".", ":(exclude)package-lock.json", ":(exclude)docs", ":(exclude)textbook", ":(exclude)content", ":(exclude)tests/golden"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
let extra = "";
for (const f of untracked) { try { extra += `\n\n=== 新文件 ${f} ===\n${readFileSync(f, "utf8").slice(0, 20000)}`; } catch { /* 二进制 */ } }
if (!diff.trim() && !extra.trim()) { console.log("ALLOW: 没有改动"); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), "review-"));
const diffPath = join(dir, "diff.patch");
writeFileSync(diffPath, diff + extra);
const schemaPath = join(dir, "schema.json");
writeFileSync(schemaPath, JSON.stringify({
  type: "object", additionalProperties: false, required: ["verdict", "summary", "findings"],
  properties: {
    verdict: { type: "string", enum: ["ALLOW", "BLOCK"] },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["severity", "file", "issue", "why"], properties: {
      severity: { type: "string", enum: ["high", "medium", "low"] }, file: { type: "string" }, issue: { type: "string" }, why: { type: "string" } } } },
  },
}));

const prompt = [
  "你是代码审阅者。产出者是另一个 AI（Claude），不要因此默认它正确，也不要因此默认它错。",
  `只读审阅 ${diffPath} 里的改动（unified diff + 新文件全文）。项目约定在 AGENTS.md（先读它）。`,
  "审阅维度：1) 违反 AGENTS.md 硬约束（每日路径不依赖 LLM/照片、孩子端无开放式 AI、只用订阅号、不做游戏化、家长端只给聚合、60 分钟硬停、每条内容有出处、不显示正确率、不推荐补习班）；",
  "2) 明显 bug 与边界；3) 测试是否覆盖了改动的行为；4) 与 AGENTS.md 数据格式/接口约定是否一致。",
  "verdict：有 high 级问题给 BLOCK，否则 ALLOW。findings 只写你有把握的问题，每条说明为什么是问题。不要重写代码。",
].join("\n");

const r = await runCodex<{ verdict: string; summary: string; findings: { severity: string; file: string; issue: string; why: string }[] }>({
  schemaPath, prompt, effort: "medium", deadlineMs: 6 * 60_000, cwd: process.cwd(),
});
if (!r.ok || !r.json) { console.log(`BLOCK: 审阅失败（${r.error}）`); process.exit(2); }
const v = r.json.verdict === "ALLOW" ? "ALLOW" : "BLOCK";
console.log(`${v}: ${r.json.summary}`);
for (const f of r.json.findings) console.log(`- [${f.severity}] ${f.file}: ${f.issue}\n    ${f.why}`);
console.log(`(codex ${Math.round(r.elapsedMs / 1000)}s, thread ${r.threadId ?? "?"})`);
process.exit(v === "ALLOW" ? 0 : 1);
