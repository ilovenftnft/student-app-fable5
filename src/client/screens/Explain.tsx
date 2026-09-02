import { useEffect, useState } from "react";
import { api } from "../api.ts";

/** 作答后才出现的"讲解"：一行按钮 → 准备中 → 文本。每日上限由服务器判定；失败只显示一句"稍后再看"。 */
export function Explain({ itemId }: { itemId: string }) {
  const [gate, setGate] = useState<{ allowed: boolean; remaining: number; existingId: number | null } | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [view, setView] = useState<{ text: string | null; message: string | null } | null>(null);
  useEffect(() => { api.explainGate(itemId).then((g) => { setGate(g); if (g.existingId) setId(g.existingId); }).catch(() => setGate(null)); }, [itemId]);
  useEffect(() => {
    if (id === null) return;
    let stop = false;
    const poll = async () => {
      try {
        const e = await api.explanation(id);
        if (stop) return;
        setView({ text: e.text, message: e.message });
        if (e.status === "queued" || e.status === "running") setTimeout(poll, 3000);
      } catch { if (!stop) setView({ text: null, message: "这道题的讲解稍后再看。" }); }
    };
    void poll();
    return () => { stop = true; };
  }, [id]);

  if (!gate) return null;
  if (view) return <div className="card fade" style={{ marginTop: 12, padding: "14px 20px" }}>{view.text ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{view.text}</p> : <p className="muted" style={{ margin: 0 }}>{view.message}</p>}</div>;
  if (!gate.allowed) return gate.remaining === 0 ? <p className="t-small muted" style={{ marginTop: 12 }}>今天的讲解用完了。</p> : null;
  return (
    <button className="btn-secondary fade" style={{ marginTop: 12, fontSize: 16, padding: "14px 20px" }} onClick={() => void api.explainRequest(itemId).then((r) => { if (r.ok && r.id) setId(r.id); }).catch(() => setView({ text: null, message: "这道题的讲解稍后再看。" }))}>
      <span>让它讲一遍</span><span className="mono t-small muted">今天还有 {gate.remaining} 次</span>
    </button>
  );
}
