import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/server/db/open.ts";
import { upsertItems } from "../../src/server/content/store.ts";
import { flattenChapters, upsertChapters } from "../../src/server/content/chapters.ts";
import { createApp } from "../../src/server/app.ts";
import * as repo from "../../src/server/db/repo.ts";
import type { Item } from "../../src/shared/types.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";

const items: Item[] = Array.from({ length: 5 }, (_, i) => ({
  id: `concept:生物:t:${i}`, subject: "生物", kind: "concept", subtype: "fill", front: `问 ${i}`, back: `答 ${i}`,
  sourceQuote: "x", sourceRef: "y", pool: "standard", introDay: 0, meta: { 重要概念: "细胞" },
}));
const vocab: Item[] = [
  { id: "vocab:Apple", subject: "英语", kind: "vocab", subtype: "word", front: "Apple", back: "n. 苹果", sourceQuote: "x", sourceRef: "y", pool: "standard", introDay: 400, meta: { 词: "Apple", 音标: "ˈæpl", 音块: ["a", "pp", "le"], 拼读规律说法: "辅音+le 读轻音节 /əl/,e 不发音(noble·settle·impossible)" } },
  { id: "listen:Apple", subject: "英语", kind: "listen", subtype: "word", front: "audio:Apple", back: "Apple", parentId: "vocab:Apple", sourceQuote: "x", sourceRef: "y", pool: "standard", introDay: 400, meta: { 词: "Apple", 音标: "ˈæpl" } },
  { id: "vocab:pear", subject: "英语", kind: "vocab", subtype: "word", front: "pear", back: "n. 梨", sourceQuote: "x", sourceRef: "y", pool: "standard", introDay: 400, meta: { 词: "pear", 音标: "per" } },
];
const chapters = flattenChapters({ 科目: "生物", 节点: [{ 标题: "第一章", 子: [
  { 标题: "第一节", pdf页: 4, 要点: [{ 文: "A", 出处: "a" }, { 文: "B", 出处: "b" }] },
  { 标题: "第二节", pdf页: 8 },
] }] }).rows;

