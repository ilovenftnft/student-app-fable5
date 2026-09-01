import { describe, expect, it } from "vitest";
import { Rating, State } from "ts-fsrs";
import { buildQueue } from "../../src/server/scheduler/queue.ts";
import { fromRow, newCardState, review, toRow, type CardState } from "../../src/server/scheduler/fsrs.ts";
import { dayBounds, daysBetween, localDate } from "../../src/server/scheduler/day.ts";
import type { Item } from "../../src/shared/types.ts";

const now = new Date("2026-09-07T09:00:00Z"); // 北京 17:00

function concept(i: number, introDay = 0): Item {
  return { id: `c${i}`, subject: "生物", kind: "concept", subtype: "fill", front: "", back: "", sourceQuote: "", sourceRef: "", pool: "standard", introDay, meta: {} };
}
/** 复习过一次、到期时间为 due 的卡 */
function dueState(id: string, due: Date): CardState {
  const s = newCardState(id, new Date(due.getTime() - 86_400_000));
  s.card = review(s.card, new Date(due.getTime() - 86_400_000), Rating.Good);
  s.card.due = due;
  return s;
}

describe("dayBounds（Asia/Shanghai）", () => {
  it("今天的边界按北京时间算", () => {
    const b = dayBounds(now);
    expect(b.date).toBe("2026-09-07");
    expect(b.start.toISOString()).toBe("2026-09-06T16:00:00.000Z");
    expect(b.end.toISOString()).toBe("2026-09-07T16:00:00.000Z");
    expect(localDate(new Date("2026-09-07T17:30:00Z"))).toBe("2026-09-08");
    expect(daysBetween("2026-09-01", "2026-09-07")).toBe(6);
  });
});

describe("buildQueue", () => {
  it("到期卡按 due 先后排，超过 10 分钟的顺延", () => {
    const items = Array.from({ length: 60 }, (_, i) => concept(i, 999));
    const states = new Map(items.map((it, i) => [it.id, dueState(it.id, new Date(now.getTime() - i * 60_000))]));
    const q = buildQueue({ items, states, now, dayIndex: 0 });
    // concept:fill 15s → 600s 装 40 张
    expect(q.entries).toHaveLength(40);
    expect(q.deferred).toBe(20);
    expect(q.entries[0]!.item.id).toBe("c59"); // 最早到期的在前
    expect(q.estSeconds).toBe(600);
  });
  it("到期卡至少排一张，哪怕它一张就超预算", () => {
    const items = [{ ...concept(0, 999), kind: "wrong" as const, subtype: "x" }];
    const states = new Map([["c0", dueState("c0", now)]]);
    const q = buildQueue({ items, states, now, dayIndex: 0, budgetSeconds: 30 });
    expect(q.entries).toHaveLength(1);
  });
  it("会话中途预算用完：到期卡全部顺延，不再派发", () => {
    const items = Array.from({ length: 5 }, (_, i) => concept(i, 999));
    const states = new Map(items.map((it) => [it.id, dueState(it.id, now)]));
    const q = buildQueue({ items, states, now, dayIndex: 0, spentSeconds: 600 });
    expect(q.entries).toHaveLength(0);
    expect(q.deferred).toBe(5);
    const almost = buildQueue({ items, states, now, dayIndex: 0, spentSeconds: 590 });
    expect(almost.entries).toHaveLength(0); // 剩 10 秒，一张 15 秒也装不下
  });
  it("明天才到期的不进队列；归档的不进", () => {
    const items = [concept(0, 999), concept(1, 999)];
    const states = new Map([
      ["c0", dueState("c0", new Date("2026-09-08T01:00:00Z"))],
      ["c1", { ...dueState("c1", now), archived: true }],
    ]);
    expect(buildQueue({ items, states, now, dayIndex: 0 }).entries).toHaveLength(0);
  });
  it("剩余预算引入新卡：只引入 intro_day ≤ 今天的，按 intro_day 排", () => {
    const items = [concept(0, 5), concept(1, 0), concept(2, 3)];
    const q = buildQueue({ items, states: new Map(), now, dayIndex: 3 });
    expect(q.entries.map((e) => [e.item.id, e.isNew])).toEqual([["c1", true], ["c2", true]]);
    expect(q.newWaiting).toBe(0);
  });
  it("预算被到期卡占满时新卡等待", () => {
    const items = [...Array.from({ length: 40 }, (_, i) => concept(i, 999)), concept(100, 0)];
    const states = new Map(items.slice(0, 40).map((it) => [it.id, dueState(it.id, now)]));
    const q = buildQueue({ items, states, now, dayIndex: 0 });
    expect(q.entries.every((e) => !e.isNew)).toBe(true);
    expect(q.newWaiting).toBe(1);
  });
  it("情境卡要等接句卡成熟", () => {
    const fill: Item = { ...concept(0), id: "f", kind: "recitation", subtype: "fill" };
    const ctx: Item = { ...concept(1), id: "x", kind: "recitation", subtype: "context", parentId: "f" };
    const young = dueState("f", new Date("2026-09-09T00:00:00Z"));
    expect(buildQueue({ items: [fill, ctx], states: new Map([["f", young]]), now, dayIndex: 0 }).entries).toHaveLength(0);
    const mature = { ...young, card: { ...young.card, state: State.Review, scheduled_days: 45 } };
    const q = buildQueue({ items: [fill, ctx], states: new Map([["f", mature]]), now, dayIndex: 0 });
    expect(q.entries.map((e) => e.item.id)).toEqual(["x"]);
  });
  it("今天稍后才到期的排在新卡后面", () => {
    const items = [concept(0, 999), concept(1, 0)];
    const states = new Map([["c0", dueState("c0", new Date(now.getTime() + 10 * 60_000))]]);
    const q = buildQueue({ items, states, now, dayIndex: 0 });
    expect(q.entries.map((e) => e.item.id)).toEqual(["c1", "c0"]);
  });
  it("prestudy 不进队列", () => {
    const items = [{ ...concept(0), kind: "prestudy" as const, subtype: "definition" }];
    expect(buildQueue({ items, states: new Map(), now, dayIndex: 0 }).entries).toHaveLength(0);
  });
});

describe("card_state 行转换", () => {
  it("toRow / fromRow 往返一致", () => {
    const s = dueState("c0", now);
    s.passStreak = 2; s.lastPassSession = 7;
    const back = fromRow(toRow(s));
    expect(back.card.due.getTime()).toBe(s.card.due.getTime());
    expect(back.card.state).toBe(s.card.state);
    expect(back.passStreak).toBe(2);
    expect(back.lastPassSession).toBe(7);
    expect(back.archived).toBe(false);
  });
});
