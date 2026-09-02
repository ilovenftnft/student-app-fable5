/**
 * 每日闭环的走法（验收 #1）：开场（先做哪科）→ 章节勾选 → 引导式回想 → 到期卡 → 三问 → 结束页。
 * 一屏一事，任一时刻只有一个"当前步骤"；步骤由已有数据推出，不存"当前在第几步"。
 * 开场页是家长 2026-09-01 定稿加的（方向 F：有意义的选择），不算进 4 段进度条。
 */
export type Step = "start" | "checkin" | "recall" | "review" | "reflect" | "done";

export interface LoopState {
  /** 已过了开场页（选了先做哪科） */
  started: boolean;
  /** 今天已勾选的章节 id */
  checkins: string[];
  /** 勾选的章节里有要点、且还没做回想的 */
  recallPending: string[];
  /** 今日队列剩余张数 */
  queueRemaining: number;
  reflectionDone: boolean;
  /** 会话已结束（手动或硬停） */
  ended: boolean;
  /** 已过了勾选步（可以什么都不勾） */
  checkinDone: boolean;
}

export function currentStep(s: LoopState): Step {
  if (s.ended) return "done";
  if (!s.started) return "start";
  if (!s.checkinDone) return "checkin";
  if (s.recallPending.length > 0) return "recall";
  if (s.queueRemaining > 0) return "review";
  if (!s.reflectionDone) return "reflect";
  return "done";
}

/** 进度条用：当前步骤序号 / 总步数（开场页算第 0 段；回想步没有要点时不算）。 */
export function progress(s: LoopState): { index: number; total: number } {
  const steps: Step[] = ["checkin", "recall", "review", "reflect"];
  const step = currentStep(s);
  const total = steps.length;
  if (step === "done") return { index: total, total };
  if (step === "start") return { index: 0, total };
  return { index: steps.indexOf(step), total };
}
