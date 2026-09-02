/**
 * 作答后讲解（硬约束 2）：只对今天作答过的题开放；每日上限 explain_daily_limit（默认 5）；
 * 异步：先记一条 queued，后台跑三段流水线，结果写回；孩子端只看状态与文本，不报错。
 *
 * 三段流水线（家长 2026-09-02 定：正确优先，Pro 订阅不考虑额度）：
 *   1. 生成（codex medium）→ 2. 程序核对（禁词、结论须含标准答案）→ 3. Codex 复核（high，独立一次调用，只判对错）
 *   任一段不过就带着问题说明重新生成，最多 MAX_ROUNDS 轮；仍不过标 failed，孩子看到"稍后再看"，不计入每日上限。
 *   教材原句由程序附在讲解末尾（从库里取），不让模型转述。
 */
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import * as repo from "../db/repo.ts";
import { dayBounds } from "../scheduler/day.ts";
import { runCodex, type EngineResult } from "../inbox/engine.ts";
import type { Item } from "../../shared/types.ts";

export const SCHEMA_PATH = join(import.meta.dirname, "schema.json");
export const VERIFY_SCHEMA_PATH = join(import.meta.dirname, "verify-schema.json");
export const EXPLAIN_DEADLINE_MS = 2 * 60_000;
export const DEFAULT_DAILY_LIMIT = 5;
export const MAX_ROUNDS = 2;

export interface ExplanationJson { explanation: string; key_step: string; common_mistake: string }
export interface VerifyJson { consistent: boolean; within_grade: boolean; quotes_ok: boolean; no_tutoring: boolean; problems: string }
/** note：上一轮的问题说明，重新生成时带上 */
export type Explainer = (item: Item, knew: boolean, note?: string) => Promise<EngineResult<ExplanationJson>>;
export type Verifier = (item: Item, json: ExplanationJson) => Promise<EngineResult<VerifyJson>>;

export interface ExplanationRow { id: number; item_id: string; session_id: number | null; date: string; status: string; text: string | null; thread_id: string | null; error: string | null; retry_at: string | null; requested_at: string }

export function dailyLimit(db: DatabaseSync): number {
  return Number(repo.getSetting(db, "explain_daily_limit", String(DEFAULT_DAILY_LIMIT))) || DEFAULT_DAILY_LIMIT;
}
export function usedToday(db: DatabaseSync, date: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM explanation WHERE date = ? AND status != 'failed'").get(date) as { n: number }).n;
}
export function answeredToday(db: DatabaseSync, itemId: string, sessionId: number): { knew: boolean } | null {
  const r = db.prepare("SELECT knew FROM review WHERE item_id = ? AND session_id = ? ORDER BY id DESC LIMIT 1").get(itemId, sessionId) as { knew: number } | undefined;
  return r ? { knew: r.knew === 1 } : null;
}
export function explanation(db: DatabaseSync, id: number): ExplanationRow | undefined {
  return db.prepare("SELECT * FROM explanation WHERE id = ?").get(id) as ExplanationRow | undefined;
}
export function explanationFor(db: DatabaseSync, itemId: string, date: string): ExplanationRow | undefined {
  return db.prepare("SELECT * FROM explanation WHERE item_id = ? AND date = ? ORDER BY id DESC LIMIT 1").get(itemId, date) as ExplanationRow | undefined;
}

/** 门控状态（孩子端按钮据此显示）。 */
export function gate(db: DatabaseSync, now: Date, itemId: string): { allowed: boolean; reason?: "not_answered" | "limit"; remaining: number; existing?: ExplanationRow } {
  const { date } = dayBounds(now);
  const remaining = Math.max(0, dailyLimit(db) - usedToday(db, date));
  const existing = explanationFor(db, itemId, date);
  if (existing) return { allowed: true, remaining, existing };
  const s = repo.sessionOn(db, date);
  if (!s || !answeredToday(db, itemId, s.id)) return { allowed: false, reason: "not_answered", remaining };
  if (remaining <= 0) return { allowed: false, reason: "limit", remaining };
  return { allowed: true, remaining };
}

export function prompt(item: Item, knew: boolean, note?: string): string {
  const back = item.answerPoints?.length ? item.answerPoints.join("；") : item.back;
  return [
    "你是一位耐心的初中老师。学生刚刚作答了下面这道题，现在请你像面对面讲课一样把完整过程讲透。",
    `科目：${item.subject}。题目：${item.front}`,
    `标准答案：${back}`,
    item.sourceQuote ? `教材原句（出处 ${item.sourceRef}）：${item.sourceQuote}` : "",
    `学生自评：${knew ? "会" : "不会"}。`,
    "要求：explanation 用中文、分步、面向 12 岁学生，300 字以内，不要引入超出七年级的知识；key_step 一句话说最关键的一步；common_mistake 一句话说常见错因。不要建议任何课外辅导或培训。",
    "结论必须与标准答案一致，不要另给答案；提到答案时写标准答案的原文。引用教材只能逐字引用上面给你的原句，不要改写后当作引用。",
    note ? `上一版讲解有问题，这次必须改正：${note}` : "",
    "只输出 JSON。",
  ].filter(Boolean).join("\n");
}

