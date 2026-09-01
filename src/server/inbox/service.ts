/**
 * 收件箱（验收 #4）：照片入库 → 排队 → 识题 → 待确认 → 家长确认后成错题卡。
 * 每日路径不依赖这里（硬约束 1）；Codex 不可用时照片仍入库、队列显示"稍后重试"。
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "../db/open.ts";
import { runCodex, type EngineResult } from "./engine.ts";
import { recognizePrompt } from "./prompt.ts";
import { toProblems, type Recognized } from "./recognize.ts";
import * as store from "./store.ts";
import { upsertItems } from "../content/store.ts";
import { invalidateItems } from "../db/repo.ts";
import type { Item, Subject } from "../../shared/types.ts";

export const SCHEMA_PATH = join(import.meta.dirname, "schema.json");
export const RECOGNIZE_DEADLINE_MS = 3 * 60_000;
export const MAX_ATTEMPTS = 5;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);

export function isImage(path: string): boolean {
  return IMAGE_EXT.has(extname(path).toLowerCase());
}

/** 新照片入库：按 sha256 去重，拷到 DATA_DIR/photos/<sha><ext>，路径相对 DATA_DIR 存。 */
export function ingest(db: DatabaseSync, srcPath: string, dataDir = DATA_DIR): { photo: store.PhotoRow; duplicate: boolean } {
  const buf = readFileSync(srcPath);
  const sha = createHash("sha256").update(buf).digest("hex");
  const existing = store.photoBySha(db, sha);
  if (existing) return { photo: existing, duplicate: true };
  const rel = join("photos", `${sha}${extname(srcPath).toLowerCase() || ".jpg"}`);
  mkdirSync(join(dataDir, "photos"), { recursive: true });
  copyFileSync(srcPath, join(dataDir, rel));
  return { photo: store.addPhoto(db, rel, sha), duplicate: false };
}

export type Recognizer = (imagePath: string) => Promise<EngineResult<Recognized>>;

export const codexRecognizer: Recognizer = (imagePath) =>
  runCodex<Recognized>({ image: imagePath, schemaPath: SCHEMA_PATH, prompt: recognizePrompt(), effort: "low", deadlineMs: RECOGNIZE_DEADLINE_MS });

/** 处理队列里的下一张。返回是否处理了一张。 */
export async function processNext(db: DatabaseSync, recognize: Recognizer, now = new Date(), dataDir = DATA_DIR): Promise<boolean> {
  const photo = store.nextPhoto(db, now);
  if (!photo) return false;
  store.setPhotoStatus(db, photo.id, "running", { attempts: photo.attempts + 1 });
  const r = await recognize(join(dataDir, photo.path));
  if (r.ok && r.json) {
    const drafts = toProblems(r.json);
    store.addProblems(db, photo.id, drafts);
    store.setPhotoStatus(db, photo.id, "done", { error: null });
    return true;
  }
  const attempts = photo.attempts + 1;
  if (r.quotaResetAt) {
    store.setPhotoStatus(db, photo.id, "retry_later", { retry_at: r.quotaResetAt.toISOString(), error: `额度用尽，${r.quotaResetAt.toISOString()} 后重试` });
  } else if (attempts >= MAX_ATTEMPTS) {
    store.setPhotoStatus(db, photo.id, "failed", { error: r.error ?? "未知错误" });
  } else {
    store.setPhotoStatus(db, photo.id, "retry_later", { retry_at: new Date(now.getTime() + 10 * 60_000).toISOString(), error: `${r.error ?? "未知错误"}（第 ${attempts} 次）` });
  }
  return true;
}

/** 家长确认：题目成错题卡（kind=wrong），出处 = 照片与题号。 */
export function confirmProblem(db: DatabaseSync, id: number, edit: { subject?: string; stem?: string; answer?: string; tags?: string[] } = {}): Item {
  const p = store.problem(db, id);
  if (!p) throw new Error(`没有这道题：${id}`);
  const subject = (edit.subject ?? p.subject_id) as Subject | null;
  if (!subject) throw new Error("确认前要先选科目");
  const raw = JSON.parse(p.raw) as { number?: string };
  const item: Item = {
    id: `wrong:${p.photo_id}:${p.id}`,
    subject, kind: "wrong", subtype: "redo",
    front: edit.stem ?? p.stem,
    back: edit.answer ?? p.answer ?? "（对照原作业订正）",
    sourceQuote: edit.stem ?? p.stem,
    sourceRef: `照片 ${basename((db.prepare("SELECT path FROM inbox_photo WHERE id = ?").get(p.photo_id) as { path: string }).path)} 第 ${raw.number ?? "?"} 题`,
    pool: "textbook",
    introDay: 0,
    meta: { 重要概念: (edit.tags ?? JSON.parse(p.tags))[0] ?? "", tags: edit.tags ?? JSON.parse(p.tags), needs_figure: !!p.needs_figure, crop: p.crop ? JSON.parse(p.crop) : null, photo_id: p.photo_id },
  };
  upsertItems(db, [item]);
  invalidateItems();
  store.setProblem(db, id, { status: "confirmed", item_id: item.id, subject_id: subject, stem: edit.stem, answer: edit.answer, tags: edit.tags });
  return item;
}

export function rejectProblem(db: DatabaseSync, id: number): void {
  store.setProblem(db, id, { status: "rejected" });
}
