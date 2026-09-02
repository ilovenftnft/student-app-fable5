/**
 * 今日队列（验收 #3）：到期卡按 due 先后排，估算耗时累计到 10 分钟为止，其余顺延；
 * 剩余预算才引入新卡（按 intro_day ≤ 今天的天序），情境卡要等接句卡成熟。
 */
import { State } from "ts-fsrs";
import type { Item, Subject } from "../../shared/types.ts";
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
  /** 开场页选的"先做哪科"：这一科的卡排到最前，科内顺序不变（方向 F） */
  subjectFirst?: Subject | null;
  /** 开场页选的"再多 5 张"：预算用完后再从顺延/新卡里补这么多张（仍受 60 分钟硬停约束） */
  extraCards?: number;
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
  const spent = q.spentSeconds ?? 0;
  const budget = (q.budgetSeconds ?? DAILY_BUDGET_SECONDS) - spent;
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
    // 今天一秒还没花时，哪怕第一张就超预算也派一张（否则永远做不到）；中途预算用完就全部顺延
    const firstOfDay = picked.length === 0 && spent === 0;
    if (!firstOfDay && est + e.estSeconds > budget) { deferred++; continue; }
    picked.push(e); est += e.estSeconds;
  }

  let newWaiting = 0;
  const freshEntries: QueueEntry[] = [];
  const freshWaiting: QueueEntry[] = [];
  const fresh = q.items.filter((i) => eligibleNew(i, q.states, q.dayIndex)).sort((a, b) => a.introDay - b.introDay);
  for (const item of fresh) {
    const sec = secondsFor(item) * 1.5;
    if (est + sec > budget) { newWaiting++; freshWaiting.push({ item, isNew: true, estSeconds: sec }); continue; }
    freshEntries.push({ item, isNew: true, estSeconds: sec }); est += sec;
  }
  // "再多 N 张"：预算之外再补 N 张，先补顺延的到期卡，再补等待的新卡
  let extra = Math.max(0, q.extraCards ?? 0);
  const pickedIds = new Set(picked.map((e) => e.item.id));
  for (const e of due) {
    if (extra === 0) break;
    if (pickedIds.has(e.item.id)) continue;
    picked.push(e); est += e.estSeconds; deferred--; extra--;
  }
  for (const e of freshWaiting) {
    if (extra === 0) break;
    freshEntries.push(e); est += e.estSeconds; newWaiting--; extra--;
  }
  // 顺序：到期卡 → 新卡。FSRS 无同日学习步骤（policy.FSRS_PARAMS），到期按天，不会有"今天稍后才到期"的卡
  let entries = [...picked, ...freshEntries];
  // 先做哪科：稳定分区，科内顺序不变
  if (q.subjectFirst) entries = [...entries.filter((e) => e.item.subject === q.subjectFirst), ...entries.filter((e) => e.item.subject !== q.subjectFirst)];
  return { entries, deferred, newWaiting, estSeconds: est };
}

/** 开场页用：整个队列按科目汇总（张数、估算秒数、错题张数）。 */
export function bySubject(queue: Queue): { subject: Subject; count: number; estSeconds: number; wrong: number }[] {
  const m = new Map<Subject, { subject: Subject; count: number; estSeconds: number; wrong: number }>();
  for (const e of queue.entries) {
    const s = m.get(e.item.subject) ?? { subject: e.item.subject, count: 0, estSeconds: 0, wrong: 0 };
    s.count++; s.estSeconds += e.estSeconds; if (e.item.kind === "wrong") s.wrong++;
    m.set(e.item.subject, s);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
