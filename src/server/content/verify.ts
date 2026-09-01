/**
 * 出处核对（硬约束 7）：source_quote 必须逐字出现在教材文本里。
 * 比对前做归一化——去掉空白与标点，只留汉字/字母/数字。OCR 文本的标点不可靠，但字序与用字必须一致。
 *
 * 三级，每级仍是逐字，只是允许的"断开处"不同：
 *   exact    整句连续命中
 *   segments 按 "……" / "；" 切段后每段连续命中（原句用省略号拼接不相邻的句子、编号列表被序号打断）
 *   clauses  按所有标点切成词组后每个 ≥2 字的词组命中（OCR 把插图字、页眉、分栏行序混进正文）
 * 内容池里的「出处例外」是已人工核过原页的 OCR 错误，按例外放行并记录。
 */
import type { Item } from "../../shared/types.ts";

/** 归一化：去空白与标点，ASCII 转小写，全角字母数字转半角。 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** 语文 PDF 文字层把课下注释的标号（a–z）夹在正文里："东临 b 碣石 c"。去掉孤立的单个小写字母。 */
export function stripNoteMarks(raw: string): string {
  return raw.replace(/(^|[^A-Za-z0-9])[a-z](?=$|[^A-Za-z0-9])/gm, "$1");
}

export type VerifyLevel = "exact" | "segments" | "clauses";
export type VerifyStatus = "ok" | "exception" | "missing";

export interface VerifyResult {
  status: VerifyStatus;
  level?: VerifyLevel;
  /** 例外时：命中的例外键 */
  exception?: string;
}

export interface TextbookOptions {
  /** 去注释标号（语文文字层用） */
  stripNoteMarks?: boolean;
  /** 去掉只含页码引用的行（英语词表的 "p.36"），它们把释义从中间隔开 */
  dropPageRefs?: boolean;
}

/** 单独一行的页码引用。 */
export function dropPageRefs(raw: string): string {
  return raw.replace(/^p\.\s*\d+\s*$/gm, "");
}

/** 教材文本：整本 + 按 PDF 页切分（页标记 `===== PDFPAGE n =====`）。 */
export class TextbookText {
  readonly whole: string;
  readonly pages: Map<number, string>;
  constructor(raw: string, opts: TextbookOptions = {}) {
    if (opts.stripNoteMarks) raw = stripNoteMarks(raw);
    if (opts.dropPageRefs) raw = dropPageRefs(raw);
    this.pages = new Map();
    const parts = raw.split(/^===== PDFPAGE (\d+) =====$/m);
    for (let i = 1; i < parts.length; i += 2) {
      this.pages.set(Number(parts[i]), normalize(parts[i + 1] ?? ""));
    }
    this.whole = normalize(raw);
  }
  page(n: number): string | undefined {
    return this.pages.get(n);
  }
}

const MIN_CLAUSE = 2;

function allFound(parts: string[], hay: string, min = 1): boolean {
  const ps = parts.map(normalize).filter((p) => p.length >= min);
  return ps.length > 0 && ps.every((p) => hay.includes(p));
}

export function verifyQuote(
  quote: string,
  text: TextbookText,
  exceptions: Record<string, string> = {},
): VerifyResult {
  const q = normalize(quote);
  if (q.length === 0) return { status: "missing" };
  if (text.whole.includes(q)) return { status: "ok", level: "exact" };
  if (allFound(quote.split(/……|…|[;；]/), text.whole)) return { status: "ok", level: "segments" };
  if (allFound(quote.split(/[^\p{L}\p{N}]+/u), text.whole, MIN_CLAUSE)) return { status: "ok", level: "clauses" };
  for (const key of Object.keys(exceptions)) {
    if (quote.includes(key)) return { status: "exception", exception: key };
  }
  return { status: "missing" };
}

/**
 * 词汇：词与释义按空格/分号切成 token，每个 token 都要出现在指定 PDF 页上。
 * 文本层按坐标抽取时行会打乱（词性、释义、页码引用各占一行），所以只要求同页。
 */
export function verifyVocab(word: string, gloss: string, page: number | undefined, text: TextbookText): VerifyResult {
  const p = page === undefined ? undefined : text.page(page);
  if (p === undefined) return { status: "missing" };
  const tokens = (s: string) => s.split(/[;；\s]+/);
  if (!allFound(tokens(word), p)) return { status: "missing" };
  const g = tokens(gloss).map(normalize).filter((t) => t.length > 0);
  if (g.every((t) => p.includes(t))) return { status: "ok", level: "exact" };
  // 释义被分栏/换行打断：按词组核对
  if (allFound(gloss.split(/[^\p{L}\p{N}]+/u), p, MIN_CLAUSE)) return { status: "ok", level: "clauses" };
  return { status: "missing" };
}

/** 按条目种类分发。 */
export function verifyItem(item: Item, text: TextbookText, exceptions: Record<string, string> = {}): VerifyResult {
  if (item.kind === "vocab" || item.kind === "listen") {
    const m = /PDF p(\d+)/.exec(item.sourceRef);
    return verifyVocab(String(item.meta.词 ?? ""), String(item.meta.释义 ?? ""), m ? Number(m[1]) : undefined, text);
  }
  return verifyQuote(item.sourceQuote, text, exceptions);
}
