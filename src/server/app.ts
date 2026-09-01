/** Hono 应用：API + 静态托管（单进程）。所有路由薄，逻辑在 loop/service 与 report。 */
import { Hono } from "hono";
import type { DatabaseSync } from "node:sqlite";
import * as svc from "./loop/service.ts";
import * as repo from "./db/repo.ts";
import { weeklyReport } from "./report/weekly.ts";
import { dayBounds } from "./scheduler/day.ts";

export function createApp(db: DatabaseSync, clock: () => Date = () => new Date()): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, items: repo.items(db).length }));

  // ---- 每日闭环 ----
  app.get("/api/today", (c) => c.json(svc.today(db, clock())));
  app.post("/api/session/start", (c) => { const s = svc.start(db, clock()); return c.json({ id: s.id }); });
  app.post("/api/session/end", (c) => { svc.end(db, clock()); return c.json(svc.today(db, clock())); });

  app.get("/api/chapters/:subject", (c) => c.json(repo.chapterTree(db, c.req.param("subject"))));
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
      return { itemId: r.item_id, rating: r.rating, subject: r.subject_id, topic: String(meta.重要概念 ?? meta.标题 ?? meta.组 ?? "") };
    });
    return c.json({ week: { from: monday, to: sunday }, ...weeklyReport(sessions, cards, reviews) });
  });

  return app;
}
