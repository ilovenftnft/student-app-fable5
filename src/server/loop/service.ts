/**
 * 每日闭环的应用层：把 repo（数据）、scheduler（纯逻辑）、steps/timer 串起来。路由只调这里。
 */
import type { DatabaseSync } from "node:sqlite";
import { Rating } from "ts-fsrs";
import * as repo from "../db/repo.ts";
import { dayBounds, daysBetween, weekBounds } from "../scheduler/day.ts";
import { buildQueue, bySubject, type Queue } from "../scheduler/queue.ts";
import { newCardState, review as fsrsReview } from "../scheduler/fsrs.ts";
import { nextPreview, type NextPreview } from "../scheduler/preview.ts";
import { doneLines, startLines } from "./lines.ts";
import { baselineMs, inferRating } from "../scheduler/rating.ts";
import { updateWrongProgress } from "../scheduler/wrong.ts";
import { currentStep, progress, type LoopState, type Step } from "./steps.ts";
import { timerView, type TimerView } from "./timer.ts";
import type { Item, Subject } from "../../shared/types.ts";

/** 开场页的两个选择（方向 F）。"再多 5 张"固定 5，只有开关。 */
export interface StartChoices { subjectFirst: Subject | null; extra: boolean }
export const EXTRA_CARDS = 5;

export interface TodayView {
  date: string;
  session: { id: number; started: boolean; ended: boolean } | null;
  step: Step;
  progress: { index: number; total: number };
  timer: TimerView | null;
  checkins: string[];
  recallPending: { chapterId: string; title: string; points: string[] }[];
  queue: { remaining: number; deferred: number; estMinutes: number };
  /** 结束页文案："今天 N 题，M 张卡明天到期。" */
  summary: { reviews: number; dueTomorrow: number };
  /** 本周已完成天数（周一到周五算 5 天）；结束页与开场页显示 */
  weekDone: number;
  /** 开场页：按科目汇总 + 两句话（程序拼，方向 G） */
  start: { bySubject: { subject: Subject; count: number; estSeconds: number; wrong: number }[]; count: number; minutes: number; lines: string[]; choices: StartChoices | null };
  /** 结束页的句子（第一句固定格式） */
  doneLines: string[];
}

export function startChoices(db: DatabaseSync, sessionId: number): StartChoices | null {
  const raw = repo.getSetting(db, `start:${sessionId}`, "");
  if (!raw) return null;
  try { return JSON.parse(raw) as StartChoices; } catch { return null; }
}

function dayIndex(db: DatabaseSync, date: string): number {
  return daysBetween(repo.contentStart(db), date);
}

export function queueFor(db: DatabaseSync, now: Date, sessionId: number | null): Queue {
  const { date } = dayBounds(now);
  const choices = sessionId ? startChoices(db, sessionId) : null;
  return buildQueue({
    items: repo.items(db), states: repo.cardStates(db), now, dayIndex: dayIndex(db, date),
    spentSeconds: sessionId ? repo.elapsedInSession(db, sessionId) / 1000 : 0,
    subjectFirst: choices?.subjectFirst ?? null, extraCards: choices?.extra ? EXTRA_CARDS : 0,
  });
}

function weekDone(db: DatabaseSync, date: string): number {
  const { from, to } = weekBounds(date);
  return Math.min(5, new Set(repo.sessionsBetween(db, from, to).filter((s) => s.ended_at).map((s) => s.date)).size);
}

function loopState(db: DatabaseSync, now: Date, session: repo.SessionRow | undefined): { state: LoopState; recallPending: TodayView["recallPending"] } {
  if (!session) return { state: { started: false, checkins: [], recallPending: [], queueRemaining: 0, reflectionDone: false, ended: false, checkinDone: false }, recallPending: [] };
  const started = repo.getSetting(db, `start_done:${session.id}`, "0") === "1";
  const checkinDone = repo.getSetting(db, `checkin_done:${session.id}`, "0") === "1";
  const checkins = repo.checkins(db, session.id);
  const done = new Set(repo.recalls(db, session.id).map((r) => r.chapter_id));
  const recallPending: TodayView["recallPending"] = [];
  for (const id of checkins) {
    if (done.has(id)) continue;
    const c = repo.chapter(db, id);
    const points = c ? (JSON.parse(c.points) as { text: string }[]) : [];
    if (points.length > 0) recallPending.push({ chapterId: id, title: c!.title, points: points.map((p) => p.text) });
  }
  const q = queueFor(db, now, session.id);
  return {
    state: {
      started, checkins, recallPending: recallPending.map((r) => r.chapterId), queueRemaining: q.entries.length,
      reflectionDone: !!repo.reflection(db, session.id), ended: !!session.ended_at, checkinDone,
    },
    recallPending,
  };
}