let db: DatabaseSync, app: Hono, now: Date;
const j = async (path: string, body?: unknown) => {
  const res = await app.request(path, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return res.json() as Promise<any>;
};

beforeEach(() => {
  db = openDb(":memory:");
  repo.invalidateItems();
  upsertItems(db, [...items, ...vocab]);
  upsertChapters(db, chapters);
  repo.setSetting(db, "content_start", "2026-09-07");
  now = new Date("2026-09-07T09:00:00Z");
  app = createApp(db, () => now);
});

describe("每日闭环端到端（API）", () => {
  it("开场 → 勾选 → 回想 → 到期卡 → 三问 → 结束页", async () => {
    let t = await j("/api/today");
    expect(t.step).toBe("start");
    expect(t.session).toBeNull();
    expect(t.start.lines.length).toBeGreaterThanOrEqual(1);
    expect(t.start.bySubject[0]).toMatchObject({ subject: "生物" });

    // 开场页：先做生物，不多做
    t = await j("/api/session/start", { subjectFirst: "生物", extra: false });
    expect(t.step).toBe("checkin");
    expect(t.start.choices).toEqual({ subjectFirst: "生物", extra: false });

    t = await j("/api/checkin", { chapterIds: ["生物:第一章/第一节", "生物:第一章/第二节"] });
    expect(t.step).toBe("recall");
    expect(t.recallPending).toEqual([{ chapterId: "生物:第一章/第一节", subject: "生物", parentTitle: "第一章", title: "第一节", points: [{ text: "A", quote: "a" }, { text: "B", quote: "b" }] }]); // 回想显示原句 quote，text 用来找概念词
    expect(t.timer.minutes).toBe(0);

    t = await j("/api/recall", { chapterId: "生物:第一章/第一节", thinkMs: 60000, missed: [1] });
    expect(t.step).toBe("review");
    expect(t.queue.remaining).toBe(5);

    // 先作答再看答案
    let card = await j("/api/card/next");
    expect(card.front).toBe("问 0");
    expect(card.isNew).toBe(true);
    const ans = await j(`/api/card/${card.itemId}/answer`);
    expect(ans.back).toBe("答 0");
    let r = await j("/api/review", { itemId: card.itemId, knew: true, elapsedMs: 12000 });
    expect(r.feedback).toBe("对了。");
    expect(r.next.front).toBe("问 1");
    r = await j("/api/review", { itemId: r.next.itemId, knew: false, elapsedMs: 30000 });
    expect(r.feedback).toBe("再看一眼答案。");
    expect(r.rating).toBe(1);
    for (let i = 0; i < 6; i++) { const c = await j("/api/card/next"); if (!c) break; await j("/api/review", { itemId: c.itemId, knew: true, elapsedMs: 10000 }); }

    t = await j("/api/today");
    while (t.step === "review") { const c = await j("/api/card/next"); await j("/api/review", { itemId: c.itemId, knew: true, elapsedMs: 10000 }); t = await j("/api/today"); }
    expect(t.step).toBe("reflect");

    t = await j("/api/reflect", { hardest: "concept:生物:t:1", guessed: null, tomorrow: "concept:生物:t:1" });
    expect(t.step).toBe("done");
    expect(t.summary.reviews).toBe(5); // 5 张卡各答一次；答错的次日再来，不在当天重复
    t = await j("/api/session/end", {});
    expect(t.session.ended).toBe(true);
    expect(t.step).toBe("done");
  });

  it("没勾章节、没到期卡：冷启动 = 勾选 + 三问", async () => {
    repo.setSetting(db, "content_start", "2026-10-01"); // 内容还没启用
    let t = await j("/api/today");
    expect(t.start.count).toBe(0);
    expect(t.start.lines).toHaveLength(1);
    await j("/api/session/start", { subjectFirst: null, extra: false });
    t = await j("/api/checkin", { chapterIds: [] });
    expect(t.step).toBe("reflect");
  });

  it("结束页“下次上课”一块：勾了第一节就点名第二节", async () => {
    expect((await j("/api/today")).previewLines).toHaveLength(1);
    await j("/api/checkin", { chapterIds: ["生物:第一章/第一节"] });
    expect((await j("/api/today")).previewLines.slice(1)).toEqual(["生物 · 第二节"]);
  });
  it("结束页“下次上课”一块：跨章时带章名", async () => {
    upsertChapters(db, flattenChapters({ 科目: "生物", 节点: [
      { 标题: "第一章", 子: [{ 标题: "第一节", pdf页: 4 }, { 标题: "第二节", pdf页: 8 }] },
      { 标题: "第二章", 子: [{ 标题: "第一节", pdf页: 20 }] },
    ] }).rows); // 同科目整棵重写
    await j("/api/checkin", { chapterIds: ["生物:第一章/第二节"] });
    expect((await j("/api/today")).previewLines.slice(1)).toEqual(["生物 · 第二章 · 第一节"]);
  });

  it("读音表：词小写为键，带音标；只有有 listen 项的词才有录音地址", async () => {
    expect(await j("/api/pronunciation")).toEqual({ apple: { ipa: "ˈæpl", audio: "/audio/Apple.ogg", chunks: ["a", "pp", "le"], rule: "辅音+le 读轻音节 /əl/,e 不发音(noble·settle·impossible)" }, pear: { ipa: "per", audio: null } });
  });

  it("昨天没想起来的要点，第二天进 carry", async () => {
    await j("/api/checkin", { chapterIds: ["生物:第一章/第一节"] });
    await j("/api/recall", { chapterId: "生物:第一章/第一节", thinkMs: 1000, missed: [0] });
    expect(await j("/api/recall/carry")).toEqual([]);
    now = new Date("2026-09-08T09:00:00Z");
    expect(await j("/api/recall/carry")).toEqual([{ chapterId: "生物:第一章/第一节", title: "第一节", points: [{ text: "A", quote: "a" }] }]);
  });

  it("60 分钟硬停对写接口同样成立：超时后作答/回想/三问都被拒绝并落库硬停", async () => {
    await j("/api/checkin", { chapterIds: ["生物:第一章/第一节"] });
    const c = await j("/api/card/next");
    now = new Date("2026-09-07T10:00:30Z"); // 60.5 分钟，前端还没轮询到
    let res = await app.request("/api/review", { method: "POST", body: JSON.stringify({ itemId: c.itemId, knew: true, elapsedMs: 1000 }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).today.step).toBe("done");
    expect(repo.sessionOn(db, "2026-09-07")!.ended_by).toBe("hard_stop");
    expect(repo.reviewsInSession(db, repo.sessionOn(db, "2026-09-07")!.id)).toBe(0);
    for (const [p, b] of [["/api/recall", { chapterId: "生物:第一章/第一节", thinkMs: 1, missed: [] }], ["/api/reflect", { hardest: null }], ["/api/checkin", { chapterIds: [] }]] as const) {
      res = await app.request(p, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
      expect(res.status).toBe(409);
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM recall").get()).toEqual({ n: 0 });
  });

  it("60 分钟硬停：读取 today 时落库", async () => {
    await j("/api/checkin", { chapterIds: [] });
    now = new Date("2026-09-07T10:01:00Z");
    const t = await j("/api/today");
    expect(t.session.ended).toBe(true);
    expect(t.step).toBe("done");
    expect(repo.sessionOn(db, "2026-09-07")!.ended_by).toBe("hard_stop");
  });

  it("周报：四项，无逐题无时长", async () => {
    await j("/api/checkin", { chapterIds: [] });
    const c = await j("/api/card/next");
    await j("/api/review", { itemId: c.itemId, knew: false, elapsedMs: 5000 });
    await j("/api/session/end", {});
    const w = await j("/api/parent/weekly");
    expect(w.week).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(w.daysDone).toBe(1);
    expect(w.weakest).toEqual({ subject: "生物", topic: "细胞" });
    expect(Object.keys(w).sort()).toEqual(["daysDone", "daysTotal", "explanations", "masteredCards", "suggestion", "weakest", "week"]);
    expect(w.explanations).toBe(0);
  });
});

describe("成绩与位次录入（API）", () => {
  it("增删查，校验必填", async () => {
    let r = await app.request("/api/parent/exams", { method: "POST", body: JSON.stringify({ date: "2026-11-10", name: "期中", subject: "总分", score: 612, fullScore: 700, classRank: 8, classSize: 45, gradeRank: 60, gradeSize: 520 }), headers: { "content-type": "application/json" } });
    expect(r.status).toBe(200);
    r = await app.request("/api/parent/exams", { method: "POST", body: JSON.stringify({ date: "2026-11-10", name: "期中", subject: "数学", score: 95 }), headers: { "content-type": "application/json" } });
    expect(r.status).toBe(400);
    const list = await j("/api/parent/exams");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ subject_id: "总分", score: 612, class_rank: 8, grade_size: 520 });
    await app.request(`/api/parent/exams/${list[0].id}`, { method: "DELETE" });
    expect(await j("/api/parent/exams")).toEqual([]);
  });
});
