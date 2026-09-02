import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/server/db/open.ts";
import { upsertItems } from "../../src/server/content/store.ts";
import { createApp } from "../../src/server/app.ts";
import * as repo from "../../src/server/db/repo.ts";
import { prompt, verifyPrompt, retryDue, pipeline, checkDeterministic, assemble, passVerifier, type Explainer, type Verifier, type ExplanationJson } from "../../src/server/explain/service.ts";
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
  app = createApp(db, () => now, { explainer: fake, verifier: passVerifier });
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

    const failing = createApp(db, () => now, { explainer: async () => ({ ok: false, error: "codex ENOENT", elapsedMs: 1 }), verifier: passVerifier });
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
    const quota = createApp(db, () => now, { explainer: async () => ({ ok: false, error: "usage limit", quotaResetAt: new Date("2026-09-07T10:00:00Z"), elapsedMs: 1 }), verifier: passVerifier });
    const res = await quota.request("/api/explain", { method: "POST", body: JSON.stringify({ itemId: "c0" }), headers: { "content-type": "application/json" } });
    const { id } = await res.json() as { id: number };
    await tick();
    const e = await (await quota.request(`/api/explain/${id}`)).json() as { status: string; message: string };
    expect(e.message).toBe("这道题的讲解稍后再看。");
    expect(db.prepare("SELECT status, retry_at FROM explanation WHERE id = ?").get(id)).toEqual({ status: "queued", retry_at: "2026-09-07T10:00:00.000Z" });
    expect(await retryDue(db, new Date("2026-09-07T09:30:00Z"), fake, passVerifier)).toBe(0);
    expect(await retryDue(db, new Date("2026-09-07T10:00:01Z"), fake, passVerifier)).toBe(1);
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
    expect(p).toContain("结论必须与标准答案一致");
    expect(prompt(items[0]!, false, "结论与标准答案不一致")).toContain("上一版讲解有问题，这次必须改正：结论与标准答案不一致");
  });
  it("讲解末尾由程序附教材原句；错题卡不附", () => {
    const j: ExplanationJson = { explanation: "讲", key_step: "步", common_mistake: "错" };
    expect(assemble(items[0]!, j)).toBe("讲\n\n关键一步：步\n\n常见错因：错\n\n教材原句：原句（生物七上 p1）");
    expect(assemble({ ...items[0]!, kind: "wrong", sourceQuote: "题干", sourceRef: "照片 a.jpg 第 1 题" }, j)).not.toContain("教材原句");
  });
});

describe("讲解流水线：生成 → 程序核对 → Codex 复核（家长 09-02：正确优先）", () => {
  const item: Item = { ...items[0]!, front: "地图上表示地理事物的符号叫____", back: "图例" };
  const good: ExplanationJson = { explanation: "第一步，看题干。所以本题答案是：图例。", key_step: "对照原句", common_mistake: "写成注记" };
  const okVerdict = { ok: true, elapsedMs: 1, json: { consistent: true, within_grade: true, quotes_ok: true, no_tutoring: true, problems: "" } };

  it("程序核对：禁词、结论与标准答案不一致", () => {
    expect(checkDeterministic(item, good)).toBeNull();
    expect(checkDeterministic(item, { ...good, explanation: "建议报班补一补。" })).toMatch(/报班|课外辅导/);
    expect(checkDeterministic(item, { ...good, explanation: "所以本题答案是：注记。" })).toMatch(/不一致/);
    expect(checkDeterministic(item, { ...good, explanation: "答案是 图 例。" })).toBeNull(); // 标点空格不影响
    expect(checkDeterministic({ ...item, answerPoints: ["a", "b"] }, { ...good, explanation: "答案是别的" })).toBeNull(); // 要点式不查
  });
  it("程序核对不过 → 带问题说明重新生成 → 通过", async () => {
    const seen: (string | undefined)[] = [];
    const gen: Explainer = async (_i, _k, note) => { seen.push(note); return { ok: true, elapsedMs: 1, json: seen.length === 1 ? { ...good, explanation: "所以本题答案是：注记。" } : good }; };
    const verified: ExplanationJson[] = [];
    const ver: Verifier = async (_i, j) => { verified.push(j); return okVerdict; };
    const r = await pipeline(item, false, gen, ver);
    expect(r.kind).toBe("done");
    expect(seen).toEqual([undefined, expect.stringMatching(/不一致/)]);
    expect(verified).toHaveLength(1); // 程序核对不过的那版没送去复核
    if (r.kind === "done") expect(r.text).toContain("教材原句：原句");
  });
  it("Codex 复核不过 → 重新生成；两轮都不过 → failed，不计入每日上限", async () => {
    let n = 0;
    const gen: Explainer = async () => { n++; return { ok: true, elapsedMs: 1, json: good }; };
    const ver: Verifier = async () => ({ ok: true, elapsedMs: 1, json: { consistent: false, within_grade: true, quotes_ok: true, no_tutoring: true, problems: "把图例说成了注记" } });
    const r = await pipeline(item, false, gen, ver);
    expect(r).toMatchObject({ kind: "failed", error: expect.stringMatching(/2 轮都没通过.*结论与标准答案不一致.*把图例说成了注记/) });
    expect(n).toBe(2);
    // 落库后状态 failed，孩子端只看到一句话，剩余次数不减
    await j("/api/checkin", { chapterIds: [] });
    await j("/api/review", { itemId: "c0", knew: false, elapsedMs: 5000 });
    const bad = createApp(db, () => now, { explainer: gen, verifier: ver });
    const res = await bad.request("/api/explain", { method: "POST", body: JSON.stringify({ itemId: "c0" }), headers: { "content-type": "application/json" } });
    const { id } = await res.json() as { id: number };
    await tick(); await tick();
    const e = await (await bad.request(`/api/explain/${id}`)).json() as { status: string; message: string; text: null };
    expect(e).toMatchObject({ status: "failed", message: "这道题的讲解稍后再看。", text: null });
    expect((await j("/api/explain/gate/c1")).body.remaining).toBe(5);
  });
  it("复核调用本身失败：不采信这一版，再来一轮；复核触顶：留队列等重试", async () => {
    let calls = 0;
    const gen: Explainer = async () => ({ ok: true, elapsedMs: 1, json: good });
    const flaky: Verifier = async () => (++calls === 1 ? { ok: false, error: "超时", elapsedMs: 1 } : okVerdict);
    expect((await pipeline(item, false, gen, flaky)).kind).toBe("done");
    expect(calls).toBe(2);
    const quota: Verifier = async () => ({ ok: false, error: "usage limit", quotaResetAt: new Date("2026-09-07T10:00:00Z"), elapsedMs: 1 });
    expect(await pipeline(item, false, gen, quota)).toMatchObject({ kind: "quota", resetAt: new Date("2026-09-07T10:00:00Z") });
  });
  it("复核提示词带题目、标准答案、教材原句和三段讲解", () => {
    const p = verifyPrompt(item, good);
    for (const s of ["地图上表示地理事物的符号叫", "标准答案：图例", "原句", good.explanation, "关键一步：对照原句", "常见错因：写成注记", "consistent", "quotes_ok", "引用题干、标准答案"]) expect(p).toContain(s);
  });
});
