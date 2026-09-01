/**
 * 出处核对（硬约束 7）：source_quote 必须逐字出现在教材文本里。
 * 比对前做归一化——去掉空白与标点，只留汉字/字母/数字。OCR 文本的标点不可靠，
 * 但字序与用字必须一致。内容池里的「出处例外」是已人工核过原页的 OCR 错误，按例外放行并记录。
 */
import type { Item } from "../../shared/types.ts";

/** 归一化：去空白与标点，ASCII 转小写，全角字母数字转半角。 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export type VerifyStatus = "ok" | "exception" | "missing";

export interface VerifyResult {
  status: VerifyStatus;
  /** 例外时：命中的例外键 */
  exception?: string;
}

/** 教材文本：整本 + 按 PDF 页切分（页标记 `===== PDFPAGE n =====`）。 */
export class TextbookText {
  readonly whole: string;
  readonly pages: Map<number, string>;
  constructor(raw: string) {
    this.pages = new Map();
    const parts = raw.split(/^===== PDFPAGE (\d+) =====$/m);
    // parts: [before, n1, text1, n2, text2, ...]
    for (let i = 1; i < parts.length; i += 2) {
      this.pages.set(Number(parts[i]), normalize(parts[i + 1] ?? ""));
    }
    this.whole = normalize(raw);
  }
  page(n: number): string | undefined {
    return this.pages.get(n);
  }
}

export function verifyQuote(
  quote: string,
  text: TextbookText,
  exceptions: Record<string, string> = {},
): VerifyResult {
  const q = normalize(quote);
  if (q.length === 0) return { status: "missing" };
  if (text.whole.includes(q)) return { status: "ok" };
  for (const key of Object.keys(exceptions)) {
    if (quote.includes(key)) return { status: "exception", exception: key };
  }
  return { status: "missing" };
}

/**
 * 词汇：词与释义的每个分号段都要出现在指定 PDF 页上。
 * 文本层按坐标抽取时行会打乱，所以只要求同页、不要求同行。
 */
export function verifyVocab(word: string, gloss: string, page: number | undefined, text: TextbookText): VerifyResult {
  const p = page === undefined ? undefined : text.page(page);
  if (p === undefined) return { status: "missing" };
  if (!p.includes(normalize(word))) return { status: "missing" };
  const segs = gloss.split(/[;；]/).map(normalize).filter((s) => s.length > 0);
  return segs.every((s) => p.includes(s)) ? { status: "ok" } : { status: "missing" };
}

/** 按条目种类分发。 */
export function verifyItem(item: Item, text: TextbookText, exceptions: Record<string, string> = {}): VerifyResult {
  if (item.kind === "vocab" || item.kind === "listen") {
    const m = /PDF p(\d+)/.exec(item.sourceRef);
    return verifyVocab(String(item.meta.词 ?? ""), String(item.meta.释义 ?? ""), m ? Number(m[1]) : undefined, text);
  }
  return verifyQuote(item.sourceQuote, text, exceptions);
}
