import { describe, expect, it } from "vitest";
import { introDayOf, parsePool, subjectOf } from "../../src/server/content/pools.ts";

const recitation = {
  name: "语文-七上-默写",
  json: {
    篇目: [
      {
        标题: "观沧海", 作者: "曹操", 池: "standard", 课标序号: 4, 教材位置: "第一单元 第4课（书 p15）",
        句对: [
          ["东临碣石", "以观沧海", "点明登临之处"],
          ["日月之行，若出其中", "星汉灿烂，若出其里", "想象之笔", "日月之行，若出其中；星汉灿烂，若出其里。"],
        ],
      },
    ],
  },
};

describe("默写池", () => {
  it("每个句对生成接句卡 + 情境卡，情境卡挂在接句卡下", () => {
    const items = parsePool(recitation);
    expect(items).toHaveLength(4);
    const [fill, ctx] = items;
    expect(fill).toMatchObject({ id: "recitation:观沧海:0:fill", kind: "recitation", subtype: "fill", front: "东临碣石，______", back: "以观沧海", pool: "standard", subject: "语文" });
    expect(fill!.sourceQuote).toBe("东临碣石，以观沧海。");
    expect(ctx).toMatchObject({ id: "recitation:观沧海:0:context", subtype: "context", front: "点明登临之处", back: "东临碣石，以观沧海。", parentId: "recitation:观沧海:0:fill" });
  });
  it("句对第 4 个元素给出全句时以它为准", () => {
    const items = parsePool(recitation);
    expect(items[2]!.sourceQuote).toBe("日月之行，若出其中；星汉灿烂，若出其里。");
    expect(items[3]!.back).toBe("日月之行，若出其中；星汉灿烂，若出其里。");
  });
});

describe("概念池", () => {
  const concept = {
    name: "生物-七上第一单元",
    json: {
      科目: "生物", 引入起点天: 10, 引入跨度天: 20,
      概念: [
        { 编号: "1.1.1", 池: "standard", 重要概念: "细胞", 课标原文: "…", 教材位置: "第三章 第四节",
          题: [["只由一个细胞构成的生物，叫作____。", "单细胞生物", "它们的身体只有一个细胞，称为单细胞生物。"]] },
        { 编号: "1.1.2", 池: "textbook", 题型: "answer_template", 重要概念: "x", 教材位置: "第一章",
          题: [["问？", ["要点一", "要点二"], "要点一。要点二。"]] },
      ],
    },
  };
  it("一题一条，填空与答题模板分开", () => {
    const items = parsePool(concept);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "concept:生物:1.1.1:0", kind: "concept", subtype: "fill", back: "单细胞生物", pool: "standard", sourceRef: "生物七上 第三章 第四节" });
    expect(items[1]).toMatchObject({ subtype: "answer_template", back: "要点一；要点二", answerPoints: ["要点一", "要点二"], pool: "textbook" });
  });
  it("引入日按起点与跨度均匀铺开", () => {
    const items = parsePool(concept);
    expect(items.map((i) => i.introDay)).toEqual([10, 20]);
    expect(introDayOf({ start: 0, span: 150 }, 0, 1)).toBe(0);
    expect(introDayOf({ start: 5, span: 100 }, 99, 100)).toBe(104);
  });
  it("文件名科目与字段科目不一致时报错", () => {
    expect(() => parsePool({ ...concept, name: "地理-x" })).toThrow(/不一致/);
  });
  it("数学概念进 prestudy，不进 FSRS", () => {
    const items = parsePool({ name: "数学-七上概念", json: { 科目: "数学", 概念: [{ 编号: "数与式.有理数.1", 池: "standard", 重要概念: "x", 教材位置: "第一章", 题: [["数轴", "规定了原点、正方向和单位长度的直线叫作数轴。", "规定了原点、正方向和单位长度的直线叫作数轴"]] }] } });
    expect(items[0]).toMatchObject({ id: "prestudy:数学:数与式.有理数.1:0", kind: "prestudy", subtype: "definition" });
  });
  it("文言实词是 gloss 子型，答案即出处", () => {
    const items = parsePool({ name: "语文-七上-文言实词", json: { 科目: "语文", 概念: [{ 编号: "a", 池: "textbook", 重要概念: "x", 教材位置: "p42", 题: [["「期行」是什么意思？", "相约同行。期，约定。", "相约同行。期，约定。"]] }] } });
    expect(items[0]!.subtype).toBe("gloss");
  });
});

describe("词汇池", () => {
  const vocab = {
    name: "英语-七上-词汇",
    json: { 词: [
      { 词: "ability", 释义: "n. 能力；才能", 音标: "əˈbɪləti", 组: "本册新词", 课标重点: true, 单元: null, 教材页: 122 },
      { 词: "smart", 释义: "adj. 聪明的", 音标: "smɑːrt", 组: "小学段", 课标重点: false, 单元: null, 教材页: 130 },
    ] },
    audioWords: new Set(["smart"]),
  };
  it("课标重点进 standard，其余 textbook；只有真人录音的词开听写卡", () => {
    const items = parsePool(vocab);
    expect(items.map((i) => i.id)).toEqual(["vocab:ability", "vocab:smart", "listen:smart"]);
    expect(items[0]).toMatchObject({ kind: "vocab", pool: "standard", front: "ability", back: "n. 能力；才能", sourceRef: "英语七上 本册新词 PDF p122" });
    expect(items[2]).toMatchObject({ kind: "listen", pool: "textbook", front: "audio:smart", back: "smart", parentId: "vocab:smart" });
  });
});

describe("文件分类", () => {
  it("草稿与附属文件不产出条目", () => {
    expect(parsePool({ name: "草稿-语文七上文言注释", json: {} })).toEqual([]);
    expect(parsePool({ name: "英语-音标与拼读", json: { 词表: [] } })).toEqual([]);
  });
  it("科目从文件名取", () => {
    expect(subjectOf("道法-七上")).toBe("道法");
    expect(() => subjectOf("物理-x")).toThrow();
  });
});
