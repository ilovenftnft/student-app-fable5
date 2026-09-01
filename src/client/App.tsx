import { useCallback, useEffect, useState } from "react";
import { api, type Today } from "./api.ts";
import { Checkin } from "./screens/Checkin.tsx";
import { Recall } from "./screens/Recall.tsx";
import { Review } from "./screens/Review.tsx";
import { Reflect } from "./screens/Reflect.tsx";
import { Done } from "./screens/Done.tsx";
import { Parent } from "./screens/Parent.tsx";

/** 单列、最大 640px 居中；学习页任一时刻只渲染当前步骤。 */
export function App() {
  if (location.pathname.startsWith("/parent")) return <Shell><Parent /></Shell>;
  return <Shell><Daily /></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>{children}</main>;
}

function Daily() {
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setToday(await api.today()); setError(null); } catch (e) { setError(String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  // 计时只显示分钟：每 30 秒问一次服务器（硬停也由服务器判定）
  useEffect(() => {
    if (!today?.session || today.session.ended) return;
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [today?.session, refresh]);

  if (error) return <p className="muted">连不上服务。{error}</p>;
  if (!today) return null;

  const steps = { checkin: 0, recall: 1, review: 2, reflect: 3, done: 4 };
  const pct = (steps[today.step] / 4) * 100;
  return (
    <div className="fade" key={today.step}>
      <header style={{ marginBottom: 24 }}>
        <div className={`progress ${today.timer?.accent ? "accent" : ""}`}><div style={{ width: `${pct}%` }} /></div>
        <div className="t-small muted num" style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span>{Math.min(steps[today.step] + 1, 4)} / 4</span>
          {today.timer && <span>{today.timer.minutes} 分钟</span>}
        </div>
        {today.timer?.message && <p className="t-small" style={{ marginTop: 8 }}>{today.timer.message}</p>}
      </header>
      {today.timer?.phase === "break" ? (
        <section className="card" style={{ padding: 24, textAlign: "center" }}><p className="t-title">休息 3 分钟。</p><p className="muted t-small">离开屏幕，喝口水。</p></section>
      ) : today.step === "checkin" ? <Checkin onDone={setToday} />
        : today.step === "recall" ? <Recall pending={today.recallPending[0]!} onDone={setToday} />
        : today.step === "review" ? <Review remaining={today.queue.remaining} onDone={refresh} />
        : today.step === "reflect" ? <Reflect onDone={setToday} />
        : <Done today={today} onEnd={setToday} />}
    </div>
  );
}
