/**
 * "会 / 不会" + 耗时 → FSRS 四档（增补清单第二节第 4 条）。
 * 不会 → Again。会：快于基准 0.6 倍 → Easy；不超过基准 1.5 倍 → Good；更慢 → Hard。
 * 基准 = 该条目最近几次作答的中位耗时；没有历史时用种类基准（policy.SECONDS_PER）。
 */
import { Rating, type Grade } from "ts-fsrs";
import { secondsFor } from "./policy.ts";
import type { Item } from "../../shared/types.ts";

export const EASY_RATIO = 0.6;
export const HARD_RATIO = 1.5;

export function inferRating(knew: boolean, elapsedMs: number, baselineMs: number): Grade {
  if (!knew) return Rating.Again;
  if (baselineMs <= 0) return Rating.Good;
  const r = elapsedMs / baselineMs;
  if (r <= EASY_RATIO) return Rating.Easy;
  if (r <= HARD_RATIO) return Rating.Good;
  return Rating.Hard;
}

/** 基准耗时：最近 N 次作答的中位；不足 3 次时用种类基准。 */
export function baselineMs(item: Pick<Item, "kind" | "subtype">, recentElapsedMs: number[]): number {
  if (recentElapsedMs.length >= 3) {
    const s = [...recentElapsedMs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
  return secondsFor(item) * 1000;
}
