import { api, type Today } from "../api.ts";

/** 结束页：一句固定格式 + 一句按今天数据拼的话（方向 G）；周视图只在这里和家长页；"下次上课"一块提醒预习（家长 09-02 加）。 */
export function Done({ today, onEnd }: { today: Today; onEnd: (t: Today) => void }) {
  const [first, ...rest] = today.doneLines;
  return (
    <section className="screen" style={{ minHeight: 0 }}>
      <div style={{ marginTop: 64, display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="t-title" style={{ margin: 0, fontSize: 22, lineHeight: "34px" }}>{first}</p>
        {rest.map((l, i) => <p key={i} className="muted" style={{ margin: 0, fontSize: 19, lineHeight: "30px" }}>{l}</p>)}
      </div>
      <div style={{ marginTop: 56 }}>
        <p className="t-tag" style={{ margin: "0 0 10px" }}>本周 {today.weekDone + (today.session?.ended ? 0 : 1)} / 5</p>
        <div className="week" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={i < today.weekDone + (today.session?.ended ? 0 : 1) ? "done" : ""} />)}</div>
      </div>
      {today.previewLines.length > 0 && (
        <div style={{ marginTop: 48 }}>
          {/* 一句话 + 每科一个框（家长 09-02 定：去掉小标题，各科加框） */}
          <p style={{ margin: 0, fontSize: 19, lineHeight: "30px" }}>{today.previewLines[0]}</p>
          {today.previewLines.slice(1).map((l, i) => <div key={i} className="card" style={{ marginTop: i ? 8 : 12, padding: "12px 16px", fontSize: 17, lineHeight: "26px" }}>{l}</div>)}
        </div>
      )}
      <div className="spacer" />
      {!today.session?.ended && <button className="btn-primary" onClick={() => void api.end().then(onEnd)}>结束</button>}
      {today.session?.ended && <p className="muted t-small" style={{ textAlign: "center" }}>明天见。</p>}
    </section>
  );
}
