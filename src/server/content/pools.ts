/**
 * 内容池 JSON → Item[]（纯函数，不碰文件系统与数据库）。
 * 格式见 AGENTS.md「内容池」。三种文件：默写（篇目[]）、概念（概念[]）、词汇（词[]）。
 * id 由内容确定性生成，重复入库覆盖同一行。
 */
import type { Item, Pool, Subject } from "../../shared/types.ts";

export interface PoolFile {
  /** 文件名（不含扩展名），如 `生物-七上第一单元`。科目取 `-` 前的部分。 */
  name: string;
  json: Record<string, unknown>;
  /** 有真人录音的词（小写）。只对这些词开听写卡。 */
  audioWords?: ReadonlySet<string>;
}

/** 文件级引入计划：从起点天开始，把条目均匀铺到跨度天内。 */
export interface IntroPlan {
  start: number;
  span: number;
}

export const DEFAULT_SPAN_DAYS = 150;

const SUBJECTS: ReadonlySet<string> = new Set(["语文", "数学", "英语", "历史", "地理", "生物", "道法"]);

export function subjectOf(name: string): Subject {
  const s = name.split("-")[0]!;
  if (!SUBJECTS.has(s)) throw new Error(`无法从文件名判断科目：${name}`);
  return s as Subject;
}

export function isDraft(name: string): boolean {
  return name.startsWith("草稿-");
}

/** 音标与拼读文件是词汇的附属数据，不单独产出条目。 */
export function isAuxiliary(name: string): boolean {
  return name === "英语-音标与拼读";
}

function introPlan(json: Record<string, unknown>): IntroPlan {
  const start = typeof json.引入起点天 === "number" ? json.引入起点天 : 0;
  const span = typeof json.引入跨度天 === "number" ? json.引入跨度天 : DEFAULT_SPAN_DAYS;
  return { start, span };
}

/** 第 i 条（共 n 条）的引入日。 */
export function introDayOf(plan: IntroPlan, i: number, n: number): number {
  if (n <= 1) return plan.start;
  return plan.start + Math.floor((i * plan.span) / n);
}

function asPool(v: unknown, where: string): Pool {
  if (v === "standard" || v === "textbook") return v;
  throw new Error(`池必须是 standard|textbook：${where}`);
}

export function parsePool(file: PoolFile): Item[] {
  if (isDraft(file.name) || isAuxiliary(file.name)) return [];
  const j = file.json;
  if (Array.isArray(j.篇目)) return parseRecitation(file);
  if (Array.isArray(j.概念)) return parseConcepts(file);
  if (Array.isArray(j.词)) return parseVocab(file);
  throw new Error(`未知的内容池格式：${file.name}`);
}

// ---------- 默写 ----------

interface Piece {
  标题: string;
  作者?: string;
  池: string;
  课标序号?: number;
  教材位置: string;
  教材要求?: string;
  句对: [string, string, string, string?][];
}

function fullSentence(pair: Piece["句对"][number]): string {
  return pair[3] ?? `${pair[0]}，${pair[1]}。`;
}

function parseRecitation(file: PoolFile): Item[] {
  const subject = subjectOf(file.name);
  const pieces = file.json.篇目 as Piece[];
  const plan = introPlan(file.json);
  const total = pieces.reduce((a, p) => a + p.句对.length, 0);
  const items: Item[] = [];
  let k = 0;
  for (const p of pieces) {
    const pool = asPool(p.池, p.标题);
    p.句对.forEach((pair, i) => {
      const fillId = `recitation:${p.标题}:${i}:fill`;
      const base = {
        subject,
        kind: "recitation" as const,
        sourceQuote: fullSentence(pair),
        sourceRef: `${subject}七上 ${p.教材位置}`,
        pool,
        introDay: introDayOf(plan, k++, total),
        meta: { 标题: p.标题, 作者: p.作者, 课标序号: p.课标序号, 教材要求: p.教材要求 },
      };
      items.push({ ...base, id: fillId, subtype: "fill", front: `${pair[0]}，______`, back: pair[1] });
      // 情境卡：接句卡归档后才出现，引入日随父卡
      items.push({
        ...base,
        id: `recitation:${p.标题}:${i}:context`,
        subtype: "context",
        front: pair[2],
        back: fullSentence(pair),
        parentId: fillId,
      });
    });
  }
  return items;
}

