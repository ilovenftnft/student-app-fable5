import { useCallback, useEffect, useState } from "react";
import { api, type Today } from "./api.ts";
import { Start } from "./screens/Start.tsx";
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
  return <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px" }}>{children}</main>;
}

const LABEL: Record<Today["step"], string> = { start: "今天", checkin: "学到哪了", recall: "回想", review: "到期卡", reflect: "三个问题", done: "结束" };

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
  if (today.step === "start") return <div className="fade" key="start"><Start today={today} onDone={setToday} /></div>;

  const idx = today.progress.index; // 0..4
  return (
    <div className="fade screen" key={today.step}>
      <header style={{ marginBottom: 8 }}>
        <div className="mono t-small muted" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{LABEL[today.step]}{today.step !== "done" ? ` · ${Math.min(idx + 1, 4)}/4` : ""}</span>
          {today.timer && <span>{today.timer.minutes} 分钟</span>}
        </div>
        <div className="seg" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className={i < idx || today.step === "done" ? "done" : i === idx ? "now" : ""} />)}
        </div>
        {today.timer?.message && <p className="t-small" style={{ margin: "12px 0 0", color: "var(--accent)" }}>{today.timer.message}</p>}
      </header>
      {today.timer?.phase === "break" ? (
        <section style={{ paddingTop: 72 }}><p className="t-title" style={{ margin: 0 }}>休息 3 分钟。</p><p className="muted" style={{ margin: "8px 0 0" }}>离开屏幕，喝口水。</p></section>
      ) : today.step === "checkin" ? <Checkin onDone={setToday} />
        : today.step === "recall" ? <Recall pending={today.recallPending[0]!} onDone={setToday} />
        : today.step === "review" ? <Review remaining={today.queue.remaining} onDone={refresh} />
        : today.step === "reflect" ? <Reflect onDone={setToday} />
        : <Done today={today} onEnd={setToday} />}
    </div>
  );
}
