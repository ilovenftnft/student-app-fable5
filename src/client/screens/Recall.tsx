import { useEffect, useRef, useState } from "react";
import { api, type Today } from "../api.ts";

/** 引导式回想：先想 1 分钟（正计时，不锁按钮）→ 展开要点 → 勾没想起来的。 */
export function Recall({ pending, onDone }: { pending: { chapterId: string; title: string; points: string[] }; onDone: (t: Today) => void }) {
  const [phase, setPhase] = useState<"think" | "compare">("think");
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [carry, setCarry] = useState<{ title: string; points: { text: string }[] }[]>([]);
  const started = useRef(Date.now());
  const [minutes, setMinutes] = useState(0);
  useEffect(() => { const t = setInterval(() => setMinutes(Math.floor((Date.now() - started.current) / 60_000)), 5_000); return () => clearInterval(t); }, []);
  useEffect(() => { void api.recallCarry().then(setCarry); }, []);

  if (phase === "think") {
    return (
      <section className="screen" style={{ minHeight: 0 }}>
        {carry.length > 0 && (
          <div className="card" style={{ padding: 16, marginTop: 24 }}>
            <p className="t-tag" style={{ margin: "0 0 8px" }}>昨天没想起来的，先看一眼</p>
            {carry.map((c) => c.points.map((p, i) => <p key={c.title + i} style={{ margin: "4px 0" }}>{p.text}</p>))}
          </div>
        )}
        <p className="t-tag" style={{ margin: "40px 0 0" }}>{pending.title}</p>
        <h1 className="t-title" style={{ margin: "12px 0 4px" }}>这一节讲了什么？先想 1 分钟。</h1>
        <p className="muted" style={{ margin: 0 }}>不用写，心里过一遍。想不起来也正常。</p>
        <p className="mono t-small muted" style={{ margin: "16px 0 0" }}>{minutes} 分钟</p>
        <div style={{ marginTop: 40 }}><button className="btn-primary" onClick={() => setPhase("compare")}>想好了</button></div>
      </section>
    );
  }
  return (
    <section className="screen" style={{ minHeight: 0 }}>
      <p className="t-tag" style={{ margin: "40px 0 0" }}>{pending.title}</p>
      <h1 className="t-title" style={{ margin: "12px 0 4px" }}>点一下没想起来的</h1>
      <p className="muted" style={{ margin: "0 0 24px" }}>都想起来了就直接按下面。</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pending.points.map((p, i) => (
          <button key={i} className="choice" aria-pressed={missed.has(i)} onClick={() => setMissed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>{p}</button>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        <button className="btn-primary" onClick={() => void api.recall(pending.chapterId, Date.now() - started.current, [...missed]).then(onDone)}>
          {missed.size ? `${missed.size} 条明天再看` : "都想起来了"}
        </button>
      </div>
    </section>
  );
}
