import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/server/db/open.ts";
import { confirmProblem, ingest, processNext, rejectProblem, type Recognizer } from "../../src/server/inbox/service.ts";
import * as store from "../../src/server/inbox/store.ts";
import { allItems } from "../../src/server/content/store.ts";
import { createApp } from "../../src/server/app.ts";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync, dataDir: string, inboxDir: string;
beforeEach(() => {
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "data-"));
  inboxDir = mkdtempSync(join(tmpdir(), "inbox-"));
});
const photo = (name: string, content = "fake-jpg-" + name) => { const p = join(inboxDir, name); writeFileSync(p, content); return p; };
const okRecognizer: Recognizer = async () => ({ ok: true, elapsedMs: 1, json: { subject: "数学", page_summary: "", questions: [
  { number: "3", type: "填空", stem: "计算 $1+1$", options: [], teacher_mark: "wrong", reference_answer: "2", knowledge_points: ["有理数加法"], grade_chapter: "七上 第二章", difficulty: "基础", confidence: 0.9, needs_figure: false, bbox: [0, 0.1, 1, 0.2] },
  { number: "4", type: "选择", stem: "下列正确的是", options: ["A. 1", "B. 2"], teacher_mark: "none", reference_answer: "", knowledge_points: [], grade_chapter: "", difficulty: "基础", confidence: 0.7, needs_figure: false, bbox: [] },
] } });

describe("收件箱", () => {
  it("入库：拷到 DATA_DIR/photos，路径相对存，sha 去重", () => {
    const a = ingest(db, photo("a.jpg"), dataDir);
    expect(a.duplicate).toBe(false);
    expect(a.photo.path).toMatch(/^photos\/[0-9a-f]{64}\.jpg$/);
    expect(existsSync(join(dataDir, a.photo.path))).toBe(true);
    const again = ingest(db, photo("a-copy.jpg", "fake-jpg-a.jpg"), dataDir);
    expect(again.duplicate).toBe(true);
    expect(readdirSync(join(dataDir, "photos"))).toHaveLength(1);
    expect(store.photos(db)).toHaveLength(1);
  });
  it("识题成功 → 待确认；老师打 ✗ 的排前面", async () => {
    ingest(db, photo("a.jpg"), dataDir);
    expect(await processNext(db, okRecognizer, new Date(), dataDir)).toBe(true);
    expect(store.photos(db)[0]!.status).toBe("done");
    const pending = store.problems(db, "pending");
    expect(pending).toHaveLength(2);
    expect(pending[0]!.teacher_mark).toBe("✗");
    expect(pending[1]!.stem).toBe("下列正确的是\nA. 1\nB. 2");
    expect(await processNext(db, okRecognizer, new Date(), dataDir)).toBe(false);
  });
  it("Codex 不可用：照片仍入库，队列显示稍后重试；额度触顶按重置时间重试；5 次后失败", async () => {
    ingest(db, photo("a.jpg"), dataDir);
    const now = new Date("2026-09-07T10:00:00Z");
    await processNext(db, async () => ({ ok: false, error: "spawn codex ENOENT", elapsedMs: 1 }), now, dataDir);
    let p = store.photos(db)[0]!;
    expect(p.status).toBe("retry_later");
    expect(p.retry_at).toBe("2026-09-07T10:10:00.000Z");
    expect(p.error).toMatch(/ENOENT/);
    // 没到重试时间不处理
    expect(await processNext(db, okRecognizer, new Date("2026-09-07T10:05:00Z"), dataDir)).toBe(false);
    await processNext(db, async () => ({ ok: false, error: "quota", quotaResetAt: new Date("2026-09-08T00:00:00Z"), elapsedMs: 1 }), new Date("2026-09-07T10:20:00Z"), dataDir);
    p = store.photos(db)[0]!;
    expect(p.retry_at).toBe("2026-09-08T00:00:00.000Z");
    for (let i = 0; i < 3; i++) await processNext(db, async () => ({ ok: false, error: "x", elapsedMs: 1 }), new Date(Date.parse("2026-09-09T00:00:00Z") + i * 15 * 60_000), dataDir);
    expect(store.photos(db)[0]!.status).toBe("failed");
    expect(store.photos(db)[0]!.attempts).toBe(5);
  });
  it("确认成错题卡（kind=wrong，出处 = 照片与题号），拒绝不成卡", async () => {
    ingest(db, photo("a.jpg"), dataDir);
    await processNext(db, okRecognizer, new Date(), dataDir);
    const [p1, p2] = store.problems(db, "pending");
    const item = confirmProblem(db, p1!.id, { answer: "2" });
    expect(item).toMatchObject({ kind: "wrong", subject: "数学", front: "计算 $1+1$", back: "2", pool: "textbook" });
    expect(item.sourceRef).toMatch(/^照片 [0-9a-f]{64}\.jpg 第 3 题$/);
    expect(item.meta.重要概念).toBe("有理数加法");
    expect(allItems(db)).toHaveLength(1);
    expect(store.problem(db, p1!.id)!.status).toBe("confirmed");
    rejectProblem(db, p2!.id);
    expect(store.problems(db, "pending")).toHaveLength(0);
    expect(allItems(db)).toHaveLength(1);
  });
  it("API：待确认列表与确认", async () => {
    ingest(db, photo("a.jpg"), dataDir);
    await processNext(db, okRecognizer, new Date(), dataDir);
    const app = createApp(db, () => new Date("2026-09-07T09:00:00Z"));
    const list = await (await app.request("/api/parent/problems?status=pending")).json() as { id: number; teacherMark: string | null }[];
    expect(list).toHaveLength(2);
    expect(list[0]!.teacherMark).toBe("✗");
    const r = await app.request(`/api/parent/problems/${list[1]!.id}/confirm`, { method: "POST", body: JSON.stringify({ subject: "数学", answer: "B" }), headers: { "content-type": "application/json" } });
    expect(r.status).toBe(200);
    const inboxList = await (await app.request("/api/parent/inbox")).json() as { status: string }[];
    expect(inboxList[0]!.status).toBe("done");
  });
});
