/**
 * 每日负荷模拟（硬约束 8）：一批内容装进去后，前 N 天每天要花多少分钟复习。
 * 纯函数、种子随机，同一输入同一输出。用真实的 ts-fsrs 调度，不自己近似。
 *
 * 模型：
 *   - 条目按 introDay 引入；情境卡在其接句卡"成熟"（间隔 ≥ archiveIntervalDays）后才引入。
 *   - 每次复习：新卡首次按 pNewGood 判 Good/Again；老卡按 FSRS 可提取率 R 判 Good（概率 R）/Again。
 *     只用 Good/Again 两档，对应孩子只点"会 / 不会"（Hard/Easy 由耗时推断，模拟里不区分）。
 *   - 每次耗时 = 该种类基准秒数 ×（新卡 1.5）×（答错 1.3）。基准秒数是假设值，
 *     上线后用 review.elapsed_ms 的实测中位替换（见 DEFAULT_SIM.secondsPer 注释）。
 *   - 不设每日上限：这里算的是"需求"，运行时的 10 分钟上限是另一回事。
 *     同日学习步骤（1m/10m）落在会话窗口内的算当天，否则顺延到次日。
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from "ts-fsrs";
import type { Item } from "../../shared/types.ts";
import { FSRS_KINDS } from "../../shared/types.ts";

export interface SimConfig {
  days: number;
  seed: number;
  /** 基准秒数，键 `${kind}:${subtype}` 或 `${kind}` */
  secondsPer: Record<string, number>;
  newMultiplier: number;
  againMultiplier: number;
  pNewGood: number;
  requestRetention: number;
  /** 接句卡间隔达到此天数视为成熟，解锁情境卡 */
  archiveIntervalDays: number;
  /** 同一张卡一天最多复习次数（防学习步骤死循环） */
  maxSameDayReviews: number;
  /** 会话窗口（分钟）：到期时间落在窗口内的同日复习算当天 */
  sessionMinutes: number;
  /** 通过标准 */
  medianMax: number;
  over20RatioMax: number;
}

export const DEFAULT_SIM: SimConfig = {
  days: 150,
  seed: 1,
  // 假设值（秒）。依据：默写接句要回忆整句 ~20s；概念填空一个术语 ~15s；答题模板要点多 ~40s；
  // 文言注释短 ~12s；单词认读 ~8s；听写 ~10s；错题重做 ~90s。
  secondsPer: {
    "recitation:fill": 20, "recitation:context": 25,
    "concept:fill": 15, "concept:answer_template": 40, "concept:gloss": 12,
    "vocab:word": 8, "listen:word": 10,
    wrong: 90,
  },
  newMultiplier: 1.5,
  againMultiplier: 1.3,
  pNewGood: 0.5,
  requestRetention: 0.9,
  archiveIntervalDays: 30,
  maxSameDayReviews: 4,
  sessionMinutes: 60,
  medianMax: 12,
  over20RatioMax: 0.1,
};

export interface SimDay { day: number; reviews: number; newCards: number; minutes: number }

export interface SimResult {
  days: SimDay[];
  medianMinutes: number;
  p90Minutes: number;
  maxMinutes: number;
  over20Days: number;
  over20Ratio: number;
  totalItems: number;
  introduced: number;
  byKind: Record<string, number>;
  pass: boolean;
}

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function secondsFor(item: Item, cfg: SimConfig): number {
  return cfg.secondsPer[`${item.kind}:${item.subtype}`] ?? cfg.secondsPer[item.kind] ?? 20;
}

interface Slot { item: Item; card: Card; introduced: boolean; mature: boolean; today: number }

const DAY_MS = 86_400_000;

export function simulate(input: Item[], partial: Partial<SimConfig> = {}): SimResult {
  const cfg = { ...DEFAULT_SIM, ...partial };
  const items = input.filter((i) => FSRS_KINDS.has(i.kind));
  const random = rng(cfg.seed);
  const f = fsrs(generatorParameters({ request_retention: cfg.requestRetention, enable_fuzz: false }));
  const base = Date.UTC(2026, 8, 1, 9, 0, 0); // 每天 17:00（Asia/Shanghai）开始
  const slots = new Map<string, Slot>();
  for (const item of items) slots.set(item.id, { item, card: createEmptyCard(new Date(base)), introduced: false, mature: false, today: 0 });

  const byKind: Record<string, number> = {};
  for (const it of items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;

  const days: SimDay[] = [];
  let introduced = 0;
  for (let d = 0; d < cfg.days; d++) {
    const dayStart = base + d * DAY_MS;
    const dayEnd = dayStart + cfg.sessionMinutes * 60_000;
    let seconds = 0, reviews = 0, newCards = 0;

    // 引入新卡
    for (const s of slots.values()) {
      if (s.introduced || s.item.introDay > d) continue;
      if (s.item.subtype === "context" && s.item.parentId) {
        const parent = slots.get(s.item.parentId);
        if (!parent?.mature) continue;
      }
      s.introduced = true;
      s.card = createEmptyCard(new Date(dayStart));
      introduced++;
      newCards++;
    }

    // 到期队列（含刚引入的），按 due 处理；同日学习步骤回到队列
    for (const s of slots.values()) s.today = 0;
    let queue = [...slots.values()].filter((s) => s.introduced && s.card.due.getTime() <= dayEnd);
    queue.sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
    while (queue.length > 0) {
      const s = queue.shift()!;
      const now = new Date(Math.max(dayStart + seconds * 1000, s.card.due.getTime()));
      const isNew = s.card.state === State.New;
      const p = isNew ? cfg.pNewGood : f.get_retrievability(s.card, now, false);
      const good = random() < p;
      seconds += secondsFor(s.item, cfg) * (isNew ? cfg.newMultiplier : 1) * (good ? 1 : cfg.againMultiplier);
      reviews++;
      s.today++;
      s.card = f.next(s.card, now, good ? Rating.Good : Rating.Again).card;
      if (s.card.state === State.Review && s.card.scheduled_days >= cfg.archiveIntervalDays) s.mature = true;
      if (s.card.due.getTime() <= dayEnd && s.today < cfg.maxSameDayReviews) {
        queue.push(s);
        queue.sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
      }
    }
    days.push({ day: d, reviews, newCards, minutes: seconds / 60 });
  }

  const sorted = days.map((x) => x.minutes).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const over20Days = days.filter((x) => x.minutes > 20).length;
  const medianMinutes = q(0.5), over20Ratio = days.length ? over20Days / days.length : 0;
  return {
    days, medianMinutes, p90Minutes: q(0.9), maxMinutes: sorted.at(-1) ?? 0,
    over20Days, over20Ratio, totalItems: items.length, introduced, byKind,
    pass: medianMinutes <= cfg.medianMax && over20Ratio <= cfg.over20RatioMax,
  };
}
