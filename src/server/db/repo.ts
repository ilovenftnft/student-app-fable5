/** 数据库读写。SQL 都在这一个文件；路由层不碰 SQL。 */
import type { DatabaseSync } from "node:sqlite";
import type { Item } from "../../shared/types.ts";
import { allItems } from "../content/store.ts";
import { fromRow, toRow, type CardState, type CardStateRow } from "../scheduler/fsrs.ts";
import type { Point } from "../content/chapters.ts";

// ---------- setting ----------
export function getSetting(db: DatabaseSync, key: string, dflt: string): string {
  const r = db.prepare("SELECT value FROM setting WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? dflt;
}
export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
export const DEFAULT_CONTENT_START = "2026-09-07";
export function contentStart(db: DatabaseSync): string {
  return getSetting(db, "content_start", DEFAULT_CONTENT_START);
}

// ---------- item / card_state ----------
let itemCache: { db: DatabaseSync; items: Item[] } | null = null;
export function items(db: DatabaseSync): Item[] {
  if (!itemCache || itemCache.db !== db) itemCache = { db, items: allItems(db) };
  return itemCache.items;
}
export function invalidateItems(): void { itemCache = null; }

export function cardStates(db: DatabaseSync): Map<string, CardState> {
  const rows = db.prepare("SELECT * FROM card_state").all() as unknown as CardStateRow[];
  return new Map(rows.map((r) => [r.item_id, fromRow(r)]));
}

export function saveCardState(db: DatabaseSync, s: CardState): void {
  const r = toRow(s);
  db.prepare(`INSERT INTO card_state (item_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, archived, pass_streak, last_pass_session)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET due=excluded.due, stability=excluded.stability, difficulty=excluded.difficulty, elapsed_days=excluded.elapsed_days,
      scheduled_days=excluded.scheduled_days, learning_steps=excluded.learning_steps, reps=excluded.reps, lapses=excluded.lapses, state=excluded.state,
      last_review=excluded.last_review, archived=excluded.archived, pass_streak=excluded.pass_streak, last_pass_session=excluded.last_pass_session`)
    .run(r.item_id, r.due, r.stability, r.difficulty, r.elapsed_days, r.scheduled_days, r.learning_steps, r.reps, r.lapses, r.state, r.last_review, r.archived, r.pass_streak, r.last_pass_session);
}

// ---------- session ----------
export interface SessionRow { id: number; date: string; started_at: string; ended_at: string | null; minutes: number | null; ended_by: string | null }

export function sessionOn(db: DatabaseSync, date: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM session WHERE date = ?").get(date) as SessionRow | undefined;
}
export function startSession(db: DatabaseSync, date: string, now: Date): SessionRow {
  const existing = sessionOn(db, date);
  if (existing) return existing;
  db.prepare("INSERT INTO session (date, started_at) VALUES (?, ?)").run(date, now.toISOString());
  return sessionOn(db, date)!;
}
export function endSession(db: DatabaseSync, id: number, now: Date, by: "user" | "hard_stop"): void {
  const s = db.prepare("SELECT started_at FROM session WHERE id = ?").get(id) as { started_at: string };
  const minutes = Math.floor((now.getTime() - Date.parse(s.started_at)) / 60_000);
  db.prepare("UPDATE session SET ended_at = ?, minutes = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL").run(now.toISOString(), minutes, by, id);
}
export function sessionsBetween(db: DatabaseSync, from: string, to: string): SessionRow[] {
  return db.prepare("SELECT * FROM session WHERE date >= ? AND date <= ? ORDER BY date").all(from, to) as unknown as SessionRow[];
}

// ---------- chapter / checkin / recall ----------
export interface ChapterRow { id: string; subject_id: string; parent_id: string | null; title: string; sort: number; page: number | null; points: string }
export interface ChapterNode { id: string; title: string; page: number | null; points: Point[]; children: ChapterNode[] }

/** 全部科目的章节树：{ 科目: 根节点[] }。路径里不放中文（本机代理会改写编码后的路径）。 */
export function chapterTrees(db: DatabaseSync): Record<string, ChapterNode[]> {
  const rows = db.prepare("SELECT * FROM chapter ORDER BY subject_id, sort").all() as unknown as ChapterRow[];
  const nodes = new Map<string, ChapterNode>();
  for (const r of rows) nodes.set(r.id, { id: r.id, title: r.title, page: r.page, points: JSON.parse(r.points), children: [] });
  const out: Record<string, ChapterNode[]> = {};
  for (const r of rows) {
    const n = nodes.get(r.id)!;
    if (r.parent_id && nodes.has(r.parent_id)) nodes.get(r.parent_id)!.children.push(n);
    else (out[r.subject_id] ??= []).push(n);
  }
  return out;
}
export function chapter(db: DatabaseSync, id: string): ChapterRow | undefined {
  return db.prepare("SELECT * FROM chapter WHERE id = ?").get(id) as ChapterRow | undefined;
}

export function checkins(db: DatabaseSync, sessionId: number): string[] {
  return (db.prepare("SELECT chapter_id FROM checkin WHERE session_id = ?").all(sessionId) as { chapter_id: string }[]).map((r) => r.chapter_id);
}
export function setCheckins(db: DatabaseSync, sessionId: number, chapterIds: string[]): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM checkin WHERE session_id = ?").run(sessionId);
    const ins = db.prepare("INSERT INTO checkin (session_id, chapter_id) VALUES (?, ?)");
    for (const id of new Set(chapterIds)) if (chapter(db, id)) ins.run(sessionId, id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export interface RecallRow { id: number; session_id: number; chapter_id: string; think_ms: number; missed: string; due_date: string | null }
export function recalls(db: DatabaseSync, sessionId: number): RecallRow[] {
  return db.prepare("SELECT * FROM recall WHERE session_id = ?").all(sessionId) as unknown as RecallRow[];
}
export function saveRecall(db: DatabaseSync, sessionId: number, chapterId: string, thinkMs: number, missed: number[], dueDate: string | null): void {
  db.prepare("INSERT INTO recall (session_id, chapter_id, think_ms, missed, due_date) VALUES (?, ?, ?, ?, ?)").run(sessionId, chapterId, thinkMs, JSON.stringify(missed), dueDate);
}
/** 到期的"昨天没想起来的要点"（回想页顶部先看一眼） */
export function recallCarry(db: DatabaseSync, date: string): { chapterId: string; title: string; points: Point[] }[] {
  const rows = db.prepare("SELECT r.chapter_id, r.missed, c.title, c.points FROM recall r JOIN chapter c ON c.id = r.chapter_id WHERE r.due_date = ?").all(date) as unknown as { chapter_id: string; missed: string; title: string; points: string }[];
  return rows.map((r) => {
    const all = JSON.parse(r.points) as Point[];
    const idx = JSON.parse(r.missed) as number[];
    return { chapterId: r.chapter_id, title: r.title, points: idx.map((i) => all[i]).filter((p): p is Point => !!p) };
  }).filter((r) => r.points.length > 0);
}

// ---------- review / reflection ----------
export function recordReview(db: DatabaseSync, itemId: string, sessionId: number | null, rating: number, knew: boolean, elapsedMs: number, now: Date): void {
  db.prepare("INSERT INTO review (item_id, session_id, rating, knew, elapsed_ms, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)").run(itemId, sessionId, rating, knew ? 1 : 0, elapsedMs, now.toISOString());
}
export function recentElapsed(db: DatabaseSync, itemId: string, n = 5): number[] {
  return (db.prepare("SELECT elapsed_ms FROM review WHERE item_id = ? AND knew = 1 ORDER BY id DESC LIMIT ?").all(itemId, n) as { elapsed_ms: number }[]).map((r) => r.elapsed_ms);
}
export function itemsInSession(db: DatabaseSync, sessionId: number): { itemId: string; front: string }[] {
  return (db.prepare("SELECT DISTINCT r.item_id, i.front FROM review r JOIN item i ON i.id = r.item_id WHERE r.session_id = ? ORDER BY r.id").all(sessionId) as { item_id: string; front: string }[]).map((r) => ({ itemId: r.item_id, front: r.front }));
}
export function reviewsInSession(db: DatabaseSync, sessionId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM review WHERE session_id = ?").get(sessionId) as { n: number }).n;
}
export function elapsedInSession(db: DatabaseSync, sessionId: number): number {
  return (db.prepare("SELECT COALESCE(SUM(elapsed_ms), 0) AS ms FROM review WHERE session_id = ?").get(sessionId) as { ms: number }).ms;
}
export interface ReviewJoin { item_id: string; rating: number; subject_id: string; meta: string; parent_id: string | null }
export function reviewsBetween(db: DatabaseSync, from: string, to: string): ReviewJoin[] {
  return db.prepare(`SELECT r.item_id, r.rating, i.subject_id, i.meta, i.parent_id FROM review r JOIN item i ON i.id = r.item_id
    JOIN session s ON s.id = r.session_id WHERE s.date >= ? AND s.date <= ?`).all(from, to) as unknown as ReviewJoin[];
}

export interface ReflectionRow { session_id: number; hardest: string | null; guessed: string | null; tomorrow: string | null }
export function reflection(db: DatabaseSync, sessionId: number): ReflectionRow | undefined {
  return db.prepare("SELECT * FROM reflection WHERE session_id = ?").get(sessionId) as ReflectionRow | undefined;
}
export function saveReflection(db: DatabaseSync, r: ReflectionRow): void {
  db.prepare("INSERT INTO reflection (session_id, hardest, guessed, tomorrow) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET hardest=excluded.hardest, guessed=excluded.guessed, tomorrow=excluded.tomorrow")
    .run(r.session_id, r.hardest, r.guessed, r.tomorrow);
}

/** 明天到期的卡数（结束页文案用） */
export function dueTomorrowCount(db: DatabaseSync, tomorrowEndIso: string, todayEndIso: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM card_state WHERE archived = 0 AND due > ? AND due <= ?").get(todayEndIso, tomorrowEndIso) as { n: number }).n;
}

// ---------- exam_score（MVP #6） ----------
export interface ExamScore {
  id: number; date: string; name: string; subject_id: string; score: number; full_score: number;
  class_rank: number | null; class_size: number | null; grade_rank: number | null; grade_size: number | null;
}
export function examScores(db: DatabaseSync): ExamScore[] {
  return db.prepare("SELECT * FROM exam_score ORDER BY date, subject_id").all() as unknown as ExamScore[];
}
export function addExamScore(db: DatabaseSync, e: Omit<ExamScore, "id">): number {
  const r = db.prepare("INSERT INTO exam_score (date, name, subject_id, score, full_score, class_rank, class_size, grade_rank, grade_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.date, e.name, e.subject_id, e.score, e.full_score, e.class_rank, e.class_size, e.grade_rank, e.grade_size);
  return Number(r.lastInsertRowid);
}
export function deleteExamScore(db: DatabaseSync, id: number): void {
  db.prepare("DELETE FROM exam_score WHERE id = ?").run(id);
}

// ---------- 开场页 / 结束页用 ----------
export interface SessionReviewRow { item_id: string; subject_id: string; kind: string; front: string; rating: number; knew: number }
export function reviewsWithItems(db: DatabaseSync, sessionId: number): SessionReviewRow[] {
  return db.prepare("SELECT r.item_id, i.subject_id, i.kind, i.front, r.rating, r.knew FROM review r JOIN item i ON i.id = r.item_id WHERE r.session_id = ? ORDER BY r.id").all(sessionId) as unknown as SessionReviewRow[];
}
export function explanationsBetween(db: DatabaseSync, from: string, to: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM explanation WHERE date >= ? AND date <= ? AND status != 'failed'").get(from, to) as { n: number }).n;
}
