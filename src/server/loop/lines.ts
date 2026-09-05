/**
 * 开场页与结束页的句子（定稿方向 G：像一个不啰嗦的高年级同学）。
 * 全部由程序按当天数据拼模板，不接 LLM，没有输入框（硬约束 1、2）。
 * 陈述句、无感叹号、无表情（界面规范 8）；同一情形下按日期轮换模板，不天天一样。
 */
export interface StartContext {
  date: string;
  /** 今天队列总张数与估算分钟 */
  count: number;
  minutes: number;
  /** 昨天没想起来、今天先看一眼的要点条数 */
  carry: number;
  /** 队列里的错题张数 */
  wrong: number;
  /** 队列里最多的科目 */
  topSubject: string | null;
  /** 本周已完成天数 */
  weekDone: number;
  /** 昨天顺延到今天的张数 */
  deferredYesterday: number;
}

export interface DoneContext {
  date: string;
  reviews: number;
  dueTomorrow: number;
  deferred: number;
  /** 今天答对的错题卡题面（取一条），没有则 null */
  wrongPassed: string | null;
  /** 今天全对的科目（取一科），没有则 null */
  weekDone: number;
  minutes: number;
}

/** 按日期取一个稳定的序号：同一天同一情形句子不变，隔天换。 */
export function pick<T>(date: string, options: T[]): T {
  let h = 0;
  for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return options[h % options.length]!;
}

export function startLines(c: StartContext): string[] {
  const first: string[] = [];
  if (c.count === 0) {
    first.push(...pick(c.date, [["今天没有到期的卡，只有一件事：勾一下学到哪了。"], ["今天很轻，勾一下学到哪了就行。"]]));
    return first;
  }
  if (c.carry > 0) {
    first.push(pick(c.date, [
      `昨天没想起来的 ${c.carry} 条，今天先看一眼再开始。`,
      `先把昨天那 ${c.carry} 条过一遍，再做卡。`,
    ]));
  } else if (c.wrong > 0) {
    first.push(pick(c.date, [
      `今天有 ${c.wrong} 道错题回来了，看看这次能不能自己算对。`,
      `${c.wrong} 道上次错的题今天再来一次。`,
    ]));
  } else if (c.deferredYesterday > 0) {
    first.push(pick(c.date, [
      `昨天没做完的 ${c.deferredYesterday} 张挪到今天了，不多。`,
      `今天先把昨天剩下的 ${c.deferredYesterday} 张清掉。`,
    ]));
  } else if (c.topSubject) {
    first.push(pick(c.date, [
      `今天${c.topSubject}最多，先从它开始也行，顺序你定。`,
      `${c.topSubject}的卡今天到期最多。`,
      `今天大部分是${c.topSubject}。`,
    ]));
  }
  const min = Math.max(1, c.minutes);
  first.push(pick(c.date + "b", [
    `一共 ${c.count} 张，${min} 分钟左右。`,
    `${c.count} 张，大约 ${min} 分钟。`,
  ]));
  return first;
}

export function doneLines(c: DoneContext): string[] {
  const lines: string[] = [];
  lines.push(c.dueTomorrow > 0 ? `今天 ${c.reviews} 题，${c.dueTomorrow} 张卡明天到期。` : `今天 ${c.reviews} 题，明天没有到期的卡。`);
  if (c.deferred > 0) lines.push(`${c.deferred} 张顺延到明天。`);
  if (c.wrongPassed) {
    lines.push(pick(c.date, [
      `"${clip(c.wrongPassed)}"这道，你这次是自己算对的。`,
      `上次错的"${clip(c.wrongPassed)}"，今天对了。`,
    ]));
  }
  // "X 全对。"和"今天 N 分钟。"两句都去掉了（家长 09-02 定）：没有错题答对、没有顺延时第二句就空着
  return lines;
}

/** 结束页"下次上课"一块（家长 2026-09-02 加）：提醒预习。有今天勾选的章节就点名下一节；没有就一句通用的。陈述式，不问句。不说"明天"：没有课程表，不知道明天有没有这门课（家长 09-02 指出）。 */
export interface PreviewContext { date: string; next: { subject: string; title: string }[] }
export function previewLines(c: PreviewContext): string[] {
  if (c.next.length === 0) {
    return [pick(c.date, [
      "下次上课前，翻一眼要学的那一节，哪怕只看标题。",
      "上课前把要学的那一节翻一遍，看过就行，不用记。",
      "要学的那一节先看一眼，上课的时候会熟一点。",
    ])];
  }
  return [
    pick(c.date, [
      "下次上课大概到这，上课前翻一眼。",
      "这几节上课前翻一眼，上课会轻松些。",
      "下次上课前先看一眼，不用记，看过就行。",
    ]),
    ...c.next.map((n) => `${n.subject} · ${n.title}`),
  ];
}

function clip(s: string, n = 14): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
