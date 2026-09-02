import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { dueLabel, nextPreview } from "../../src/server/scheduler/preview.ts";
import { newCardState, review } from "../../src/server/scheduler/fsrs.ts";

const now = new Date("2026-09-07T09:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe("下次到期标签", () => {
  it("今天 / 明天 / N 天后 / N 个月后", () => {
    expect(dueLabel(now, now)).toBe("今天");
    expect(dueLabel(days(1), now)).toBe("明天");
    expect(dueLabel(days(12), now)).toBe("12 天后");
    expect(dueLabel(days(61), now)).toBe("2 个月后");
  });
  it("新卡：会 → 至少明天；不会 → 明天（无同日学习步骤）", () => {
    const p = nextPreview(newCardState("x", now).card, now);
    expect(p.unknown).toBe("明天");
    expect(p.knew).not.toBe("今天");
  });
  it("复习过几次的卡：会的间隔比不会的长", () => {
    let c = newCardState("x", days(-40)).card;
    c = review(c, days(-40), Rating.Good); c = review(c, days(-30), Rating.Good); c = review(c, days(-10), Rating.Good);
    const p = nextPreview(c, now);
    expect(p.unknown).toMatch(/明天|天后/);
    expect(p.knew).toMatch(/天后|个月后/);
    expect(p.knew).not.toBe(p.unknown);
  });
});
