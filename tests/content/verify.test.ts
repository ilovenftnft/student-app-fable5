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
    expect(verifyQuote("图例一般附在地图上,它是地理事物或现象在地图上的表示符号", text)).toEqual({ status: "ok", level: "exact" });
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

describe("verifyQuote 分级", () => {
  const t = new TextbookText("1. 先乘方，再乘除；\n2. 同级运算，从左到右。\n鸟的呼吸方式独特，具有气囊（图\n2-28），可辅助呼吸。");
  it("省略号 / 分号拼接的句子按段核对", () => {
    expect(verifyQuote("先乘方，再乘除；同级运算，从左到右。", t)).toEqual({ status: "ok", level: "segments" });
    expect(verifyQuote("先乘方，再乘除……从左到右。", t)).toEqual({ status: "ok", level: "segments" });
  });
  it("被插图字打断的句子按词组核对，单字不算", () => {
    expect(verifyQuote("鸟的呼吸方式独特，具有气囊，可辅助呼吸。", t)).toEqual({ status: "ok", level: "clauses" });
    expect(verifyQuote("鸟的呼吸方式独特，具有肺泡，可辅助呼吸。", t)).toEqual({ status: "missing" });
  });
  it("语文文字层的注释标号被去掉", () => {
    const zh = new TextbookText("东临 b 碣石 c，以观沧海。\nd〔舍去〕丢下（他）而离开。", { stripNoteMarks: true });
    expect(verifyQuote("东临碣石，以观沧海。", zh)).toEqual({ status: "ok", level: "exact" });
    expect(verifyQuote("丢下（他）而离开。", zh)).toEqual({ status: "ok", level: "exact" });
  });
});

describe("verifyVocab 换行与页码引用", () => {
  const t = new TextbookText("===== PDFPAGE 127 =====\nthan /ðæn; ðən/ prep. & conj.（用以\n\np.60\np.72\n\n引出比较的第二部分）比\nthem /ðem; ðəm/ pron.（they 的宾格）\n关于（某人）\n他（她、它）们\n", { dropPageRefs: true });
  it("页码行去掉后释义连上", () => {
    expect(verifyVocab("than", "prep. & conj. （用以引出比较的第二部分）比", 127, t)).toEqual({ status: "ok", level: "exact" });
  });
  it("被另一栏的行隔开时按词组核对", () => {
    expect(verifyVocab("them", "pron. （they的宾格）他（她、它）们", 127, t)).toEqual({ status: "ok", level: "clauses" });
  });
});

describe("verifyVocab", () => {
  it("词与释义各段同页即 ok，不要求同行", () => {
    expect(verifyVocab("ability", "n. 能力；才能", 2, text)).toEqual({ status: "ok", level: "exact" });
    expect(verifyVocab("across", "adv. & prep. 在（……）对面；横过", 2, text)).toEqual({ status: "ok", level: "exact" });
  });
  it("页错、词错、释义错都是 missing", () => {
    expect(verifyVocab("ability", "n. 能力；才能", 1, text)).toEqual({ status: "missing" });
    expect(verifyVocab("ability", "n. 能力；才能", undefined, text)).toEqual({ status: "missing" });
    expect(verifyVocab("abilities", "n. 能力", 2, text)).toEqual({ status: "missing" });
    expect(verifyVocab("ability", "n. 才干", 2, text)).toEqual({ status: "missing" });
  });
});
