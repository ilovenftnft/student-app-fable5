import { useEffect, useRef, useState } from "react";
import { api, type Answer, type CardFront } from "../api.ts";

/** 到期卡：正面 → 孩子主动看答案 → 点"会 / 不会"。反馈一句话，200ms 边框变色。 */
export function Review({ remaining, onDone }: { remaining: number; onDone: () => void }) {
  const [card, setCard] = useState<CardFront | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [n, setN] = useState(0);
  const shownAt = useRef(Date.now());

  const load = async () => {
    const c = await api.nextCard();
    if (!c) { onDone(); return; }
    setCard(c); setAnswer(null); setFeedback(null); shownAt.current = Date.now();
  };
  useEffect(() => { void load(); }, []);

  const submit = async (knew: boolean) => {
    if (!card) return;
    let r: Awaited<ReturnType<typeof api.review>>;
    try { r = await api.review(card.itemId, knew, Date.now() - shownAt.current); }
    catch { setFeedback({ text: "没记上，再点一次。", ok: false }); setTimeout(() => setFeedback(null), 1500); return; }
    setFeedback({ text: r.feedback, ok: r.rating > 1 });
    setN((x) => x + 1);
    setTimeout(() => { if (r.next) { setCard(r.next); setAnswer(null); setFeedback(null); shownAt.current = Date.now(); } else onDone(); }, 600);
  };

  if (!card) return null;
  const total = remaining;
  return (
    <section>
      <p className="t-small muted num" style={{ margin: "0 0 16px" }}>{Math.min(n + 1, total)} / {total}</p>
      <div className={`card ${feedback ? (feedback.ok ? "flash-ok" : "flash-weak") : ""}`} style={{ padding: 24, minHeight: 160 }}>
        {card.kind === "listen" ? (
          <audio controls autoPlay src={card.audio} style={{ width: "100%" }} />
        ) : (
          <p className="t-title" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{card.front}</p>
        )}
        {answer && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {answer.answerPoints ? answer.answerPoints.map((p, i) => <p key={i} style={{ margin: "4px 0" }}>{p}</p>) : <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{answer.back}</p>}
            <p className="t-small muted" style={{ margin: "12px 0 0" }}>{answer.sourceRef}</p>
          </div>
        )}
        {feedback && <p style={{ margin: "16px 0 0" }}>{feedback.text}</p>}
      </div>
      <div style={{ marginTop: 24 }}>
        {!answer ? (
          <button className="btn-primary" onClick={() => void api.answer(card.itemId).then(setAnswer)}>看答案</button>
        ) : !feedback ? (
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="choice" style={{ width: 160, textAlign: "center" }} onClick={() => void submit(false)}>不会</button>
            <button className="btn-primary" style={{ margin: 0, width: 160 }} onClick={() => void submit(true)}>会</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
