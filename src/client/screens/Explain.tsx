import { useEffect, useState } from "react";
import { api } from "../api.ts";

/** 作答后才出现的"讲解"：出处行右端一个圆形 "?" 符号（家长 09-02 定）→ 点了以后讲解卡出现在答案下方（准备中 → 文本）。每日上限由服务器判定；失败只显示一句"稍后再看"。 */
export function useExplain(itemId: string, ready: boolean) {
  const [gate, setGate] = useState<{ allowed: boolean; remaining: number; existingId: number | null } | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [view, setView] = useState<{ text: string | null; message: string | null } | null>(null);
  useEffect(() => {
    setGate(null); setId(null); setView(null);
    if (!itemId || !ready) return; // 门控只在作答之后查（硬约束 2：作答后才解锁）
    api.explainGate(itemId).then((g) => { setGate(g); if (g.existingId) setId(g.existingId); }).catch(() => setGate(null));
  }, [itemId, ready]);
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
  const request = () => {
    if (!gate?.allowed || id !== null) return;
    setView({ text: null, message: "准备中。" });
    api.explainRequest(itemId).then((r) => { if (r.ok && r.id) setId(r.id); else setView({ text: null, message: "这道题的讲解稍后再看。" }); }).catch(() => setView({ text: null, message: "这道题的讲解稍后再看。" }));
  };
  return { gate, view, request, active: id !== null || view !== null };
}

/** 圆形 "?" 符号；用完或不可用时变淡。 */
export function ExplainMark({ gate, active, onClick }: { gate: ReturnType<typeof useExplain>["gate"]; active: boolean; onClick: () => void }) {
  if (!gate) return null;
  const off = !gate.allowed && !active;
  const title = active ? "讲解" : off ? "今天的讲解用完了" : `让它讲一遍，今天还有 ${gate.remaining} 次`;
  return (
    <button className="explain-mark fade" aria-label={title} title={title} disabled={off || active} aria-pressed={active} onClick={onClick}>?</button>
  );
}

/** 讲解卡：文本或一句状态。每行开头的"第 N 步 / 关键一步 / 常见错因 / 所以本题答案是"用 label 色标出（家长 09-02 定）。 */
const LABEL = /^(第[一二三四五六七八九十\d]+步|关键一步|常见错因|教材原句|所以[^，,：:]{0,8}答案是)([，,：:、]?)/;
export function ExplainView({ view }: { view: ReturnType<typeof useExplain>["view"] }) {
  if (!view) return null;
  if (!view.text) return <div className="card fade" style={{ marginTop: 16, padding: "14px 20px" }}><p className="muted" style={{ margin: 0 }}>{view.message}</p></div>;
  const lines = view.text.split("\n");
  return (
    <div className="card fade" style={{ marginTop: 16, padding: "14px 20px" }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 12 }} />;
        const m = LABEL.exec(line);
        return (
          <p key={i} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {m ? <><span className="label">{m[1]}{m[2]}</span>{line.slice(m[0].length)}</> : line}
          </p>
        );
      })}
    </div>
  );
}
