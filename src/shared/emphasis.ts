/**
 * 回想要点里的概念词加粗换色（家长 2026-09-02 定）："可以写成分数形式的数称为有理数"里的"有理数"。
 * 只对数学开（家长 09-02 试用后定：其他科目的要点是整句摘要或词本身，标了没意义）。
 * 纯规则，不接 LLM：
 *  1. 要点的 `text` 是短术语（≤ 8 字、不是问句、顿号可分几个）且在原句里出现 → 高亮它；
 *  2. 原句里"叫作 / 叫做 / 称为 / 统称为 / 合称 / 史称 / 又称 / 记作 / 叫 …"后面的被定义词（到标点为止，≤ 12 字）。
 * 整条要点就是那个词本身（语文生字词、英语单词）不高亮；长句摘要（历史、地理、生物、道法）只靠第 2 条。
 * 两条都命中且互相包含时留短的那个（"数a的绝对值" 让位给 "绝对值"）。
 * 同一个词在句里出现多次：有紧跟在定义词后面的位置就只标那一处（"正整数、0、负整数统称为整数"只标最后一个），没有才全标。
 */
export type Segment = { s: string; term: boolean };

/** 哪些科目的要点标概念词 */
export const EMPHASIS_SUBJECTS: ReadonlySet<string> = new Set(["数学"]);
export function emphasizeFor(subject: string, text: string, quote: string): Segment[] {
  return EMPHASIS_SUBJECTS.has(subject) ? emphasize(text, quote) : [{ s: quote, term: false }];
}

const DEFINER_WORDS = "统称为|合称为|称之为|合称|称作|称为|叫作|叫做|简称|史称|又称|也称|或称|记作|叫";
const DEFINER = new RegExp(`(?:${DEFINER_WORDS})\\s*[“"]?([^，。；：、！？“”"（）()\\s]{1,12})`, "g");
const AFTER_DEFINER = new RegExp(`(?:${DEFINER_WORDS})\\s*[“"]?$`);
const QUESTION = /[哪什么怎吗？?几如何]/;

export function terms(text: string, quote: string): string[] {
  const out = new Set<string>();
  const q = quote.trim();
  if (!q) return [];
  for (const raw of text.split(/[、，,]/)) {
    const t = raw.replace(/\s+/g, "").replace(/[。！？]$/, "");
    if (!t || t.length > 8 || QUESTION.test(t) || t === q.replace(/\s+/g, "")) continue;
    if (q.includes(t)) out.add(t);
  }
  for (const m of q.matchAll(DEFINER)) {
    const t = m[1];
    if (t && t !== q) out.add(t);
  }
  const all = [...out];
  return all.filter((t) => !all.some((o) => o !== t && t.includes(o)));
}

export function emphasize(text: string, quote: string): Segment[] {
  const ts = terms(text, quote);
  if (ts.length === 0) return [{ s: quote, term: false }];
  const spans: { i: number; n: number }[] = [];
  for (const t of ts) {
    const at: number[] = [];
    for (let i = quote.indexOf(t); i >= 0; i = quote.indexOf(t, i + 1)) at.push(i);
    const defined = at.filter((i) => AFTER_DEFINER.test(quote.slice(0, i)));
    for (const i of defined.length ? defined : at) spans.push({ i, n: t.length });
  }
  spans.sort((a, b) => a.i - b.i || b.n - a.n);
  const segs: Segment[] = [];
  let last = 0;
  for (const { i, n } of spans) {
    if (i < last) continue; // 重叠的跳过
    if (i > last) segs.push({ s: quote.slice(last, i), term: false });
    segs.push({ s: quote.slice(i, i + n), term: true });
    last = i + n;
  }
  if (last < quote.length) segs.push({ s: quote.slice(last), term: false });
  return segs;
}
