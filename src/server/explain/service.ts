/**
 * 作答后讲解（硬约束 2）：只对今天作答过的题开放；每日上限 explain_daily_limit（默认 5）；
 * 异步：先记一条 queued，后台跑 codex（medium，2 分钟 deadline），结果写回；孩子端只看状态与文本，不报错。
 */
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import * as repo from "../db/repo.ts";
import { dayBounds } from "../scheduler/day.ts";
import { runCodex, type EngineResult } from "../inbox/engine.ts";
import type { Item } from "../../shared/types.ts";

export const SCHEMA_PATH = join(import.meta.dirname, "schema.json");
export const EXPLAIN_DEADLINE_MS = 2 * 60_000;
export const DEFAULT_DAILY_LIMIT = 5;

export interface ExplanationJson { explanation: string; key_step: string; common_mistake: string }
export type Explainer = (item: Item, knew: boolean) => Promise<EngineResult<ExplanationJson>>;

export interface ExplanationRow { id: number; item_id: string; session_id: number | null; date: string; status: string; text: string | null; thread_id: string | null; error: string | null; requested_at: string }

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

export function prompt(item: Item, knew: boolean): string {
  const back = item.answerPoints?.length ? item.answerPoints.join("；") : item.back;
  return [
    "你是一位耐心的初中老师。学生刚刚作答了下面这道题，现在请你像面对面讲课一样把完整过程讲透。",
    `科目：${item.subject}。题目：${item.front}`,
    `标准答案：${back}`,
    item.sourceQuote ? `教材原句（出处 ${item.sourceRef}）：${item.sourceQuote}` : "",
    `学生自评：${knew ? "会" : "不会"}。`,
    "要求：explanation 用中文、分步、面向 12 岁学生，300 字以内，不要引入超出七年级的知识；key_step 一句话说最关键的一步；common_mistake 一句话说常见错因。不要建议任何课外辅导或培训。",
    "只输出 JSON。",
  ].filter(Boolean).join("\n");
}

export const codexExplainer: Explainer = (item, knew) =>
  runCodex<ExplanationJson>({ schemaPath: SCHEMA_PATH, prompt: prompt(item, knew), effort: "medium", deadlineMs: EXPLAIN_DEADLINE_MS });

/** 申请讲解：门控通过则记 queued 并异步执行；已有今天的记录直接返回。 */
export function request(db: DatabaseSync, now: Date, itemId: string, explainer: Explainer): { ok: boolean; reason?: string; id?: number; remaining: number } {
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
  void run(db, id, item, knew, explainer);
  return { ok: true, id, remaining: Math.max(0, g.remaining - 1) };
}

async function run(db: DatabaseSync, id: number, item: Item, knew: boolean, explainer: Explainer): Promise<void> {
  db.prepare("UPDATE explanation SET status = 'running' WHERE id = ?").run(id);
  try {
    const r = await explainer(item, knew);
    if (r.ok && r.json) {
      const text = [r.json.explanation.trim(), r.json.key_step ? `关键一步：${r.json.key_step.trim()}` : "", r.json.common_mistake ? `常见错因：${r.json.common_mistake.trim()}` : ""].filter(Boolean).join("\n\n");
      db.prepare("UPDATE explanation SET status = 'done', text = ?, thread_id = ? WHERE id = ?").run(text, r.threadId ?? null, id);
    } else {
      db.prepare("UPDATE explanation SET status = 'failed', error = ?, thread_id = ? WHERE id = ?").run(r.error ?? "未知错误", r.threadId ?? null, id);
    }
  } catch (e) {
    db.prepare("UPDATE explanation SET status = 'failed', error = ? WHERE id = ?").run(String(e), id);
  }
}
