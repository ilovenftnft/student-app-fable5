/**
 * 主按钮上的"下次什么时候"（定稿方向 B）："会 · 下次 12 天后 / 不会 · 下次 明天"。
 * 用同一份 FSRS 参数预演 Good / Again 两种结果，只算不存。
 */
import { Rating, type Card } from "ts-fsrs";
import { scheduler } from "./fsrs.ts";
import { localDate, daysBetween } from "./day.ts";

export function dueLabel(due: Date, now: Date): string {
  const d = daysBetween(localDate(now), localDate(due));
  if (d <= 0) return "今天";
  if (d === 1) return "明天";
  if (d < 30) return `${d} 天后`;
  if (d < 365) return `${Math.round(d / 30)} 个月后`;
  return "一年后";
}

export interface NextPreview { knew: string; unknown: string }
export function nextPreview(card: Card, now: Date): NextPreview {
  const good = scheduler.next(card, now, Rating.Good).card.due;
  const again = scheduler.next(card, now, Rating.Again).card.due;
  return { knew: dueLabel(good, now), unknown: dueLabel(again, now) };
}