export function today(db: DatabaseSync, now: Date): TodayView {
  const { date, end } = dayBounds(now);
  let session = repo.sessionOn(db, date);
  // 60 分钟硬停：读取时发现超时就落库
  if (session && !session.ended_at) {
    const t = timerView(new Date(session.started_at), now, true);
    if (t.phase === "hard_stop") { repo.endSession(db, session.id, now, "hard_stop"); session = repo.sessionOn(db, date); }
  }
  const { state, recallPending } = loopState(db, now, session);
  const q = session ? queueFor(db, now, session.id) : queueFor(db, now, null);
  const step = currentStep(state);
  const timer = session && !session.ended_at ? timerView(new Date(session.started_at), now, step !== "done" && step !== "reflect") : null;
  const tomorrowEnd = new Date(end.getTime() + 86_400_000);
  const reviews = session ? repo.reviewsInSession(db, session.id) : 0;
  const dueTomorrow = repo.dueTomorrowCount(db, tomorrowEnd.toISOString(), end.toISOString());
  const wd = weekDone(db, date);
  const subjects = bySubject(q);
  const yesterday = dayBounds(new Date(dayBounds(now).start.getTime() - 1000)).date;
  const startCtx = {
    date, count: q.entries.length, minutes: Math.round(q.estSeconds / 60),
    carry: repo.recallCarry(db, date).reduce((n, c) => n + c.points.length, 0),
    wrong: subjects.reduce((n, s) => n + s.wrong, 0),
    topSubject: subjects[0]?.subject ?? null, weekDone: wd,
    deferredYesterday: Number(repo.getSetting(db, `deferred:${yesterday}`, "0")) || 0,
  };
  const rows = session ? repo.reviewsWithItems(db, session.id) : [];
  const wrongPassed = rows.find((r) => r.kind === "wrong" && r.knew === 1)?.front ?? null;
  const perSubject = new Map<string, { n: number; wrong: number }>();
  for (const r of rows) { const e = perSubject.get(r.subject_id) ?? { n: 0, wrong: 0 }; e.n++; if (r.knew !== 1) e.wrong++; perSubject.set(r.subject_id, e); }
  const allRightSubject = [...perSubject.entries()].find(([, v]) => v.n >= 2 && v.wrong === 0)?.[0] ?? null;
  const minutes = session ? Math.floor(((session.ended_at ? Date.parse(session.ended_at) : now.getTime()) - Date.parse(session.started_at)) / 60_000) : 0;
  return {
    date,
    session: session ? { id: session.id, started: true, ended: !!session.ended_at } : null,
    step, progress: progress(state), timer,
    checkins: state.checkins, recallPending,
    queue: { remaining: q.entries.length, deferred: q.deferred, estMinutes: Math.round(q.estSeconds / 60) },
    summary: { reviews, dueTomorrow },
    weekDone: wd,
    start: { bySubject: subjects, count: q.entries.length, minutes: startCtx.minutes, lines: startLines(startCtx), choices: session ? startChoices(db, session.id) : null },
    doneLines: doneLines({ date, reviews, dueTomorrow, deferred: q.deferred, wrongPassed, allRightSubject, weekDone: wd, minutes }),
  };
}

/** 开场页：记下"先做哪科 / 再多 5 张"，会话从这里开始。 */
export function begin(db: DatabaseSync, now: Date, choices: StartChoices): void {
  const s = start(db, now);
  repo.setSetting(db, `start:${s.id}`, JSON.stringify(choices));
  repo.setSetting(db, `start_done:${s.id}`, "1");
}

export class SessionClosed extends Error {
  constructor() { super("今天的会话已结束"); }
}

/**
 * 写接口共用：取今天的会话；已到 60 分钟就先落库硬停并拒绝写入（硬约束 6 对写操作同样成立，不能只靠前端轮询）。
 */
export function start(db: DatabaseSync, now: Date): repo.SessionRow {
  const s = repo.startSession(db, dayBounds(now).date, now);
  if (s.ended_at) throw new SessionClosed();
  if (timerView(new Date(s.started_at), now, true).phase === "hard_stop") {
    repo.endSession(db, s.id, now, "hard_stop");
    throw new SessionClosed();
  }
  return s;
}

