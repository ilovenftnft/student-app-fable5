/**
 * 错题卡归档（验收 #3）：跨 3 次间隔会话各答对 1 次才归档；答错清零。
 * "会话"以 session id 区分——同一天连对多次只算一次。
 */
import { Rating, type Grade } from "ts-fsrs";
import { WRONG_PASSES_TO_ARCHIVE } from "./policy.ts";

export interface WrongProgress { passStreak: number; lastPassSession: number | null; archived: boolean }

export function updateWrongProgress(p: WrongProgress, grade: Grade, sessionId: number): WrongProgress {
  if (grade === Rating.Again) return { passStreak: 0, lastPassSession: p.lastPassSession, archived: false };
  if (p.lastPassSession === sessionId) return p;
  const passStreak = p.passStreak + 1;
  return { passStreak, lastPassSession: sessionId, archived: passStreak >= WRONG_PASSES_TO_ARCHIVE };
}
