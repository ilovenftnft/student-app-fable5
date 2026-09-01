import type { DatabaseSync } from "node:sqlite";
import type { Item } from "../../shared/types.ts";

/** 写入/覆盖条目。父卡先写，保证 parent_id 外键成立。 */
export function upsertItems(db: DatabaseSync, items: Item[]): number {
  const stmt = db.prepare(`
    INSERT INTO item (id, subject_id, kind, subtype, front, back, answer_points, source_quote, source_ref, pool, parent_id, intro_day, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subject_id=excluded.subject_id, kind=excluded.kind, subtype=excluded.subtype, front=excluded.front, back=excluded.back,
      answer_points=excluded.answer_points, source_quote=excluded.source_quote, source_ref=excluded.source_ref, pool=excluded.pool,
      parent_id=excluded.parent_id, intro_day=excluded.intro_day, meta=excluded.meta`);
  const ordered = [...items.filter((i) => !i.parentId), ...items.filter((i) => i.parentId)];
  db.exec("BEGIN");
  try {
    for (const it of ordered) {
      stmt.run(it.id, it.subject, it.kind, it.subtype, it.front, it.back,
        it.answerPoints ? JSON.stringify(it.answerPoints) : null,
        it.sourceQuote, it.sourceRef, it.pool, it.parentId ?? null, it.introDay, JSON.stringify(it.meta));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return ordered.length;
}

export interface ItemRow {
  id: string; subject_id: string; kind: string; subtype: string; front: string; back: string;
  answer_points: string | null; source_quote: string; source_ref: string; pool: string;
  parent_id: string | null; intro_day: number; meta: string;
}

export function allItems(db: DatabaseSync): Item[] {
  const rows = db.prepare("SELECT * FROM item ORDER BY intro_day, id").all() as unknown as ItemRow[];
  return rows.map((r) => ({
    id: r.id, subject: r.subject_id as Item["subject"], kind: r.kind as Item["kind"], subtype: r.subtype,
    front: r.front, back: r.back, answerPoints: r.answer_points ? JSON.parse(r.answer_points) : undefined,
    sourceQuote: r.source_quote, sourceRef: r.source_ref, pool: r.pool as Item["pool"],
    parentId: r.parent_id ?? undefined, introDay: r.intro_day, meta: JSON.parse(r.meta),
  }));
}