export function end(db: DatabaseSync, now: Date): void {
  const { date } = dayBounds(now);
  const s = repo.sessionOn(db, date);
  if (s && !s.ended_at) {
    repo.setSetting(db, `deferred:${date}`, String(queueFor(db, now, s.id).deferred));
    repo.endSession(db, s.id, now, "user");
  }
}

export function checkin(db: DatabaseSync, now: Date, chapterIds: string[]): void {
  const s = start(db, now);
  repo.setCheckins(db, s.id, chapterIds);
  repo.setSetting(db, `checkin_done:${s.id}`, "1");
}

export function recall(db: DatabaseSync, now: Date, chapterId: string, thinkMs: number, missed: number[]): void {
  const s = start(db, now);
  const { end } = dayBounds(now);
  const tomorrow = dayBounds(new Date(end.getTime() + 1000)).date;
  repo.saveRecall(db, s.id, chapterId, thinkMs, missed, missed.length ? tomorrow : null);
}

export interface CardFront { itemId: string; subject: Subject; kind: string; subtype: string; front: string; isNew: boolean; audio?: string; sourceRef: string; preview: NextPreview; lastSeen: string | null }
export function nextCard(db: DatabaseSync, now: Date): CardFront | null {
  const s = repo.sessionOn(db, dayBounds(now).date);
  const q = queueFor(db, now, s?.id ?? null);
  const e = q.entries[0];
  if (!e) return null;
  const it = e.item;
  const cs = repo.cardStates(db).get(it.id) ?? newCardState(it.id, now);
  const last = cs.card.last_review ? daysBetween(dayBounds(cs.card.last_review).date, dayBounds(now).date) : null;
  return {
    itemId: it.id, subject: it.subject, kind: it.kind, subtype: it.subtype, front: it.front, isNew: e.isNew,
    audio: it.kind === "listen" ? `/audio/${it.back}.ogg` : undefined, sourceRef: it.sourceRef,
    preview: nextPreview(cs.card, now), lastSeen: last === null ? null : last === 0 ? "今天" : last === 1 ? "昨天" : `${last} 天前`,
  };
}

export function answerOf(db: DatabaseSync, itemId: string): { back: string; answerPoints?: string[]; sourceQuote: string; sourceRef: string } | null {
  const it = repo.items(db).find((i) => i.id === itemId);
  return it ? { back: it.back, answerPoints: it.answerPoints, sourceQuote: it.sourceQuote, sourceRef: it.sourceRef } : null;
}

export interface ReviewResult { rating: number; feedback: string }
/** 孩子点"会 / 不会"。反馈文案一句话、陈述式（界面规范 8）。 */
export function submitReview(db: DatabaseSync, now: Date, itemId: string, knew: boolean, elapsedMs: number): ReviewResult {
  const item = repo.items(db).find((i) => i.id === itemId);
  if (!item) throw new Error(`没有这条内容：${itemId}`);
  const s = start(db, now);
  const states = repo.cardStates(db);
  const cs = states.get(itemId) ?? newCardState(itemId, now);
  const rating = inferRating(knew, elapsedMs, baselineMs(item, repo.recentElapsed(db, itemId)));
  cs.card = fsrsReview(cs.card, now, rating);
  if (item.kind === "wrong") {
    const p = updateWrongProgress({ passStreak: cs.passStreak, lastPassSession: cs.lastPassSession, archived: cs.archived }, rating, s.id);
    cs.passStreak = p.passStreak; cs.lastPassSession = p.lastPassSession; cs.archived = p.archived;
  }
  repo.saveCardState(db, cs);
  repo.recordReview(db, itemId, s.id, rating, knew, elapsedMs, now);
  return { rating, feedback: rating === Rating.Again ? feedbackWrong(item) : "对了。" };
}

function feedbackWrong(item: Item): string {
  if (item.kind === "recitation") return "再看一眼下句。";
  if (item.subtype === "answer_template") return "再看一眼要点。";
  return "再看一眼答案。";
}

export function reflect(db: DatabaseSync, now: Date, r: { hardest: string | null; guessed: string | null; tomorrow: string | null }): void {
  const s = start(db, now);
  repo.saveReflection(db, { session_id: s.id, ...r });
}
