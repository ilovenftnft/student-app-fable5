import { useEffect, useRef, useState } from "react";
import { api, type Today } from "../api.ts";
import { emphasize } from "../../shared/emphasis.ts";

/** 一条要点：教材原句，概念词加粗换 accent 色（家长 09-02 定），规则见 shared/emphasis.ts。 */
export function Point({ p }: { p: { text: string; quote: string } }) {
  return <>{emphasize(p.text, p.quote || p.text).map((seg, i) => (seg.term ? <b key={i} className="term">{seg.s}</b> : <span key={i}>{seg.s}</span>))}</>;
}

/** 引导式回想：先想 1 分钟（正计时，不锁按钮）→ 展开要点 → 勾没想起来的。 */
const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "二十一", "二十二", "二十三", "二十四", "二十五", "二十六", "二十七", "二十八", "二十九", "三十"];
/** 回想页标题带科目（家长 09-02 定）："语文 · 第一课 春"；英语和道法带单元/课名；其余"科目 · 节名"。 */
export function recallTitle(p: { subject: string; parentTitle: string; title: string }): string {
  if (p.subject === "语文") { const m = /^(\d+)\s+(.+)$/.exec(p.title); if (m) return `语文 · 第${CN[Number(m[1])] ?? m[1]}课 ${m[2]}`; }
  if ((p.subject === "英语" || p.subject === "道法") && p.parentTitle) return `${p.subject} · ${p.parentTitle} · ${p.title}`;
  return `${p.subject} · ${p.title}`;
}

/** 文案按定位分两套（家长 09-02 定"提醒"定位，去掉 1 分钟）：语文现代文课的要点是"读读写写"生字词，问法不同。 */
export function recallCopy(subject: string) {
  return subject === "语文"
    ? { ask: "这课的生字词，还记得哪些？", askSub: "心里过一遍，想到几个算几个。", pick: "点一下没记牢的", pickSub: "都记得就直接按下面。", unit: "个", allOk: "都记得" }
    : { ask: "这一节讲了什么？先想一想。", askSub: "不用写，心里过一遍，想到几条算几条。想不起来也正常。", pick: "点一下没想起来的", pickSub: "都想起来了就直接按下面。", unit: "条", allOk: "都想起来了" };
}

export function Recall({ pending, onDone }: { pending: { chapterId: string; subject: string; parentTitle: string; title: string; points: { text: string; quote: string }[] }; onDone: (t: Today) => void }) {
  const [phase, setPhase] = useState<"think" | "compare">("think");
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [carry, setCarry] = useState<{ title: string; points: { text: string; quote: string }[] }[]>([]);
  const started = useRef(Date.now());
  const [minutes, setMinutes] = useState(0);
  useEffect(() => { const t = setInterval(() => setMinutes(Math.floor((Date.now() - started.current) / 60_000)), 5_000); return () => clearInterval(t); }, []);
  useEffect(() => { void api.recallCarry().then(setCarry); }, []);
  const c = recallCopy(pending.subject);

  if (phase === "think") {
    return (
      <section className="screen" style={{ minHeight: 0 }}>
        {carry.length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 24 }}>
            <p className="t-tag" style={{ margin: "0 0 8px" }}>昨天没想起来的，先看一眼</p>
            {carry.map((c) => c.points.map((p, i) => <p key={c.title + i} style={{ margin: "4px 0" }}><Point p={p} /></p>))}
          </div>
        )}
        <p className="t-tag" style={{ margin: "40px 0 0" }}>{recallTitle(pending)}</p>
        <h1 className="t-title" style={{ margin: "12px 0 4px" }}>{c.ask}</h1>
        <p className="muted" style={{ margin: 0 }}>{c.askSub}</p>
        <p className="mono t-small muted" style={{ margin: "16px 0 0" }}>{minutes} 分钟</p>
        <div style={{ marginTop: 40 }}><button className="btn-primary" onClick={() => setPhase("compare")}>想好了</button></div>
      </section>
    );
  }
  return (
    <section className="screen" style={{ minHeight: 0 }}>
      <p className="t-tag" style={{ margin: "40px 0 0" }}>{recallTitle(pending)}</p>
      <h1 className="t-title" style={{ margin: "12px 0 4px" }}>{c.pick}</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>{c.pickSub}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pending.points.map((p, i) => (
          <button key={i} className="choice" aria-pressed={missed.has(i)} onClick={() => setMissed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}><Point p={p} /></button>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <button className="btn-primary" onClick={() => void api.recall(pending.chapterId, Date.now() - started.current, [...missed]).then(onDone)}>
          {missed.size ? `${missed.size} ${c.unit}明天再看` : c.allOk}
        </button>
      </div>
    </section>
  );
}
