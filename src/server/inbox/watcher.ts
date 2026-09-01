/** ~/StudyInbox/ 监听：新图片 → 入库排队；后台 worker 每 15 秒处理一张。 */
import chokidar from "chokidar";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { mkdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { codexRecognizer, ingest, isImage, processNext, type Recognizer } from "./service.ts";

export const INBOX_DIR = process.env.INBOX_DIR ?? join(homedir(), "StudyInbox");

export function startInbox(db: DatabaseSync, opts: { dir?: string; recognize?: Recognizer; pollMs?: number } = {}): () => void {
  const dir = opts.dir ?? INBOX_DIR;
  mkdirSync(dir, { recursive: true });
  const watcher = chokidar.watch(dir, { ignoreInitial: false, depth: 0, awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 }, ignored: (p) => basename(p).startsWith(".") });
  watcher.on("add", (p) => {
    if (!isImage(p)) return;
    try {
      const { photo, duplicate } = ingest(db, p);
      console.log(`[inbox] ${duplicate ? "重复" : "入库"} ${basename(p)} → #${photo.id}`);
    } catch (e) { console.error(`[inbox] 入库失败 ${p}: ${String(e)}`); }
  });
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { await processNext(db, opts.recognize ?? codexRecognizer); } catch (e) { console.error(`[inbox] worker: ${String(e)}`); }
    busy = false;
  };
  const timer = setInterval(() => void tick(), opts.pollMs ?? 15_000);
  console.log(`[inbox] 监听 ${dir}`);
  return () => { clearInterval(timer); void watcher.close(); };
}
