/** Hono 应用：API + 静态托管（单进程）。所有路由薄，逻辑在 loop/service 与 report。 */
import { Hono } from "hono";
import type { DatabaseSync } from "node:sqlite";
import * as svc from "./loop/service.ts";
import * as repo from "./db/repo.ts";
import { weeklyReport } from "./report/weekly.ts";
import { dayBounds } from "./scheduler/day.ts";
import * as inbox from "./inbox/store.ts";
import { confirmProblem, rejectProblem } from "./inbox/service.ts";
import { sortForReview } from "./inbox/recognize.ts";
import * as explain from "./explain/service.ts";

export interface AppOptions { explainer?: explain.Explainer }

export function createApp(db: DatabaseSync, clock: () => Date = () => new Date(), opts: AppOptions = {}): Hono {
  const explainer = opts.explainer ?? explain.codexExplainer;
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, items: repo.items(db).length }));

  // ---- 每日闭环 ----
  app.get("/api/today", (c) => c.json(svc.today(db, clock())));
  app.post("/api/session/start", (c) => { const s = svc.start(db, clock()); return c.json({ id: s.id }); });
  app.post("/api/session/end", (c) => { svc.end(db, clock()); return c.json(svc.today(db, clock())); });

  app.get("/api/chapters", (c) => c.json(repo.chapterTrees(db)));
  app.post("/api/checkin", async (c) => {
    const body = await c.req.json<{ chapterIds: string[] }>();
    svc.checkin(db, clock(), Array.isArray(body.chapterIds) ? body.chapterIds.map(String) : []);
    return c.json(svc.today(db, clock()));
  });

  app.get("/api/recall/carry", (c) => c.json(repo.recallCarry(db, dayBounds(clock()).date)));
  app.post("/api/recall", async (c) => {
    const body = await c.req.json<{ chapterId: string; thinkMs: number; missed: number[] }>();
    svc.recall(db, clock(), String(body.chapterId), Number(body.thinkMs) || 0, (body.missed ?? []).map(Number).filter(Number.isInteger));
    return c.json(svc.today(db, clock()));
  });

  app.get("/api/card/next", (c) => c.json(svc.nextCard(db, clock())));
  // 答案必须孩子主动取（先作答再看）
  app.get("/api/card/:id/answer", (c) => {
    const a = svc.answerOf(db, c.req.param("id"));
    return a ? c.json(a) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/review", async (c) => {
    const body = await c.req.json<{ itemId: string; knew: boolean; elapsedMs: number }>();
    const r = svc.submitReview(db, clock(), String(body.itemId), !!body.knew, Math.max(0, Number(body.elapsedMs) || 0));
    return c.json({ ...r, next: svc.nextCard(db, clock()) });
  });

  app.get("/api/today/items", (c) => {
    const s = repo.sessionOn(db, dayBounds(clock()).date);
    return c.json(s ? repo.itemsInSession(db, s.id) : []);
  });
  // ---- 作答后讲解（门控 + 每日上限）。孩子端不报错：失败只显示"稍后再看" ----
  app.get("/api/explain/gate/:itemId", (c) => {
    const g = explain.gate(db, clock(), c.req.param("itemId"));
    return c.json({ allowed: g.allowed, reason: g.reason ?? null, remaining: g.remaining, existingId: g.existing?.id ?? null });
  });
  app.post("/api/explain", async (c) => {
    const b = await c.req.json<{ itemId: string }>();
    const r = explain.request(db, clock(), String(b.itemId), explainer);
    return c.json(r, r.ok ? 200 : 403);
  });
  app.get("/api/explain/:id", (c) => {
    const e = explain.explanation(db, Number(c.req.param("id")));
    if (!e) return c.json({ error: "not found" }, 404);
    return c.json({ id: e.id, status: e.status, text: e.status === "done" ? e.text : null, message: e.status === "failed" ? "这道题的讲解稍后再看。" : e.status === "done" ? null : "讲解准备中。" });
  });

  app.post("/api/reflect", async (c) => {
    const b = await c.req.json<{ hardest?: string; guessed?: string; tomorrow?: string }>();
    svc.reflect(db, clock(), { hardest: b.hardest ?? null, guessed: b.guessed ?? null, tomorrow: b.tomorrow ?? null });
    return c.json(svc.today(db, clock()));
  });

  // ---- 家长 ----
  app.get("/api/parent/weekly", (c) => {
    const now = clock();
    const { date } = dayBounds(now);
    const d = new Date(`${date}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // 周一 = 0
    const monday = new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
    const sunday = new Date(d.getTime() + (6 - dow) * 86_400_000).toISOString().slice(0, 10);
    const sessions = repo.sessionsBetween(db, monday, sunday).map((s) => ({ date: s.date, ended: !!s.ended_at }));
    const cards = [...repo.cardStates(db).values()].map((s) => s.card);
    const reviews = repo.reviewsBetween(db, monday, sunday).map((r) => {
      const meta = JSON.parse(r.meta) as Record<string, unknown>;
      return { itemId: r.item_id, rating: r.rating, subject: r.subject_id, topic: String(meta.重要概念 ?? meta.标题 ?? meta.词 ?? "") };
    });
    return c.json({ week: { from: monday, to: sunday }, ...weeklyReport(sessions, cards, reviews) });
  });

  // ---- 成绩与位次（MVP #6） ----
  app.get("/api/parent/exams", (c) => c.json(repo.examScores(db)));
  app.post("/api/parent/exams", async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const date = String(b.date ?? ""), name = String(b.name ?? "").trim(), subject = String(b.subject ?? "");
    const score = num(b.score), full = num(b.fullScore);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !subject || score === null || full === null || !(full > 0)) return c.json({ error: "日期、名称、科目、分数、满分都要填" }, 400);
    const id = repo.addExamScore(db, { date, name, subject_id: subject, score, full_score: full, class_rank: num(b.classRank), class_size: num(b.classSize), grade_rank: num(b.gradeRank), grade_size: num(b.gradeSize) });
    return c.json({ id });
  });
  app.delete("/api/parent/exams/:id", (c) => { repo.deleteExamScore(db, Number(c.req.param("id"))); return c.json({ ok: true }); });

  // ---- 收件箱（MVP #4，家长侧） ----
  app.get("/api/parent/inbox", (c) => c.json(inbox.photos(db).map((p) => ({ id: p.id, path: p.path, status: p.status, attempts: p.attempts, retryAt: p.retry_at, error: p.error, createdAt: p.created_at }))));
  app.get("/api/parent/problems", (c) => {
    const rows = inbox.problems(db, c.req.query("status") ?? "pending").map((p) => ({
      id: p.id, photoPath: p.photo_path, subject: p.subject_id, stem: p.stem, answer: p.answer, tags: JSON.parse(p.tags) as string[],
      needsFigure: !!p.needs_figure, crop: p.crop ? (JSON.parse(p.crop) as number[]) : null, teacherMark: p.teacher_mark as "✗" | "✓" | null, confidence: p.confidence ?? 0, status: p.status,
    }));
    return c.json(sortForReview(rows));
  });
  app.post("/api/parent/problems/:id/confirm", async (c) => {
    const b = (await c.req.json<{ subject?: string; stem?: string; answer?: string; tags?: string[] }>().catch(() => ({}))) as { subject?: string; stem?: string; answer?: string; tags?: string[] };
    try { return c.json(confirmProblem(db, Number(c.req.param("id")), b)); }
    catch (e) { return c.json({ error: String((e as Error).message) }, 400); }
  });
  app.post("/api/parent/problems/:id/reject", (c) => { rejectProblem(db, Number(c.req.param("id"))); return c.json({ ok: true }); });

  return app;
}
