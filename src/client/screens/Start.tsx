import { useState } from "react";
import { api, type Today } from "../api.ts";

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 开场页（方向 F + G）：两句话 → 先做哪科（你定）→ 只做到期的 / 再多 5 张 → 开始。 */
export function Start({ today, onDone }: { today: Today; onDone: (t: Today) => void }) {
  const subjects = today.start.bySubject;
  const [first, setFirst] = useState<string | null>(subjects[0]?.subject ?? null);
  const [extra, setExtra] = useState(false);
  const d = new Date(`${today.date}T00:00:00+08:00`);
  const dateLine = `${WEEKDAY[d.getDay()]} · ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const go = () => void api.begin(first, extra).then(onDone);
  return (
    <section className="screen">
      <header className="mono t-small muted" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{dateLine}</span><span>本周 {today.weekDone} / 5</span>
      </header>
      <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 10, fontSize: 19, lineHeight: "30px" }}>
        {today.start.lines.map((l, i) => <p key={i} style={{ margin: 0, color: i === 0 ? "var(--text)" : "var(--text-muted)" }}>{l}</p>)}
      </div>
      {subjects.length > 0 && (
        <>
          <p className="t-small muted" style={{ margin: "40px 0 12px" }}>先做哪科，你定。</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {subjects.map((s) => (
              <button key={s.subject} className="tile" aria-pressed={first === s.subject} onClick={() => setFirst(s.subject)}>
                <span className="t-h">{s.subject}</span>
                <span className="mono t-small muted">{s.count} 张{s.wrong ? ` · ${s.wrong} 张错题` : ` · ${Math.max(1, Math.round(s.estSeconds / 60))} 分钟`}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 8, alignItems: "center" }} className="t-small muted">
            <span>今天</span>
            <button className="chip" aria-pressed={!extra} onClick={() => setExtra(false)}>只做到期的</button>
            <button className="chip" aria-pressed={extra} onClick={() => setExtra(true)}>再多 5 张</button>
          </div>
        </>
      )}
      <div className="spacer" />
      <button className="btn-primary" onClick={go}>{first ? `从${first}开始` : "开始"}</button>
    </section>
  );
}
