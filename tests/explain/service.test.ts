import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/server/db/open.ts";
import { upsertItems } from "../../src/server/content/store.ts";
import { createApp } from "../../src/server/app.ts";
import * as repo from "../../src/server/db/repo.ts";
import { prompt, retryDue, type Explainer } from "../../src/server/explain/service.ts";
import type { Item } from "../../src/shared/types.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";

const items: Item[] = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i}`, subject: "生物", kind: "concept", subtype: "fill", front: `问 ${i}`, back: `答 ${i}`, sourceQuote: "原句", sourceRef: "生物七上 p1", pool: "standard", introDay: 0, meta: {},
}));
let db: DatabaseSync, app: Hono, now: Date, calls: string[];
const fake: Explainer = async (item) => { calls.push(item.id); return { ok: true, elapsedMs: 1, json: { explanation: `讲 ${item.id}`, key_step: "步", common_mistake: "错" } }; };
const j = async (path: string, body?: unknown) => { const res = await app.request(path, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }); return { status: res.status, body: await res.json() as any }; };
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  db = openDb(":memory:"); repo.invalidateItems(); upsertItems(db, items);
  repo.setSetting(db, "content_start", "2026-09-07");
  now = new Date("2026-09-07T09:00:00Z"); calls = [];
  app = createApp(db, () => now, { explainer: fake });
});

describe("作答后讲解", () => {
  it("没作答不能看；作答后解锁；结果异步写回", async () => {
    await j("/api/checkin", { chapterIds: [] });
    expect((await j("/api/explain/gate/c0")).body).toMatchObject({ allowed: false, reason: "not_answered", remaining: 5 });
    expect((await j("/api/explain", { itemId: "c0" })).status).toBe(403);
    await j("/api/review", { itemId: "c0", knew: false, elapsedMs: 5000 });
    expect((await j("/api/explain/gate/c0")).body).toMatchObject({ allowed: true, remaining: 5 });
    const r = await j("/api/explain", { itemId: "c0" });
    expect(r.status).toBe(200);
    expect(r.body.remaining).toBe(4);
    await tick();
    const e = await j(`/api/explain/${r.body.id}`);
    expect(e.body.status).toBe("done");
    expect(e.body.text).toContain("讲 c0");
    expect(e.body.text).toContain("关键一步：步");
    // 同一题再点不重复消耗
    const again = await j("/api/explain", { itemId: "c0" });
    expect(again.body.id).toBe(r.body.id);
    expect(calls).toEqual(["c0"]);
  });
  it("每日上限 5 次，失败的不计数，孩子端只看到一句话", async () => {
    await j("/api/checkin", { chapterIds: [] });
    for (let i = 0; i < 7; i++) await j("/api/review", { itemId: `c${i}`, knew: true, elapsedMs: 5000 });
    for (let i = 0; i < 5; i++) expect((await j("/api/explain", { itemId: `c${i}` })).status).toBe(200);
    const r = await j("/api/explain", { itemId: "c5" });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ reason: "limit", remaining: 0 });
    expect((await j("/api/explain/gate/c6")).body).toMatchObject({ allowed: false, reason: "limit" });

    const failing = createApp(db, () => now, { explainer: async () => ({ ok: false, error: "codex ENOENT", elapsedMs: 1 }) });
    db.exec("DELETE FROM explanation");
    const res = await failing.request("/api/explain", { method: "POST", body: JSON.stringify({ itemId: "c0" }), headers: { "content-type": "application/json" } });
    const { id } = await res.json() as { id: number };
    await tick();
    const e = await (await failing.request(`/api/explain/${id}`)).json() as { status: string; message: string; text: null };
    expect(e).toMatchObject({ status: "failed", message: "这道题的讲解稍后再看。", text: null });
    expect((await j("/api/explain/gate/c1")).body.remaining).toBe(5);
  });
  it("额度触顶：留在队列，重置时间后自动重试；孩子端只看到稍后再看", async () => {
    await j("/api/checkin", { chapterIds: [] });
    await j("/api/review", { itemId: "c0", knew: false, elapsedMs: 5000 });
    const quota = createApp(db, () => now, { explainer: async () => ({ ok: false, error: "usage limit", quotaResetAt: new Date("2026-09-07T10:00:00Z"), elapsedMs: 1 }) });
    const res = await quota.request("/api/explain", { method: "POST", body: JSON.stringify({ itemId: "c0" }), headers: { "content-type": "application/json" } });
    const { id } = await res.json() as { id: number };
    await tick();
    const e = await (await quota.request(`/api/explain/${id}`)).json() as { status: string; message: string };
    expect(e.message).toBe("这道题的讲解稍后再看。");
    expect(db.prepare("SELECT status, retry_at FROM explanation WHERE id = ?").get(id)).toEqual({ status: "queued", retry_at: "2026-09-07T10:00:00.000Z" });
    expect(await retryDue(db, new Date("2026-09-07T09:30:00Z"), fake)).toBe(0);
    expect(await retryDue(db, new Date("2026-09-07T10:00:01Z"), fake)).toBe(1);
    const done = await (await quota.request(`/api/explain/${id}`)).json() as { status: string; text: string };
    expect(done.status).toBe("done");
    expect(done.text).toContain("讲 c0");
  });
  it("上限可配置（setting.explain_daily_limit）", async () => {
    repo.setSetting(db, "explain_daily_limit", "2");
    await j("/api/checkin", { chapterIds: [] });
    expect((await j("/api/explain/gate/c0")).body.remaining).toBe(2);
  });
  it("提示词带题目、答案、教材原句与自评，不含报班", () => {
    const p = prompt(items[0]!, false);
    expect(p).toContain("问 0"); expect(p).toContain("答 0"); expect(p).toContain("原句"); expect(p).toContain("不会");
    expect(p).not.toMatch(/报班/);
  });
});
