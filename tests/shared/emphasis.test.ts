import { describe, expect, it } from "vitest";
import { emphasize, emphasizeFor, terms } from "../../src/shared/emphasis.ts";

describe("回想要点的概念词", () => {
  it("text 是短术语且在原句里 → 高亮它", () => {
    expect(terms("有理数", "可以写成分数形式的数称为有理数")).toEqual(["有理数"]);
    expect(emphasize("有理数", "可以写成分数形式的数称为有理数")).toEqual([{ s: "可以写成分数形式的数称为", term: false }, { s: "有理数", term: true }]);
  });
  it("顿号分开的几个术语都高亮；有定义处就只标定义处那一个", () => {
    const q = "像3这样大于0的数叫作正数，像-3这样在正数前加上符号“-”的数叫作负数";
    expect(terms("正数、负数", q).sort()).toEqual(["正数", "负数"]);
    expect(emphasize("正数、负数", q)).toEqual([
      { s: "像3这样大于0的数叫作", term: false }, { s: "正数", term: true },
      { s: "，像-3这样在正数前加上符号“-”的数叫作", term: false }, { s: "负数", term: true },
    ]);
    expect(emphasize("整数分成哪几类", "正整数、0、负整数统称为整数")).toEqual([{ s: "正整数、0、负整数统称为", term: false }, { s: "整数", term: true }]);
    expect(emphasize("乘方", "求n个相同乘数的积的运算，叫作乘方，乘方的结果叫作幂").filter((x) => x.term).map((x) => x.s)).toEqual(["乘方", "幂"]);
  });
  it("没有定义处的词，每处都标", () => {
    expect(emphasize("细胞", "细胞是生物体的基本单位，细胞很小").filter((x) => x.term).map((x) => x.s)).toEqual(["细胞", "细胞"]);
  });
  it("text 是问句时不按 text 找，但原句里的“统称为 X”仍高亮", () => {
    expect(terms("整数分成哪几类", "正整数、0、负整数统称为整数")).toEqual(["整数"]);
    expect(terms("数轴的正方向怎么规定", "通常规定直线上从原点向右（或上）为正方向")).toEqual([]);
  });
  it("叫作 / 叫 / 合称 / 史称 / 称之为 后面的被定义词", () => {
    expect(terms("乘方", "求n个相同乘数的积的运算，叫作乘方，乘方的结果叫作幂").sort()).toEqual(["乘方", "幂"]);
    expect(terms("底数、指数", "在an中，a叫作底数，n叫作指数").sort()).toEqual(["底数", "指数"]);
    expect(terms("大陆和它附近的岛屿合称大洲。", "其中面积广大的陆地叫大陆，面积较小的陆地叫岛屿。大陆和它附近的岛屿，合称大洲。").sort()).toEqual(["大洲", "大陆", "岛屿"]);
    expect(terms("史称“战国七雄”", "其中，齐、楚、燕、韩、赵、魏、秦七国的势力较强，史称“战国七雄”。")).toEqual(["战国七雄"]);
    expect(terms("地球公转", "这种转动称之为地球公转")).toEqual(["地球公转"]);
  });
  it("两条都命中且互相包含时留短的", () => {
    expect(terms("绝对值", "一般地，数轴上表示数a的点与原点的距离叫作数a的绝对值")).toEqual(["绝对值"]);
  });
  it("整条要点就是那个词（语文生字词、英语单词）不高亮", () => {
    expect(terms("朗润", "朗润")).toEqual([]);
    expect(terms("greet v. 招呼；问候", "greet")).toEqual([]);
    expect(emphasize("朗润", "朗润")).toEqual([{ s: "朗润", term: false }]);
  });
  it("长句摘要没有定义词就不高亮", () => {
    expect(terms("观察是学习生物学的基本方法。", "观察是学习生物学的基本方法。")).toEqual([]);
    expect(terms("元谋人距今约170万年，是我国已知最早古人类之一", "元谋人是我国境内目前已知最早的古人类之一，距今约170万年。")).toEqual([]);
  });
  it("text 带空格也能对上原句", () => {
    expect(terms("科学记数法", "把一个大于10的数表示成a×10n的形式，使用的是科学记数法")).toEqual(["科学记数法"]);
    expect(terms("0 的相反数", "0的相反数是0")).toEqual(["0的相反数"]);
  });
  it("只有数学标；其他科目原样返回", () => {
    expect(emphasizeFor("数学", "有理数", "可以写成分数形式的数称为有理数").some((x) => x.term)).toBe(true);
    expect(emphasizeFor("生物", "细胞质", "细胞膜以内、细胞核以外的部分叫细胞质")).toEqual([{ s: "细胞膜以内、细胞核以外的部分叫细胞质", term: false }]);
    expect(emphasizeFor("地理", "经纬网", "由经线与纬线相互交织所构成的网络，叫作经纬网。")).toEqual([{ s: "由经线与纬线相互交织所构成的网络，叫作经纬网。", term: false }]);
  });
});
