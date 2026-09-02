import { useEffect, useRef, useState } from "react";
import { api, type Answer, type CardFront } from "../api.ts";
import { useExplain, ExplainMark, ExplainView } from "./Explain.tsx";
import { pronOf, Speaker, usePronunciation } from "../Speaker.tsx";

/** 题面里的空：答案能一一对应填进空里就直接填（一个空 = 整个答案；多个空 = 按"、"拆，段数须等于空数，每段 ≤ 12 字），否则答案另起一块。 */
function inlineFills(front: string, answer: Answer | null): string[] | null {
  if (!answer || answer.answerPoints || /\n/.test(answer.back)) return null;
  const blanks = front.split(/_{2,}/).length - 1;
  if (blanks === 0) return null;
  const pieces = blanks === 1 ? [answer.back] : answer.back.split("、");
  return pieces.length === blanks && pieces.every((x) => x.length <= 12) ? pieces : null;
}

/** 题面里的空：填进去的答案、紧跟的标点、✓/✗ 绑成一个不换行的整体，免得句号被单独挤到下一行（家长 09-02 指出）。 */
function Front({ front, fills, mark }: { front: string; fills: string[] | null; mark: React.ReactNode }) {
  const parts = front.split(/_{2,}/);
  const blanks = parts.length - 1;
  return (
    <h1 className="t-title" style={{ margin: 0, fontSize: 32, lineHeight: "48px", whiteSpace: "pre-wrap", textAlign: "center" }}>
      {parts.map((p, i) => {
        const [, punct = "", rest = p] = i > 0 ? (/^([，。；：、！？”’）〕】》]*)([\s\S]*)$/.exec(p) ?? []) : [];
        return (
          <span key={i}>
            {i > 0 && (
              <span style={{ whiteSpace: "nowrap" }}>
                {fills ? <span className="fill">{fills[i - 1]}</span> : <span className="blank">&nbsp;</span>}
                {punct}
                {i === blanks && fills && mark}
              </span>
            )}
            {i > 0 ? rest : p}
          </span>
        );
      })}
    </h1>
  );
}

/** 规律说法开头是字母组合（"ar 发 /ɑːr/…"、"tion 发…"），这个音块含它就加粗；"短元音:辅+元+辅"这类没有字母组合的不加。 */
function ruleHits(chunk: string, rule: string | undefined): boolean {
  const g = /^([a-z]+)\s/.exec(rule ?? "")?.[1];
  return !!g && chunk.toLowerCase().includes(g);
}

/** 对错反馈用符号，和答案排在同一行（家长 09-02 定）：✓ 强调色、✗ 错题色；句子只留给读屏。 */
function Mark({ ok, text }: { ok: boolean; text: string }) {
  return <span className="mark fade" role="img" aria-label={text} title={text} style={{ color: ok ? "var(--accent)" : "var(--weak)" }}>{ok ? "✓" : "✗"}</span>;
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

  const explain = useExplain(card?.itemId ?? "", feedback !== null);
  const prons = usePronunciation();
  if (!card) return null;
  // 英语单词卡：题面下给音标和喇叭（家长 09-02 加）；听写卡不给，音标会泄露拼写
  const pron = card.subject === "英语" && card.kind === "vocab" ? pronOf(prons, card.front) : undefined;
  const speakable = card.subject === "英语" && card.kind === "vocab";
  const total = remaining;
  const fills = inlineFills(card.front, answer);
  const inlineAnswer = fills !== null;
  return (
    <section className="screen" style={{ minHeight: 0 }}>
      {/* 铺满整个框（家长 09-02 定）：科目行贴进度条下方，出处行贴按钮上方，题目（和答案块）在中间等分空隙 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 28 }}>
        <span style={{ fontSize: 20, lineHeight: "28px", fontWeight: 500 }}>{card.subject}<span className="muted" style={{ fontSize: 16, fontWeight: 400 }}>{card.kind === "wrong" ? " · 错题" : card.kind === "recitation" ? " · 默写" : ""}</span></span>
        <span className="mono t-small muted">{Math.min(n + 1, total)} / {total}</span>
      </div>
      <div className="gap" />
      {card.kind === "listen" ? <audio controls autoPlay src={card.audio} style={{ width: "100%" }} /> : <Front front={card.front} fills={fills} mark={feedback ? <Mark ok={feedback.ok} text={feedback.text} /> : null} />}
      {speakable && (
        <>
          <div className="pron">
            {pron?.ipa && <span className="mono">/{pron.ipa}/</span>}
            <Speaker text={card.front} audio={pron?.audio ?? null} />
          </div>
          {/* 自然拼读拆分（家长 09-02 加，参考 vocabulary-building）：音块用 · 隔开，规律里的字母组合加粗；规律说法一行小字 */}
          {pron?.chunks && (
            <div className="chunks">
              <p className="mono" style={{ margin: 0 }}>{pron.chunks.map((c, i) => <span key={i}>{i > 0 && <span className="muted"> · </span>}<span className={ruleHits(c, pron.rule) ? "chunk-key" : undefined}>{c}</span></span>)}</p>
              {pron.rule && <p className="t-small muted" style={{ margin: "4px 0 0" }}>{pron.rule}</p>}
            </div>
          )}
        </>
      )}
      {answer && (!inlineAnswer || (feedback && explain.view)) && (
        <>
          <div className="gap" />
          <div>
            {!inlineAnswer && (
              <div className={`card fade ${feedback ? (feedback.ok ? "flash-ok" : "flash-weak") : ""}`} style={{ padding: "20px 22px", position: "relative" }}>
                {/* 不写"答案"两个字，内容居中，✓/✗ 紧跟在最后一行后面（家长 09-02 定） */}
                {answer.answerPoints
                  ? <>
                      {answer.answerPoints.map((p, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0, fontSize: 18, lineHeight: "28px", textAlign: "center", color: "var(--accent)" }}>{p}</p>)}
                      {feedback && <span className="mark-side"><Mark ok={feedback.ok} text={feedback.text} /></span>}{/* 多行答案：符号放卡片右缘垂直居中，不打乱各行对齐 */}
                    </>
                  : <p style={{ margin: 0, fontSize: 24, lineHeight: "36px", whiteSpace: "pre-wrap", textAlign: "center", color: "var(--accent)" }}>{answer.back}{feedback && <Mark ok={feedback.ok} text={feedback.text} />}</p>}
              </div>
            )}
            {feedback && <ExplainView view={explain.view} />}
          </div>
        </>
      )}
      <div className="gap" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 20px" }}>
        <p className="t-tag" style={{ margin: 0, letterSpacing: 0 }}>{card.sourceRef}{card.lastSeen ? ` · 上次见到是${card.lastSeen}` : " · 第一次见"}</p>
        {feedback && <ExplainMark gate={explain.gate} active={explain.active} onClick={explain.request} />}
      </div>
      {!answer ? (
        <button className="btn-primary" onClick={() => void api.answer(card.itemId).then(setAnswer)}>看答案</button>
      ) : !feedback ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="btn-primary split" onClick={() => void submit(true)}><span>会</span><span className="mono t-small muted">下次 · {card.preview.knew}</span></button>
          <button className="btn-secondary" onClick={() => void submit(false)}><span>不会</span><span className="mono t-small muted">下次 · {card.preview.unknown}</span></button>
        </div>
      ) : (
        <button className="btn-primary" onClick={advance}>下一题</button>
      )}
    </section>
  );
}
