import { api, type Today } from "../api.ts";

/** 结束页：一句话陈述；周视图只在这里和家长页。 */
export function Done({ today, onEnd }: { today: Today; onEnd: (t: Today) => void }) {
  const s = today.summary;
  return (
    <section style={{ textAlign: "center", paddingTop: 48 }}>
      <p className="t-title">今天 {s.reviews} 题，{s.dueTomorrow} 张卡明天到期。</p>
      {today.queue.deferred > 0 && <p className="muted t-small">{today.queue.deferred} 张顺延到明天。</p>}
      {!today.session?.ended && <div style={{ marginTop: 24 }}><button className="btn-primary" onClick={() => void api.end().then(onEnd)}>结束</button></div>}
      {today.session?.ended && <p className="muted t-small" style={{ marginTop: 24 }}>明天见。</p>}
    </section>
  );
}