// ---------- 概念（生物/地理/道法/文言实词/数学预习） ----------

interface Concept {
  编号: string;
  池: string;
  题型?: string;
  重要概念: string;
  课标原文?: string;
  教材位置: string;
  题: [string, string | string[], string][];
}

function parseConcepts(file: PoolFile): Item[] {
  const subject = subjectOf(file.name);
  const j = file.json;
  if (typeof j.科目 === "string" && j.科目 !== subject) {
    throw new Error(`文件名科目 ${subject} 与字段科目 ${j.科目} 不一致：${file.name}`);
  }
  const concepts = j.概念 as Concept[];
  const plan = introPlan(j);
  const total = concepts.reduce((a, c) => a + c.题.length, 0);
  const isPrestudy = subject === "数学";
  const isGloss = file.name.includes("文言实词");
  const items: Item[] = [];
  let k = 0;
  for (const c of concepts) {
    const pool = asPool(c.池, c.编号);
    c.题.forEach(([front, answer, quote], i) => {
      const isTemplate = Array.isArray(answer) || c.题型 === "answer_template";
      const points = Array.isArray(answer) ? answer : undefined;
      const back = Array.isArray(answer) ? answer.join("；") : answer;
      items.push({
        id: `${isPrestudy ? "prestudy" : "concept"}:${subject}:${c.编号}:${i}`,
        subject,
        kind: isPrestudy ? "prestudy" : "concept",
        subtype: isPrestudy ? "definition" : isTemplate ? "answer_template" : isGloss ? "gloss" : "fill",
        front,
        back,
        answerPoints: points,
        sourceQuote: quote,
        sourceRef: `${subject}七上 ${c.教材位置}`,
        pool,
        introDay: introDayOf(plan, k++, total),
        meta: { 编号: c.编号, 重要概念: c.重要概念, 课标原文: c.课标原文 },
      });
    });
  }
  return items;
}

// ---------- 词汇 ----------

interface Word {
  词: string;
  释义: string;
  音标?: string | null;
  组: string;
  课标重点?: boolean;
  单元?: string | null;
  教材页?: number | null;
}

/** 词汇按组分别铺开：本册新词跟教学进度走一学期；小学段（课标二级词，默认"都没掌握"）摊到一年，家长决定 2026-09-01。 */
export const VOCAB_SPAN_BY_GROUP: Record<string, number> = { 本册新词: DEFAULT_SPAN_DAYS, 小学段: 365 };

function parseVocab(file: PoolFile): Item[] {
  const subject = subjectOf(file.name);
  const words = file.json.词 as Word[];
  const filePlan = introPlan(file.json);
  const groups = new Map<string, Word[]>();
  for (const w of words) groups.set(w.组, [...(groups.get(w.组) ?? []), w]);
  const items: Item[] = [];
  for (const [group, ws] of groups) {
    const plan = { start: filePlan.start, span: VOCAB_SPAN_BY_GROUP[group] ?? filePlan.span };
    ws.forEach((w, i) => {
      const introDay = introDayOf(plan, i, ws.length);
    const meta = { 词: w.词, 释义: w.释义, 音标: w.音标, 组: w.组, 课标重点: w.课标重点 ?? false, 单元: w.单元 };
    const common = {
      subject,
      // 课标重点词进 standard 池；其余教材词进 textbook 池
      pool: (w.课标重点 ? "standard" : "textbook") as Pool,
      sourceQuote: `${w.词} ${w.释义}`,
      sourceRef: `${subject}七上 ${w.组} PDF p${w.教材页 ?? "?"}`,
      introDay,
      meta,
    };
    items.push({ ...common, id: `vocab:${w.词}`, kind: "vocab", subtype: "word", front: w.词, back: w.释义 });
    if (file.audioWords?.has(w.词.toLowerCase())) {
      items.push({
        ...common,
        id: `listen:${w.词}`,
        kind: "listen",
        subtype: "word",
        front: `audio:${w.词}`,
        back: w.词,
        parentId: `vocab:${w.词}`,
      });
    }
    });
  }
  return items;
}
