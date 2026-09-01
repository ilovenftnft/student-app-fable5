/** inbox_photo / problem 的读写。 */
import type { DatabaseSync } from "node:sqlite";
import type { ProblemDraft } from "./recognize.ts";

export interface PhotoRow { id: number; path: string; sha256: string; status: string; attempts: number; retry_at: string | null; error: string | null; created_at: string }
export interface ProblemRow {
  id: number; photo_id: number; subject_id: string | null; stem: string; answer: string | null; tags: string; needs_figure: number;
  crop: string | null; teacher_mark: string | null; confidence: number | null; status: string; item_id: string | null; raw: string;
}

export function photoBySha(db: DatabaseSync, sha: string): PhotoRow | undefined {
  return db.prepare("SELECT * FROM inbox_photo WHERE sha256 = ?").get(sha) as PhotoRow | undefined;
}
export function addPhoto(db: DatabaseSync, path: string, sha: string): PhotoRow {
  db.prepare("INSERT INTO inbox_photo (path, sha256, status) VALUES (?, ?, 'queued')").run(path, sha);
  return photoBySha(db, sha)!;
}
export function photos(db: DatabaseSync): PhotoRow[] {
  return db.prepare("SELECT * FROM inbox_photo ORDER BY id DESC").all() as unknown as PhotoRow[];
}
/** 下一张该处理的：queued，或 retry_later 且到了重试时间 */
export function nextPhoto(db: DatabaseSync, now: Date): PhotoRow | undefined {
  return db.prepare("SELECT * FROM inbox_photo WHERE status = 'queued' OR (status = 'retry_later' AND retry_at <= ?) ORDER BY id LIMIT 1").get(now.toISOString()) as PhotoRow | undefined;
}
export function setPhotoStatus(db: DatabaseSync, id: number, status: PhotoRow["status"], patch: { attempts?: number; retry_at?: string | null; error?: string | null } = {}): void {
  db.prepare("UPDATE inbox_photo SET status = ?, attempts = COALESCE(?, attempts), retry_at = ?, error = ? WHERE id = ?").run(status, patch.attempts ?? null, patch.retry_at ?? null, patch.error ?? null, id);
}

export function addProblems(db: DatabaseSync, photoId: number, drafts: ProblemDraft[]): number {
  const stmt = db.prepare("INSERT INTO problem (photo_id, subject_id, stem, answer, tags, needs_figure, crop, teacher_mark, confidence, status, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)");
  db.exec("BEGIN");
  try {
    for (const d of drafts) stmt.run(photoId, d.subject, d.stem, d.answer, JSON.stringify(d.tags), d.needsFigure ? 1 : 0, d.crop ? JSON.stringify(d.crop) : null, d.teacherMark, d.confidence, JSON.stringify(d.raw));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return drafts.length;
}
export function problems(db: DatabaseSync, status: string): (ProblemRow & { photo_path: string })[] {
  return db.prepare("SELECT p.*, f.path AS photo_path FROM problem p JOIN inbox_photo f ON f.id = p.photo_id WHERE p.status = ? ORDER BY p.id").all(status) as unknown as (ProblemRow & { photo_path: string })[];
}
export function problem(db: DatabaseSync, id: number): ProblemRow | undefined {
  return db.prepare("SELECT * FROM problem WHERE id = ?").get(id) as ProblemRow | undefined;
}
export function setProblem(db: DatabaseSync, id: number, patch: { status: string; item_id?: string | null; subject_id?: string | null; stem?: string; answer?: string | null; tags?: string[] }): void {
  db.prepare("UPDATE problem SET status = ?, item_id = COALESCE(?, item_id), subject_id = COALESCE(?, subject_id), stem = COALESCE(?, stem), answer = COALESCE(?, answer), tags = COALESCE(?, tags) WHERE id = ?")
    .run(patch.status, patch.item_id ?? null, patch.subject_id ?? null, patch.stem ?? null, patch.answer ?? null, patch.tags ? JSON.stringify(patch.tags) : null, id);
}
