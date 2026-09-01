import { describe, expect, it } from "vitest";
import { TextbookText, normalize, verifyQuote, verifyVocab } from "../../src/server/content/verify.ts";

describe("normalize", () => {
  it("去空白与标点，全角转半角，ASCII 小写", () => {
    expect(normalize("正数大于 0，0 大于负数；（2）两个负数")).toBe("正数大于00大于负数2两个负数");
    expect(normalize("Ａbility /əˈbɪləti/ n. 能力；才能")).toBe("abilityəˈbɪlətin能力才能");
    expect(normalize("“上北下南，左西右东”")).toBe("上北下南左西右东");
  });
});

const raw = `===== PDFPAGE 1 =====
图例一般附在地图上，它是地理事物或现象在地图上的表示符号。
===== PDFPAGE 2 =====
指向标箭头的指西北东北向一般为北向。
ability /əˈbɪləti/ n. 能力；才能
across /əˈkrɒs/ adv. & prep.
在（……）对面；横过
`;
const text = new TextbookText(raw);

describe("verifyQuote", () => {
  it("逐字命中为 ok，标点与空白差异不影响", () => {
    expect(verifyQuote("图例一般附在地图上,它是地理事物或现象在地图上的表示符号", text)).toEqual({ status: "ok" });
  });
  it("核不上为 missing", () => {
    expect(verifyQuote("图例一般附在地球上", text)).toEqual({ status: "missing" });
    expect(verifyQuote("", text)).toEqual({ status: "missing" });
  });
  it("命中出处例外时放行并记录例外键", () => {
    const ex = { 指向标箭头的指向一般为北向: "OCR 把插图方位字混进正文" };
    expect(verifyQuote("有的地图用指向标指示方向，指向标箭头的指向一般为北向。", text, ex)).toEqual({ status: "exception", exception: "指向标箭头的指向一般为北向" });
  });
});

describe("verifyVocab", () => {
  it("词与释义各段同页即 ok，不要求同行", () => {
    expect(verifyVocab("ability", "n. 能力；才能", 2, text)).toEqual({ status: "ok" });
    expect(verifyVocab("across", "adv. & prep. 在（……）对面；横过", 2, text)).toEqual({ status: "ok" });
  });
  it("页错、词错、释义错都是 missing", () => {
    expect(verifyVocab("ability", "n. 能力；才能", 1, text)).toEqual({ status: "missing" });
    expect(verifyVocab("ability", "n. 能力；才能", undefined, text)).toEqual({ status: "missing" });
    expect(verifyVocab("abilities", "n. 能力", 2, text)).toEqual({ status: "missing" });
    expect(verifyVocab("ability", "n. 才干", 2, text)).toEqual({ status: "missing" });
  });
});