export function verifyPrompt(item: Item, json: ExplanationJson): string {
  const back = item.answerPoints?.length ? item.answerPoints.join("；") : item.back;
  return [
    "你是审稿人。下面是一道初一题目、它的标准答案、教材原句，以及另一位老师写给 12 岁学生的讲解。请逐项判断讲解是否合格，只输出 JSON。",
    `科目：${item.subject}。题目：${item.front}`,
    `标准答案：${back}`,
    item.sourceQuote ? `教材原句（出处 ${item.sourceRef}）：${item.sourceQuote}` : "教材原句：无",
    `讲解：${json.explanation}`,
    `关键一步：${json.key_step}`,
    `常见错因：${json.common_mistake}`,
    "判断：consistent = 讲解的结论与标准答案一致，没有另给答案、没有与标准答案矛盾的说法；within_grade = 没有超出七年级的知识；quotes_ok = 讲解里凡是说成「教材说、课本上写、原句是」的引文，都是给定教材原句的逐字片段；引用题干、标准答案或学生自己的话不算引用教材（没有这类引文则为 true）；no_tutoring = 没有建议课外辅导、培训、报班。problems = 有不合格项时一句话说明，否则空字符串。",
  ].join("\n");
}

export const codexExplainer: Explainer = (item, knew, note) =>
  runCodex<ExplanationJson>({ schemaPath: SCHEMA_PATH, prompt: prompt(item, knew, note), effort: "medium", deadlineMs: EXPLAIN_DEADLINE_MS });
export const VERIFY_DEADLINE_MS = 4 * 60_000; // high 档更慢，给 4 分钟
export const codexVerifier: Verifier = (item, json) =>
  runCodex<VerifyJson>({ schemaPath: VERIFY_SCHEMA_PATH, prompt: verifyPrompt(item, json), effort: "high", deadlineMs: VERIFY_DEADLINE_MS });

/** 端到端测试用：不调用 Codex。 */
export const fakeExplainer: Explainer = async () => ({ ok: true, elapsedMs: 0, json: { explanation: "（测试讲解）先看题目问什么，再回到教材原句。", key_step: "对照原句", common_mistake: "看错题目要求" } });
export const passVerifier: Verifier = async () => ({ ok: true, elapsedMs: 0, json: { consistent: true, within_grade: true, quotes_ok: true, no_tutoring: true, problems: "" } });

