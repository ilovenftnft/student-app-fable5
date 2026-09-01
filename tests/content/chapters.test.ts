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
});
