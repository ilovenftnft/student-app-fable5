import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseEvents } from "../../src/server/inbox/engine.ts";
import { sortForReview, toProblems, type Recognized } from "../../src/server/inbox/recognize.ts";

const golden = JSON.parse(readFileSync(new URL("../golden/recognize-2026数学-12.json", import.meta.url), "utf8")) as Recognized;

describe("识题 golden：2026 数学第 12 页（Codex 实跑输出）", () => {
  it("6 道选择题 → 6 条待确认，选项拼进题面，带图题标记", () => {
    const ps = toProblems({ ...golden, subject: "数学" });
    expect(ps).toHaveLength(6);
    expect(ps.map((p) => p.raw.number)).toEqual(["2", "3", "4", "5", "6", "7"]);
    expect(ps[1]!.stem).toContain("科学记数法");
    expect(ps[1]!.stem).toContain("B. $7.9\\times10^3$");
    expect(ps[1]!.tags).toEqual(["科学记数法", "七年级上册 第一章 有理数"]);
    expect(ps.filter((p) => p.needsFigure).map((p) => p.raw.number)).toEqual(["2", "4", "5", "7"]);
    expect(ps.every((p) => p.subject === "数学")).toBe(true);
    // 旧 schema 没有批改字段：视为无标记、无参考答案
    expect(ps[0]!.teacherMark).toBeNull();
    expect(ps[0]!.answer).toBeNull();
  });
  it("科目不在七科里时为 null，空题干丢弃", () => {
    const ps = toProblems({ subject: "其他", page_summary: "", questions: [{ ...golden.questions[0]!, stem: "  " }, golden.questions[1]!] });
    expect(ps).toHaveLength(1);
    expect(ps[0]!.subject).toBeNull();
  });
  it("待确认排序：老师打 ✗ 的在前，再按置信度低→高", () => {
    const s = sortForReview([{ id: 1, teacherMark: null, confidence: 0.5 }, { id: 2, teacherMark: "✗", confidence: 0.9 }, { id: 3, teacherMark: "✗", confidence: 0.6 }, { id: 4, teacherMark: "✓", confidence: 0.2 }]);
    expect(s.map((x) => x.id)).toEqual([3, 2, 4, 1]);
  });
});

describe("Codex 事件流解析", () => {
  it("golden：抓到 thread_id，无错误", () => {
    const ev = parseEvents(readFileSync(new URL("../golden/codex-events-ok.jsonl", import.meta.url), "utf8"));
    expect(ev.threadId).toBe("01a05c8f-5771-7671-923f-517414d3612c");
    expect(ev.errors).toEqual([]);
    expect(ev.quotaResetAt).toBeUndefined();
  });
  it("额度触顶：读出重置时间；读不出就一小时后", () => {
    const ev = parseEvents('{"type":"thread.started","thread_id":"t1"}\n{"type":"turn.failed","error":{"message":"You have hit your usage limit. Resets at 2026-09-02T03:00:00Z"}}\n');
    expect(ev.errors).toHaveLength(1);
    expect(ev.quotaResetAt?.toISOString()).toBe("2026-09-02T03:00:00.000Z");
    const ev2 = parseEvents('{"type":"error","message":"rate limit exceeded"}');
    expect(ev2.quotaResetAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
  });
  it("噪音行与非 JSON 行忽略", () => {
    expect(parseEvents("Reading additional input from stdin...\nnot json\n")).toEqual({ threadId: undefined, errors: [], quotaResetAt: undefined });
  });
});