const BANNED = /报班|补习班|培训班|辅导班|课外辅导|课外培训|一对一/;
const norm = (s: string) => s.replace(/[\s，,。.、；;：:！!？?（）()「」『』“”"'《》〈〉\-–—]/g, "").toLowerCase();

/** 程序核对（免费、确定性）：禁词；提到"答案是/为"时必须包含标准答案原文（要点式答案不查这条）。返回问题说明，合格返回 null。 */
export function checkDeterministic(item: Item, json: ExplanationJson): string | null {
  const all = [json.explanation, json.key_step, json.common_mistake].join("\n");
  if (BANNED.test(all)) return "出现了课外辅导、培训、报班之类的建议，讲解里不能有这类内容";
  if (!item.answerPoints?.length && /答案(是|为|应该是|应为|：|:)/.test(all)) {
    if (!norm(all).includes(norm(item.back))) return `讲解里给出的答案与标准答案"${item.back}"不一致`;
  }
  return null;
}

/** 复核结论 → 问题说明；合格返回 null。 */
export function verdictProblem(v: VerifyJson): string | null {
  const bad: string[] = [];
  if (!v.consistent) bad.push("结论与标准答案不一致");
  if (!v.within_grade) bad.push("用了超出七年级的知识");
  if (!v.quotes_ok) bad.push("引用了不是教材原句的内容");
  if (!v.no_tutoring) bad.push("建议了课外辅导");
  if (!bad.length) return null;
  return bad.join("；") + (v.problems ? `（${v.problems}）` : "");
}

/** 拼最终文本：讲解 + 关键一步 + 常见错因 + 教材原句（程序附，从库里取；错题卡的出处是作业照片，不附）。 */
export function assemble(item: Item, json: ExplanationJson): string {
  return [
    json.explanation.trim(),
    json.key_step ? `关键一步：${json.key_step.trim()}` : "",
    json.common_mistake ? `常见错因：${json.common_mistake.trim()}` : "",
    item.sourceQuote && item.kind !== "wrong" ? `教材原句：${item.sourceQuote.trim()}（${item.sourceRef}）` : "",
  ].filter(Boolean).join("\n\n");
}

/** 申请讲解：门控通过则记 queued 并异步执行；已有今天的记录直接返回。 */
export function request(db: DatabaseSync, now: Date, itemId: string, explainer: Explainer, verifier: Verifier): { ok: boolean; reason?: string; id?: number; remaining: number } {
  const g = gate(db, now, itemId);
  if (g.existing) return { ok: true, id: g.existing.id, remaining: g.remaining };
  if (!g.allowed) return { ok: false, reason: g.reason, remaining: g.remaining };
  const item = repo.items(db).find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: "not_found", remaining: g.remaining };
  const { date } = dayBounds(now);
  const s = repo.sessionOn(db, date)!;
  const knew = answeredToday(db, itemId, s.id)!.knew;
  const r = db.prepare("INSERT INTO explanation (item_id, session_id, date, status) VALUES (?, ?, ?, 'queued')").run(itemId, s.id, date);
  const id = Number(r.lastInsertRowid);
  void run(db, id, item, knew, explainer, verifier);
  return { ok: true, id, remaining: Math.max(0, g.remaining - 1) };
}

type Outcome = { kind: "done"; text: string; threadId?: string } | { kind: "quota"; error: string; resetAt: Date; threadId?: string } | { kind: "failed"; error: string; threadId?: string };

/** 三段流水线，纯逻辑（不碰库），测试直接调它。 */
export async function pipeline(item: Item, knew: boolean, explainer: Explainer, verifier: Verifier, log: (s: string) => void = () => {}): Promise<Outcome> {
  let note: string | undefined;
  let threadId: string | undefined;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const g = await explainer(item, knew, note);
    threadId = g.threadId ?? threadId;
    if (!g.ok || !g.json) {
      if (g.quotaResetAt) return { kind: "quota", error: g.error ?? "额度用尽", resetAt: g.quotaResetAt, threadId };
      return { kind: "failed", error: `生成失败：${g.error ?? "未知错误"}`, threadId };
    }
    const det = checkDeterministic(item, g.json);
    if (det) { log(`第 ${round} 轮程序核对不过：${det}`); note = det; continue; }
    const v = await verifier(item, g.json);
    if (!v.ok || !v.json) {
      if (v.quotaResetAt) return { kind: "quota", error: v.error ?? "额度用尽", resetAt: v.quotaResetAt, threadId };
      log(`第 ${round} 轮复核调用失败：${v.error ?? "未知错误"}`); note = undefined; continue; // 复核本身失败：不采信这一版，再来一轮
    }
    const bad = verdictProblem(v.json);
    if (bad) { log(`第 ${round} 轮复核不过：${bad}`); note = bad; continue; }
    return { kind: "done", text: assemble(item, g.json), threadId };
  }
  return { kind: "failed", error: `${MAX_ROUNDS} 轮都没通过核对${note ? `：${note}` : ""}`, threadId };
}

async function run(db: DatabaseSync, id: number, item: Item, knew: boolean, explainer: Explainer, verifier: Verifier): Promise<void> {
  db.prepare("UPDATE explanation SET status = 'running' WHERE id = ?").run(id);
  try {
    const r = await pipeline(item, knew, explainer, verifier, (s) => console.log(`[explain ${id}] ${s}`));
    if (r.kind === "done") db.prepare("UPDATE explanation SET status = 'done', text = ?, thread_id = ?, error = NULL WHERE id = ?").run(r.text, r.threadId ?? null, id);
    else if (r.kind === "quota") db.prepare("UPDATE explanation SET status = 'queued', error = ?, retry_at = ?, thread_id = ? WHERE id = ?").run(r.error, r.resetAt.toISOString(), r.threadId ?? null, id); // 额度触顶：留在队列，重置时间后由 retryDue 自动重试
    else db.prepare("UPDATE explanation SET status = 'failed', error = ?, thread_id = ? WHERE id = ?").run(r.error, r.threadId ?? null, id);
  } catch (e) {
    db.prepare("UPDATE explanation SET status = 'failed', error = ? WHERE id = ?").run(String(e), id);
  }
}

/** 后台：把到了重试时间的讲解重新跑一遍。index.ts 每分钟调一次。 */
export async function retryDue(db: DatabaseSync, now: Date, explainer: Explainer, verifier: Verifier): Promise<number> {
  const rows = db.prepare("SELECT * FROM explanation WHERE status = 'queued' AND retry_at IS NOT NULL AND retry_at <= ?").all(now.toISOString()) as unknown as ExplanationRow[];
  let n = 0;
  for (const e of rows) {
    const item = repo.items(db).find((i) => i.id === e.item_id);
    if (!item) { db.prepare("UPDATE explanation SET status = 'failed', error = '内容不存在' WHERE id = ?").run(e.id); continue; }
    const knew = e.session_id ? (answeredToday(db, e.item_id, e.session_id)?.knew ?? false) : false;
    db.prepare("UPDATE explanation SET retry_at = NULL WHERE id = ?").run(e.id);
    await run(db, e.id, item, knew, explainer, verifier);
    n++;
  }
  return n;
}
