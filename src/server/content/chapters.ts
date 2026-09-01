/**
 * 教材章节树（MVP #2）+ 每节要点（引导式回想的对照物）。
 * 文件：content/chapters/<科目>-七上.json
 *   { 科目, 教材版本, 节点: Node[] }
 *   Node = { 标题, pdf页?, 要点?: [{ 文, 出处 }], 子?: Node[] }
 * 叶子节点（节/课）是孩子勾选的单位；要点 3–5 条，"文"是给孩子看的短句，"出处"是教材原句，逐字核对（硬约束 7），核不上的要点不入库。
 */
import type { DatabaseSync } from "node:sqlite";
import type { Subject } from "../../shared/types.ts";
import { TextbookText, verifyQuote, type VerifyResult } from "./verify.ts";

export interface PointJson { 文: string; 出处: string }
export interface NodeJson { 标题: string; pdf页?: number; 要点?: PointJson[]; 子?: NodeJson[] }
export interface ChapterFile { 科目: Subject; 教材版本?: string; 出处例外?: Record<string, string>; 节点: NodeJson[] }

export interface Point { text: string; quote: string }
export interface ChapterRow {
  id: string; subject: Subject; parentId: string | null; title: string; sort: number; page: number | null; points: Point[];
}

export interface ChapterReport {
  rows: ChapterRow[];
  leaves: number;
  points: number;
  missing: { chapter: string; point: PointJson }[];
  levels: Record<string, number>;
}

export function flattenChapters(file: ChapterFile, text?: TextbookText): ChapterReport {
  const rows: ChapterRow[] = [];
  const missing: ChapterReport["missing"] = [];
  const levels: Record<string, number> = { exact: 0, segments: 0, clauses: 0, exception: 0 };
  let leaves = 0, points = 0;
  const walk = (nodes: NodeJson[], parentId: string | null, path: string[]) => {
    nodes.forEach((n, i) => {
      const id = `${file.科目}:${[...path, n.标题].join("/")}`;
      const kept: Point[] = [];
      for (const p of n.要点 ?? []) {
        let r: VerifyResult = { status: "ok", level: "exact" };
        if (text) r = verifyQuote(p.出处, text, file.出处例外 ?? {});
        if (r.status === "missing") { missing.push({ chapter: id, point: p }); continue; }
        levels[r.status === "exception" ? "exception" : r.level!]!++;
        kept.push({ text: p.文, quote: p.出处 });
      }
      points += kept.length;
      if (!n.子?.length) leaves++;
      rows.push({ id, subject: file.科目, parentId, title: n.标题, sort: i, page: n.pdf页 ?? null, points: kept });
      if (n.子?.length) walk(n.子, id, [...path, n.标题]);
    });
  };
  walk(file.节点, null, []);
  return { rows, leaves, points, missing, levels };
}

export function upsertChapters(db: DatabaseSync, rows: ChapterRow[]): number {
  const stmt = db.prepare(`
    INSERT INTO chapter (id, subject_id, parent_id, title, sort, page, points) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET subject_id=excluded.subject_id, parent_id=excluded.parent_id, title=excluded.title,
      sort=excluded.sort, page=excluded.page, points=excluded.points`);
  db.exec("BEGIN");
  try {
    for (const r of rows) stmt.run(r.id, r.subject, r.parentId, r.title, r.sort, r.page, JSON.stringify(r.points));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return rows.length;
}
