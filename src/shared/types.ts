export type Subject = "语文" | "数学" | "英语" | "历史" | "地理" | "生物" | "道法";
export type ItemKind = "recitation" | "concept" | "vocab" | "listen" | "wrong" | "prestudy";
export type Pool = "standard" | "textbook";

/** 内容项。与 item 表一一对应；由内容池 JSON 确定性生成。 */
export interface Item {
  id: string;
  subject: Subject;
  kind: ItemKind;
  subtype: string;
  front: string;
  back: string;
  answerPoints?: string[];
  sourceQuote: string;
  sourceRef: string;
  pool: Pool;
  parentId?: string;
  introDay: number;
  meta: Record<string, unknown>;
}

/** 参与 FSRS 的种类。prestudy（数学概念预习）走"答对出本轮、答错次日再来"，不进 FSRS。 */
export const FSRS_KINDS: ReadonlySet<ItemKind> = new Set(["recitation", "concept", "vocab", "listen", "wrong"]);
