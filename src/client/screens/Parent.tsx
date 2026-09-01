import { useEffect, useState } from "react";
import { api, type Weekly } from "../api.ts";

/** 家长周报：一页四项。不显示逐题、时长、时间戳。 */
export function Parent() {
  const [w, setW] = useState<Weekly | null>(null);
  useEffect(() => { void api.weekly().then(setW); }, []);
  if (!w) return null;
  return (
    <section>
      <p className="t-small muted" style={{ margin: 0 }}>{w.week.from} 至 {w.week.to}</p>
      <h1 className="t-title" style={{ margin: "8px 0 24px" }}>这一周</h1>
      <div className="card" style={{ padding: 16 }}>
        <Row label="完成天数" value={`${w.daysDone} / ${w.daysTotal}`} />
        <Row label="已掌握卡片" value={String(w.masteredCards)} />
        <Row label="最薄弱的一点" value={w.weakest ? `${w.weakest.subject} · ${w.weakest.topic}` : "还没有数据"} />
      </div>
      <p style={{ marginTop: 24 }}>{w.suggestion}</p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted">{label}</span><span className="num">{value}</span>
    </div>
  );
}
