import { describe, expect, it } from "vitest";
import { flattenChapters, upsertChapters, type ChapterFile } from "../../src/server/content/chapters.ts";
import { TextbookText } from "../../src/server/content/verify.ts";
import { openDb } from "../../src/server/db/open.ts";

const file: ChapterFile = {
  科目: "生物",
  节点: [
    { 标题: "第一单元 生物和细胞", 子: [
      { 标题: "第一章 认识生物", 子: [
        { 标题: "第二节 生物的特征", pdf页: 12, 要点: [
          { 文: "生物的生活需要营养", 出处: "生物的生活需要营养。" },
          { 文: "生物能进行呼吸", 出处: "生物能进行呼吸。" },
          { 文: "编的", 出处: "生物都会飞。" },
        ] },
      ] },
    ] },
  ],
};
const text = new TextbookText("生物的生活需要营养。\n生物能进行呼吸。");

describe("章节树", () => {
  it("展平成带父子关系的行，id 由标题路径组成", () => {
    const r = flattenChapters(file, text);
    expect(r.rows.map((x) => [x.id, x.parentId])).toEqual([
      ["生物:第一单元 生物和细胞", null],
      ["生物:第一单元 生物和细胞/第一章 认识生物", "生物:第一单元 生物和细胞"],
      ["生物:第一单元 生物和细胞/第一章 认识生物/第二节 生物的特征", "生物:第一单元 生物和细胞/第一章 认识生物"],
    ]);
    expect(r.leaves).toBe(1);
    expect(r.rows[2]!.page).toBe(12);
  });
  it("要点出处核不上的不入库", () => {
    const r = flattenChapters(file, text);
    expect(r.points).toBe(2);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]!.point.文).toBe("编的");
    expect(r.rows[2]!.points.map((p) => p.text)).toEqual(["生物的生活需要营养", "生物能进行呼吸"]);
  });
  it("写入 chapter 表，重复写入覆盖", () => {
    const db = openDb(":memory:");
    const r = flattenChapters(file, text);
    expect(upsertChapters(db, r.rows)).toBe(3);
    expect(upsertChapters(db, r.rows)).toBe(3);
    const row = db.prepare("select * from chapter where parent_id is not null and id like '%第二节%'").get() as { points: string; page: number };
    expect(JSON.parse(row.points)).toHaveLength(2);
    expect(row.page).toBe(12);
    expect((db.prepare("select count(*) as n from chapter").get() as { n: number }).n).toBe(3);
  });

  it("文件里删掉的节点从库里删掉：先删子后删父；被勾选过的保留", () => {
    const db = openDb(":memory:");
    const v1: ChapterFile = { 科目: "生物", 节点: [{ 标题: "第一章", 子: [{ 标题: "第一节" }, { 标题: "综合实践", 子: [{ 标题: "做模型" }] }] }] };
    upsertChapters(db, flattenChapters(v1).rows);
    expect((db.prepare("SELECT COUNT(*) AS n FROM chapter").get() as { n: number }).n).toBe(4);
    // 第二版删掉了"综合实践"整枝（父 + 子）
    const v2: ChapterFile = { 科目: "生物", 节点: [{ 标题: "第一章", 子: [{ 标题: "第一节" }] }] };
    upsertChapters(db, flattenChapters(v2).rows);
    expect((db.prepare("SELECT id FROM chapter ORDER BY id").all() as { id: string }[]).map((r) => r.id)).toEqual(["生物:第一章", "生物:第一章/第一节"]);
    // 被勾选过的叶子即使从文件里删掉也保留
    db.prepare("INSERT INTO session (date, started_at) VALUES ('2026-09-07', '2026-09-07T09:00:00Z')").run();
    db.prepare("INSERT INTO checkin (session_id, chapter_id) VALUES (1, '生物:第一章/第一节')").run();
    upsertChapters(db, flattenChapters({ 科目: "生物", 节点: [{ 标题: "第一章" }] }).rows);
    expect((db.prepare("SELECT COUNT(*) AS n FROM chapter").get() as { n: number }).n).toBe(2);
  });
});
