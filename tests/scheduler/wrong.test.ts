import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { updateWrongProgress, type WrongProgress } from "../../src/server/scheduler/wrong.ts";

const zero: WrongProgress = { passStreak: 0, lastPassSession: null, archived: false };

describe("错题卡归档", () => {
  it("跨 3 次会话各答对 1 次才归档", () => {
    let p = updateWrongProgress(zero, Rating.Good, 1);
    expect(p).toEqual({ passStreak: 1, lastPassSession: 1, archived: false });
    p = updateWrongProgress(p, Rating.Easy, 2);
    expect(p.passStreak).toBe(2);
    p = updateWrongProgress(p, Rating.Hard, 3);
    expect(p).toEqual({ passStreak: 3, lastPassSession: 3, archived: true });
  });
  it("同一会话连对多次只算一次", () => {
    let p = updateWrongProgress(zero, Rating.Good, 1);
    p = updateWrongProgress(p, Rating.Good, 1);
    p = updateWrongProgress(p, Rating.Good, 1);
    expect(p.passStreak).toBe(1);
  });
  it("答错清零", () => {
    let p = updateWrongProgress(zero, Rating.Good, 1);
    p = updateWrongProgress(p, Rating.Good, 2);
    p = updateWrongProgress(p, Rating.Again, 3);
    expect(p.passStreak).toBe(0);
    expect(p.archived).toBe(false);
  });
});
