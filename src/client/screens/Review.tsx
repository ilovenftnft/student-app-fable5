import { useEffect, useRef, useState } from "react";
import { api, type Answer, type CardFront } from "../api.ts";
import { Explain } from "./Explain.tsx";

/** 题面里的空：一个空且答案单段时直接填进句子里（定稿方向 B），否则答案另起一块。 */
function Front({ front, answer }: { front: string; answer: Answer | null }) {
  const parts = front.split(/_{2,}/);
  const blanks = parts.length - 1;
  const inline = blanks === 1 && answer && !answer.answerPoints && answer.back.length <= 12 && !/\n/.test(answer.back);
  if (blanks === 0 || !inline) {
    return <h1 className="t-title" style={{ margin: "16px 0 0", fontSize: 28, lineHeight: "42px", whiteSpace: "pre-wrap" }}>{blanks === 0 ? front : parts.map((p, i) => <span key={i}>{p}{i < blanks && <span className="blank">&nbsp;</span>}</span>)}</h1>;
  }
  return <h1 className="t-title" style={{ margin: "16px 0 0", fontSize: 28, lineHeight: "42px", whiteSpace: "pre-wrap" }}>{parts[0]}<span className="fill">{answer!.back}</span>{parts[1]}</h1>;
}

/** 到期卡：正面 → 孩子主动看答案 → 点"会 / 不会"（按钮上写清下次什么时候）。反馈一句话，200ms 边框变色。 */
export function Review({ remaining, onDone }: { remaining: number; onDone: () => void }) {
  const [card, setCard] = useState<CardFront | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [n, setN] = useState(0);
  const shownAt = useRef(Date.now());
  const nextRef = useRef<CardFront | null>(null);

  const show = (c: CardFront) => { setCard(c); setAnswer(null); setFeedback(null); shownAt.current = Date.now(); };
  useEffect(() => { void api.nextCard().then((c) => { if (c) show(c); else onDone(); }); }, []);

  const submit = async (knew: boolean) => {
    if (!card) return;
    let r: Awaited<ReturnType<typeof api.review>>;
    try { r = await api.review(card.itemId, knew, Date.now() - shownAt.current); }
    catch { setFeedback({ text: "没记上，再点一次。", ok: false }); setTimeout(() => setFeedback(null), 1500); return; }
    setFeedback({ text: r.feedback, ok: r.rating > 1 });
    setN((x) => x + 1);
    nextRef.current = r.next;
  };
  const advance = () => { const nx = nextRef.current; if (nx) show(nx); else onDone(); };

  if (!card) return null;
  const total = remaining;
  const inlineAnswer = answer && card.front.split(/_{2,}/).length === 2 && !answer.answerPoints && answer.back.length <= 12;
  return (
    <section className="screen" style={{ minHeight: 0 }}>
      <div className="t-tag" style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
        <span>{card.subject}{card.kind === "wrong" ? " · 错题" : card.kind === "recitation" ? " · 默写" : ""}</span>
        <span>{Math.min(n + 1, total)} / {total}</span>
      </div>
      {card.kind === "listen" ? <audio controls autoPlay src={card.audio} style={{ width: "100%", marginTop: 16 }} /> : <Front front={card.front} answer={answer} />}
      <p className="t-tag" style={{ margin: "16px 0 0", letterSpacing: 0 }}>{card.sourceRef}{card.lastSeen ? ` · 上次见到是${card.lastSeen}` : " · 第一次见"}</p>
      {answer && !inlineAnswer && (
        <div className={`card fade ${feedback ? (feedback.ok ? "flash-ok" : "flash-weak") : ""}`} style={{ marginTop: 24, padding: "18px 20px" }}>
          <p className="t-tag" style={{ margin: 0 }}>答案</p>
          {answer.answerPoints ? answer.answerPoints.map((p, i) => <p key={i} style={{ margin: "6px 0 0" }}>{p}</p>) : <p style={{ margin: "6px 0 0", fontSize: 20, lineHeight: "30px", whiteSpace: "pre-wrap" }}>{answer.back}</p>}
          {feedback && <p style={{ margin: "14px 0 0", fontSize: 17, lineHeight: "26px" }}>{feedback.text}</p>}
        </div>
      )}
      {answer && inlineAnswer && feedback && <p className="fade" style={{ margin: "16px 0 0", fontSize: 17, lineHeight: "26px", color: feedback.ok ? "var(--text)" : "var(--weak)" }}>{feedback.text}</p>}
      {feedback && <Explain itemId={card.itemId} />}
      <div className="spacer" />
      {!answer ? (
        <button className="btn-primary" onClick={() => void api.answer(card.itemId).then(setAnswer)}>看答案</button>
      ) : !feedback ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="btn-primary split" onClick={() => void submit(true)}><span>会</span><span className="mono t-small" style={{ opacity: .7 }}>下次 · {card.preview.knew}</span></button>
          <button className="btn-secondary" onClick={() => void submit(false)}><span>不会</span><span className="mono t-small muted">下次 · {card.preview.unknown}</span></button>
        </div>
      ) : (
        <button className="btn-primary" onClick={advance}>下一题</button>
      )}
    </section>
  );
}
