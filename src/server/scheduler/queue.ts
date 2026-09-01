/**
 * 今日队列（验收 #3）：到期卡按 due 先后排，估算耗时累计到 10 分钟为止，其余顺延；
 * 剩余预算才引入新卡（按 intro_day ≤ 今天的天序），情境卡要等接句卡成熟。
 */
import { State } from "ts-fsrs";
import type { Item } from "../../shared/types.ts";
import { FSRS_KINDS } from "../../shared/types.ts";
import type { CardState } from "./fsrs.ts";
import { DAILY_BUDGET_SECONDS, isMature, secondsFor } from "./policy.ts";
import { dayBounds } from "./day.ts";

export interface QueueInput {
  items: Item[];
  states: Map<string, CardState>;
  now: Date;
  /** 今天相对内容启用日的天序（intro_day 与之比较） */
  dayIndex: number;
  budgetSeconds?: number;
  /** 今天已经花掉的秒数（会话中途重算队列时传入） */
  spentSeconds?: number;
}

export interface QueueEntry { item: Item; isNew: boolean; estSeconds: number }

export interface Queue {
  entries: QueueEntry[];
  /** 到期但被顺延的张数 */
  deferred: number;
  /** 引入日已到但没轮到的新卡张数 */
  newWaiting: number;
  estSeconds: number;
}

export function eligibleNew(item: Item, states: Map<string, CardState>, dayIndex: number): boolean {
  if (!FSRS_KINDS.has(item.kind)) return false;
  if (states.has(item.id)) return false;
  if (item.introDay > dayIndex) return false;
  if (item.subtype === "context" && item.parentId) {
    const parent = states.get(item.parentId);
    if (!parent || !isMature(parent.card)) return false;
  }
  return true;
}

export function buildQueue(q: QueueInput): Queue {
  const budget = (q.budgetSeconds ?? DAILY_BUDGET_SECONDS) - (q.spentSeconds ?? 0);
  const { end } = dayBounds(q.now);
  const byId = new Map(q.items.map((i) => [i.id, i]));

  const due: QueueEntry[] = [];
  for (const s of q.states.values()) {
    if (s.archived || s.card.state === State.New) continue;
    if (s.card.due.getTime() > end.getTime()) continue;
    const item = byId.get(s.itemId);
    if (!item) continue;
    due.push({ item, isNew: false, estSeconds: secondsFor(item) });
  }
  due.sort((a, b) => q.states.get(a.item.id)!.card.due.getTime() - q.states.get(b.item.id)!.card.due.getTime());

  const picked: QueueEntry[] = [];
  let est = 0, deferred = 0;
  for (const e of due) {
    if (picked.length > 0 && est + e.estSeconds > budget) { deferred++; continue; }
    picked.push(e); est += e.estSeconds;
  }

  let newWaiting = 0;
  const freshEntries: QueueEntry[] = [];
  const fresh = q.items.filter((i) => eligibleNew(i, q.states, q.dayIndex)).sort((a, b) => a.introDay - b.introDay);
  for (const item of fresh) {
    const sec = secondsFor(item) * 1.5;
    if (est + sec > budget) { newWaiting++; continue; }
    freshEntries.push({ item, isNew: true, estSeconds: sec }); est += sec;
  }
  // 顺序：现在已到期 → 新卡 → 今天稍后才到期（同日学习步骤，刚答过的不立刻再出现）
  const nowMs = q.now.getTime();
  const dueNow = picked.filter((e) => q.states.get(e.item.id)!.card.due.getTime() <= nowMs);
  const dueLater = picked.filter((e) => q.states.get(e.item.id)!.card.due.getTime() > nowMs);
  return { entries: [...dueNow, ...freshEntries, ...dueLater], deferred, newWaiting, estSeconds: est };
}
