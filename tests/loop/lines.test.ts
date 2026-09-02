import { describe, expect, it } from "vitest";
import { doneLines, pick, previewLines, startLines, type DoneContext, type StartContext } from "../../src/server/loop/lines.ts";

const s0: StartContext = { date: "2026-09-08", count: 9, minutes: 8, carry: 0, wrong: 0, topSubject: "地理", weekDone: 1, deferredYesterday: 0 };
const d0: DoneContext = { date: "2026-09-08", reviews: 9, dueTomorrow: 2, deferred: 0, wrongPassed: null, allRightSubject: null, weekDone: 2, minutes: 14 };

describe("开场与结束句子", () => {
  it("开场两句：情形句 + 数量句", () => {
    const l = startLines(s0);
    expect(l).toHaveLength(2);
    expect(l[1]).toMatch(/9 张/);
  });
  it("昨天没想起来的优先于错题优先于顺延", () => {
    expect(startLines({ ...s0, carry: 2, wrong: 1 })[0]).toMatch(/2 条/);
    expect(startLines({ ...s0, wrong: 1 })[0]).toMatch(/1 道/);
    expect(startLines({ ...s0, deferredYesterday: 3 })[0]).toMatch(/3 张/);
  });
  it("没有卡时只有一句", () => {
    expect(startLines({ ...s0, count: 0 })).toHaveLength(1);
  });
  it("结束页第一句固定格式（e2e 依赖），第二句按数据", () => {
    expect(doneLines(d0)[0]).toBe("今天 9 题，2 张卡明天到期。");
    expect(doneLines({ ...d0, wrongPassed: "解方程：3(x − 2) = 2x + 1" })[1]).toMatch(/自己算对|今天对了/);
    expect(doneLines({ ...d0, allRightSubject: "语文" })[1]).toMatch(/语文/);
    expect(doneLines({ ...d0, deferred: 2 })[1]).toBe("2 张顺延到明天。");
  });
  it("同一天稳定，隔天会换；无感叹号无表情", () => {
    const a = startLines(s0), b = startLines(s0);
    expect(a).toEqual(b);
    const seen = new Set<string>();
    for (let d = 1; d <= 20; d++) seen.add(startLines({ ...s0, date: `2026-09-${String(d).padStart(2, "0")}` })[0]!);
    expect(seen.size).toBeGreaterThan(1);
    for (const l of [...a, ...doneLines(d0)]) expect(l).not.toMatch(/[!！\u{1F300}-\u{1FAFF}]/u);
  });
  it("结束页“下次上课”一块：有勾选就点名下一节，没有就一句通用的；陈述式不问句", () => {
    const a = previewLines({ date: "2026-09-08", next: [{ subject: "数学", title: "1.3 有理数的乘除法" }, { subject: "生物", title: "第二节 生物的特征" }] });
    expect(a).toHaveLength(3);
    expect(a[1]).toBe("数学 · 1.3 有理数的乘除法");
    expect(a[2]).toBe("生物 · 第二节 生物的特征");
    const b = previewLines({ date: "2026-09-08", next: [] });
    expect(b).toHaveLength(1);
    for (const l of [...a, ...b]) expect(l).not.toMatch(/[?？!！]/);
  });
  it("pick 只依赖日期", () => {
    expect(pick("2026-09-08", ["a", "b", "c"])).toBe(pick("2026-09-08", ["a", "b", "c"]));
  });
});
