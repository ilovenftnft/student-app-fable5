import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { weeklyReport, suggestion } from "../../src/server/report/weekly.ts";

describe("周报", () => {
  const cards = [
    { state: State.Review, scheduled_days: 45 },
    { state: State.Review, scheduled_days: 10 },
    { state: State.Learning, scheduled_days: 0 },
  ];
  it("完成天数按会话结束的不同日期算，封顶 5", () => {
    const r = weeklyReport([{ date: "2026-09-07", ended: true }, { date: "2026-09-07", ended: true }, { date: "2026-09-08", ended: false }, { date: "2026-09-09", ended: true }], cards, []);
    expect(r.daysDone).toBe(2);
    expect(r.daysTotal).toBe(5);
  });
  it("讲解次数只给总数", () => {
    expect(weeklyReport([], cards, [], 4).explanations).toBe(4);
    expect(weeklyReport([], cards, []).explanations).toBe(0);
  });
  it("已掌握 = 成熟卡", () => {
    expect(weeklyReport([], cards, []).masteredCards).toBe(1);
  });
  it("最薄弱 = 本周 Again 最多的知识点", () => {
    const reviews = [
      { itemId: "a", rating: 1, topic: "细胞的生活", subject: "生物" },
      { itemId: "b", rating: 1, topic: "细胞的生活", subject: "生物" },
      { itemId: "c", rating: 1, topic: "地图", subject: "地理" },
      { itemId: "d", rating: 3, topic: "地图", subject: "地理" },
    ];
    const r = weeklyReport([{ date: "2026-09-07", ended: true }, { date: "2026-09-08", ended: true }, { date: "2026-09-09", ended: true }], cards, reviews);
    expect(r.weakest).toEqual({ subject: "生物", topic: "细胞的生活" });
    expect(r.suggestion).toContain("细胞的生活");
  });
  it("没有数据时最薄弱为 null", () => {
    expect(weeklyReport([], cards, []).weakest).toBeNull();
  });
  it("建议不含'报班'、无感叹号，且不含逐题/时长", () => {
    for (const s of [suggestion(0, null), suggestion(2, null), suggestion(4, { subject: "生物", topic: "x" }), suggestion(5, null)]) {
      expect(s).not.toMatch(/报班|补习|[!！]|分钟/);
    }
  });
});
