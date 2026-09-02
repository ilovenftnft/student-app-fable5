/**
 * 计时规则（硬约束 6、界面规范 6）：正计时、只显示分钟、无声音；
 * 第 30 分钟若还有事没做完先插 3 分钟休息（家长 2026-09-01 定：超过 30 分钟才休息），之后提示"可以结束了，也可以继续"；60 分钟硬停。
 */
export const CAN_END_MINUTE = 30;
export const BREAK_AT_MINUTE = 30;
export const BREAK_MINUTES = 3;
export const HARD_STOP_MINUTE = 60;

export type TimerPhase = "normal" | "break" | "can_end" | "hard_stop";

export interface TimerView {
  minutes: number;
  phase: TimerPhase;
  /** 30 分钟后进度条变 accent 色 */
  accent: boolean;
  message: string | null;
}

export function elapsedMinutes(startedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60_000));
}

/**
 * @param hasRemainingWork 队列/步骤还没走完——只有这时第 30 分钟才休息（30 分钟内做完的不打断）
 */
export function timerView(startedAt: Date, now: Date, hasRemainingWork: boolean): TimerView {
  const minutes = elapsedMinutes(startedAt, now);
  if (minutes >= HARD_STOP_MINUTE) return { minutes, phase: "hard_stop", accent: true, message: "今天到 60 分钟了，自动结束。" };
  if (hasRemainingWork && minutes >= BREAK_AT_MINUTE && minutes < BREAK_AT_MINUTE + BREAK_MINUTES) {
    return { minutes, phase: "break", accent: true, message: "休息 3 分钟。" };
  }
  if (minutes >= CAN_END_MINUTE) return { minutes, phase: "can_end", accent: true, message: "可以结束了，也可以继续。" };
  return { minutes, phase: "normal", accent: false, message: null };
}
