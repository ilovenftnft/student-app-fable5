/**
 * 家长周报（验收 #5）：本周完成天数 / 已掌握卡片数 / 本周最薄弱的一个知识点 / 一句建议的家长行为。
 * 只聚合，不含逐题、时长、时间戳（硬约束 5）。纯函数，输入是已经查好的行。
 */
import type { Card } from "ts-fsrs";
import { isMature } from "../scheduler/policy.ts";

export interface WeekSession { date: string; ended: boolean }
export interface WeekReview { itemId: string; rating: number; topic: string; subject: string }

export interface WeeklyReport {
  /** 本周完成天数（周一到周五算 5 天） */
  daysDone: number;
  daysTotal: 5;
  masteredCards: number;
  /** 本周最薄弱：答错次数最多的知识点；没有数据时为 null */
  weakest: { subject: string; topic: string } | null;
  suggestion: string;
  /** 本周讲解次数（只给总数，不给逐条——硬约束 5；家长 2026-09-01 定） */
  explanations: number;
}

export function masteredCount(cards: Iterable<Pick<Card, "state" | "scheduled_days">>): number {
  let n = 0;
  for (const c of cards) if (isMature(c)) n++;
  return n;
}

export function weakestTopic(reviews: WeekReview[]): WeeklyReport["weakest"] {
  const again = new Map<string, { subject: string; topic: string; n: number }>();
  for (const r of reviews) {
    if (r.rating !== 1) continue;
    const key = `${r.subject}:${r.topic}`;
    const e = again.get(key) ?? { subject: r.subject, topic: r.topic, n: 0 };
    e.n++;
    again.set(key, e);
  }
  let best: { subject: string; topic: string; n: number } | null = null;
  for (const e of again.values()) if (!best || e.n > best.n) best = e;
  return best ? { subject: best.subject, topic: best.topic } : null;
}

/** 一句建议的家长行为——陈述式、不带感叹号、不出现"报班"（硬约束 10）。 */
export function suggestion(daysDone: number, weakest: WeeklyReport["weakest"]): string {
  if (daysDone === 0) return "这周没有开始。周日晚上一起定一下放学后什么时候做这件事。";
  if (daysDone < 3) return `这周做了 ${daysDone} 天。问一句"哪天最顺"，比问"为什么没做"有用。`;
  if (weakest) return `${weakest.subject}的"${weakest.topic}"这周错得最多。饭桌上让他给你讲一遍这一节讲了什么，不用纠正。`;
  return "这周节奏稳定。周末不加内容，让他自己决定要不要多做一点。";
}

export function weeklyReport(sessions: WeekSession[], cards: Iterable<Pick<Card, "state" | "scheduled_days">>, reviews: WeekReview[], explanations = 0): WeeklyReport {
  const daysDone = new Set(sessions.filter((s) => s.ended).map((s) => s.date)).size;
  const weakest = weakestTopic(reviews);
  return { daysDone: Math.min(daysDone, 5), daysTotal: 5, masteredCards: masteredCount(cards), weakest, suggestion: suggestion(daysDone, weakest), explanations };
}
