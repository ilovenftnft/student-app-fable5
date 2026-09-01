/**
 * 调度策略常量——模拟器（content/sim.ts）与真实调度共用这一份，改这里两边同时变。
 */
import { generatorParameters, State, type Card } from "ts-fsrs";
import type { Item } from "../../shared/types.ts";

/** 每次作答的基准秒数（假设值；上线后用 review.elapsed_ms 的实测中位替换）。键 `${kind}:${subtype}` 或 `${kind}`。 */
export const SECONDS_PER: Record<string, number> = {
  "recitation:fill": 20, "recitation:context": 25,
  "concept:fill": 15, "concept:answer_template": 40, "concept:gloss": 12,
  "vocab:word": 8, "listen:word": 10,
  wrong: 90,
};

export function secondsFor(item: Pick<Item, "kind" | "subtype">, table: Record<string, number> = SECONDS_PER): number {
  return table[`${item.kind}:${item.subtype}`] ?? table[item.kind] ?? 20;
}

/** 每日到期复习上限（验收 #3：10 分钟，超出顺延）。 */
export const DAILY_BUDGET_SECONDS = 10 * 60;

/** 接句卡间隔达到此天数视为成熟：解锁情境卡。 */
export const ARCHIVE_INTERVAL_DAYS = 30;

export function isMature(card: Pick<Card, "state" | "scheduled_days">): boolean {
  return card.state === State.Review && card.scheduled_days >= ARCHIVE_INTERVAL_DAYS;
}

/** 错题卡归档：跨 3 次间隔会话各答对 1 次（研究 02 第 3 条）。 */
export const WRONG_PASSES_TO_ARCHIVE = 3;

/** FSRS 目标保持率。 */
export const REQUEST_RETENTION = 0.9;

/**
 * FSRS 参数（调度与模拟共用）。**关掉同日学习步骤**（默认 1m/10m）：到期一律按天算，
 * 答错的卡次日再来——"到期卡"语义清楚，队列里不会出现"今天稍后才到期"的卡（Codex 审阅第三轮）。
 */
export const FSRS_PARAMS = generatorParameters({ request_retention: REQUEST_RETENTION, enable_fuzz: false, enable_short_term: false, learning_steps: [], relearning_steps: [] });
