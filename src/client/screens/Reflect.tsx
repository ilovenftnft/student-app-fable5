import { useEffect, useState } from "react";
import { api, type Today, type TodayItem } from "../api.ts";

const QUESTIONS = [
  { key: "hardest", text: "今天最卡的一点？" },
  { key: "guessed", text: "做对的题里哪道是猜的？" },
  { key: "tomorrow", text: "明天第一题做什么？" },
] as const;

/** 三问复盘：三步向导，每步一问，全部点选（从今天做过的里选），可跳过。 */
export function Reflect({ onDone }: { onDone: (t: Today) => void }) {
  const [items, setItems] = useState<TodayItem[]>([]);
  const [i, setI] = useState(0);
  const [ans, setAns] = useState<Record<string, string | null>>({ hardest: null, guessed: null, tomorrow: null });
  useEffect(() => { void api.todayItems().then(setItems); }, []);

  const [picked, setPicked] = useState<string | null>(null);
  const q = QUESTIONS[i]!;
  /** 点了先亮 250ms 再翻页，让孩子看见点的是哪个（家长 09-02） */
  const pick = (v: string | null) => {
    if (picked !== null) return;
    setPicked(v ?? "skip");
    const next = { ...ans, [q.key]: v };
    setAns(next);
    setTimeout(() => {
      setPicked(null);
      if (i < 2) setI(i + 1); else void api.reflect(next as { hardest: string | null; guessed: string | null; tomorrow: string | null }).then(onDone);
    }, 400);
  };
  /** 之前几问里已经点过的题，在后面的问题里保留选中色（家长 09-02） */
  const chosenBefore = (id: string) => Object.entries(ans).some(([k, v]) => k !== q.key && v === id);
  const label = (front: string) => front.startsWith("audio:") ? `听写 · ${front.slice(6)}` : front;
  return (
    <section className="fade screen" key={q.key} style={{ minHeight: 0 }}>
      <p className="t-tag" style={{ margin: "40px 0 0" }}>{i + 1} / 3</p>
      <h1 className="t-title" style={{ margin: "12px 0 24px" }}>{q.text}</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.slice(0, 8).map((it) => <button key={it.itemId} className="choice" aria-pressed={picked === it.itemId || chosenBefore(it.itemId)} onClick={() => pick(it.itemId)}>{label(it.front)}</button>)}
        <button className="choice" aria-pressed={picked === "none"} onClick={() => pick("none")}>没有</button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}><button className="btn-text" onClick={() => pick(null)}>跳过</button></div>
    </section>
  );
}
