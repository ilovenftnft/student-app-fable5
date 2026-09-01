import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { baselineMs, inferRating } from "../../src/server/scheduler/rating.ts";

describe("会/不会 + 耗时 → 四档", () => {
  it("不会永远是 Again，不看耗时", () => {
    expect(inferRating(false, 1000, 15000)).toBe(Rating.Again);
    expect(inferRating(false, 90000, 15000)).toBe(Rating.Again);
  });
  it("会：快 → Easy，正常 → Good，慢 → Hard", () => {
    expect(inferRating(true, 5000, 15000)).toBe(Rating.Easy);
    expect(inferRating(true, 9000, 15000)).toBe(Rating.Easy);
    expect(inferRating(true, 15000, 15000)).toBe(Rating.Good);
    expect(inferRating(true, 22500, 15000)).toBe(Rating.Good);
    expect(inferRating(true, 30000, 15000)).toBe(Rating.Hard);
  });
  it("没有基准时会 = Good", () => {
    expect(inferRating(true, 1, 0)).toBe(Rating.Good);
  });
  it("基准：≥3 次历史取中位，否则用种类基准", () => {
    const item = { kind: "concept" as const, subtype: "fill" };
    expect(baselineMs(item, [])).toBe(15000);
    expect(baselineMs(item, [9000, 20000])).toBe(15000);
    expect(baselineMs(item, [30000, 9000, 12000])).toBe(12000);
  });
});
