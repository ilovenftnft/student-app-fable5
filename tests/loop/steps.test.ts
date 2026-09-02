import { describe, expect, it } from "vitest";
import { currentStep, progress, type LoopState } from "../../src/server/loop/steps.ts";
import { timerView } from "../../src/server/loop/timer.ts";

const base: LoopState = { started: true, checkins: [], recallPending: [], queueRemaining: 0, reflectionDone: false, ended: false, checkinDone: false };

describe("每日闭环走法", () => {
  it("开场 → 勾选 → 回想 → 到期卡 → 三问 → 结束", () => {
    expect(currentStep({ ...base, started: false })).toBe("start");
    expect(progress({ ...base, started: false })).toEqual({ index: 0, total: 4 });
    expect(currentStep(base)).toBe("checkin");
    expect(currentStep({ ...base, checkinDone: true, recallPending: ["生物:x"] })).toBe("recall");
    expect(currentStep({ ...base, checkinDone: true, queueRemaining: 3 })).toBe("review");
    expect(currentStep({ ...base, checkinDone: true })).toBe("reflect");
    expect(currentStep({ ...base, checkinDone: true, reflectionDone: true })).toBe("done");
  });
  it("没勾章节或章节没有要点时跳过回想；没到期卡时跳过复习（冷启动 ≈ 勾选 + 三问）", () => {
    expect(currentStep({ ...base, checkinDone: true, checkins: ["语文:春"], recallPending: [] })).toBe("reflect");
  });
  it("硬停后无论到哪一步都是结束页", () => {
    expect(currentStep({ ...base, queueRemaining: 9, ended: true })).toBe("done");
  });
  it("进度 index / total", () => {
    expect(progress(base)).toEqual({ index: 0, total: 4 });
    expect(progress({ ...base, checkinDone: true, queueRemaining: 1 })).toEqual({ index: 2, total: 4 });
    expect(progress({ ...base, ended: true })).toEqual({ index: 4, total: 4 });
  });
});

describe("计时规则", () => {
  const t0 = new Date("2026-09-07T09:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000 + 10_000);
  it("正常 → 30 分钟还有事先休息 3 分钟 → 可以结束 → 60 分钟硬停", () => {
    expect(timerView(t0, at(10), true)).toMatchObject({ minutes: 10, phase: "normal", accent: false });
    expect(timerView(t0, at(25), true).phase).toBe("normal");
    expect(timerView(t0, at(30), true)).toMatchObject({ phase: "break", accent: true, message: "休息 3 分钟。" });
    expect(timerView(t0, at(32), true).phase).toBe("break");
    expect(timerView(t0, at(33), true)).toMatchObject({ phase: "can_end", accent: true, message: "可以结束了，也可以继续。" });
    expect(timerView(t0, at(30), false)).toMatchObject({ phase: "can_end", accent: true });
    expect(timerView(t0, at(60), false).phase).toBe("hard_stop");
  });
  it("只显示分钟，不出现秒", () => {
    expect(timerView(t0, new Date(t0.getTime() + 59_000), false).minutes).toBe(0);
  });
  it("文案无感叹号无表情", () => {
    for (const m of [0, 25, 30, 60]) {
      const msg = timerView(t0, at(m), true).message ?? "";
      expect(msg).not.toMatch(/[!！]/);
    }
  });
});
