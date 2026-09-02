import { useEffect, useState } from "react";
import { api, SUBJECTS, type ChapterNode, type Today } from "../api.ts";
import { Point, recallCopy, recallTitle } from "./Recall.tsx";

type Leaf = { id: string; subject: string; title: string; parentTitle: string; path: string; points: { text: string; quote: string }[] };
type Pick = { leaf: Leaf; phase: "think" | "compare" | "done"; missed: Set<number>; startedAt: number; missedCount: number };

/**
 * 勾选 + 回想合成一屏，按科目展开（家长 2026-09-02 定）：
 * 点科目 → 展开该科的节目录 → 点那一节 → 就地回想（想一想 → 勾没想起来的）→ 收起并显示摘要。
 * 每科最多选一节；没有要点的节只记勾选。全部做完按"好了"，把勾选的章节一次提交（回想已逐节写库）。
 */
export function Checkin({ today, onDone }: { today: Today; onDone: (t: Today) => void }) {
  const [trees, setTrees] = useState<Record<string, ChapterNode[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [carry, setCarry] = useState<{ title: string; points: { text: string; quote: string }[] }[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    api.chapters().then(setTrees).catch((e) => setError(String(e)));
    api.recallCarry().then(setCarry).catch(() => {});
    const t = setInterval(() => tick((x) => x + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  const leavesOf = (subject: string): Leaf[] => {
    const out: Leaf[] = [];
    const walk = (nodes: ChapterNode[], path: string[]) => {
      for (const n of nodes) {
        if (n.children.length) walk(n.children, [...path, n.title]);
        else out.push({ id: n.id, subject, title: n.title, parentTitle: path[path.length - 1] ?? "", path: path.join(" · "), points: n.points.map((p) => ({ text: p.text, quote: p.quote || p.text })) }); // 回想显示教材原句，text 用来找概念词
      }
    };
    walk(trees[subject] ?? [], []);
    return out;
  };
  // 刷新页面后恢复：今天已回想过的章节
  useEffect(() => {
    if (!Object.keys(trees).length || !today.recalled.length) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const s of SUBJECTS) for (const l of leavesOf(s)) {
        const r = today.recalled.find((x) => x.chapterId === l.id);
        if (r && !next[s]) next[s] = { leaf: l, phase: "done", missed: new Set(), startedAt: 0, missedCount: r.missed };
      }
      return next;
    });
  }, [trees]);

  const setPick = (subject: string, p: Pick | null) => setPicks((m) => { const n = { ...m }; if (p) n[subject] = p; else delete n[subject]; return n; });
  const choose = (leaf: Leaf) => {
    if (leaf.points.length === 0) { setPick(leaf.subject, { leaf, phase: "done", missed: new Set(), startedAt: 0, missedCount: 0 }); setOpen(null); return; }
    setPick(leaf.subject, { leaf, phase: "think", missed: new Set(), startedAt: Date.now(), missedCount: 0 });
  };
  const finish = (p: Pick) => {
    const missed = [...p.missed];
    void api.recall(p.leaf.id, Date.now() - p.startedAt, missed).then(() => { setPick(p.leaf.subject, { ...p, phase: "done", missedCount: missed.length }); setOpen(null); });
  };
  const summary = (p: Pick) => {
    const c = recallCopy(p.leaf.subject);
    if (p.phase !== "done") return `${p.leaf.title} · 回想中`;
    if (p.leaf.points.length === 0) return p.leaf.title;
    return `${p.leaf.title} · ${p.missedCount ? `${p.missedCount} ${c.unit}明天再看` : "已回想"}`;
  };

  const all = Object.values(picks);
  const unfinished = all.filter((p) => p.phase !== "done");
  const label = unfinished.length ? "先把回想做完" : all.length ? "好了，去做卡" : "今天没学新的";
  const submit = () => void api.checkin(all.map((p) => p.leaf.id)).then(onDone);

  const panel = (subject: string) => {
    const p = picks[subject];
    if (!p) {
      const leaves = leavesOf(subject);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <p className="muted t-small" style={{ margin: 0 }}>章节目录没取到。{error}</p>}
          {!error && leaves.length === 0 && <p className="muted t-small" style={{ margin: 0 }}>这一科还没有章节目录。</p>}
          {leaves.map((l) => (
            <button key={l.id} className="choice" onClick={() => choose(l)}>
              <span>{l.title}</span>
              {l.path && <span className="mono t-small muted" style={{ display: "block", marginTop: 2 }}>{l.path}</span>}
            </button>
          ))}
        </div>
      );
    }
    const c = recallCopy(subject);
    const head = <p className="t-tag" style={{ margin: 0 }}>{recallTitle({ subject, parentTitle: p.leaf.parentTitle, title: p.leaf.title })}</p>;
    const swap = <button className="btn-text" onClick={() => setPick(subject, null)}>换一节</button>;
    if (p.phase === "think") {
      const minutes = Math.floor((Date.now() - p.startedAt) / 60_000);
      return (
        <div>
          {head}
          <h2 className="t-h" style={{ margin: "8px 0 4px" }}>{c.ask}</h2>
          <p className="muted" style={{ margin: 0 }}>{c.askSub}</p>
          <p className="mono t-small muted" style={{ margin: "12px 0 0" }}>{minutes} 分钟</p>
          <div style={{ marginTop: 20 }}><button className="btn-primary" onClick={() => setPick(subject, { ...p, phase: "compare" })}>想好了</button></div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>{swap}</div>
        </div>
      );
    }
    if (p.phase === "compare") {
      return (
        <div>
          {head}
          <h2 className="t-h" style={{ margin: "8px 0 4px" }}>{c.pick}</h2>
          <p className="muted" style={{ margin: "0 0 16px" }}>{c.pickSub}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {p.leaf.points.map((pt, i) => (
              <button key={i} className="choice" aria-pressed={p.missed.has(i)} onClick={() => setPick(subject, { ...p, missed: new Set(p.missed.has(i) ? [...p.missed].filter((x) => x !== i) : [...p.missed, i]) })}><Point p={pt} /></button>
            ))}
          </div>
          <div style={{ marginTop: 20 }}><button className="btn-primary" onClick={() => finish(p)}>{p.missed.size ? `${p.missed.size} ${c.unit}明天再看` : c.allOk}</button></div>
        </div>
      );
    }
    return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="muted">{summary(p)}</span>{swap}</div>;
  };

  return (
    <section className="screen" style={{ minHeight: 0 }}>
      {carry.length > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 24 }}>
          <p className="t-tag" style={{ margin: "0 0 8px" }}>昨天没想起来的，先看一眼</p>
          {carry.map((c) => c.points.map((pt, i) => <p key={c.title + i} style={{ margin: "4px 0" }}><Point p={pt} /></p>))}
        </div>
      )}
      <h1 className="t-title" style={{ margin: "40px 0 4px" }}>今天学到哪了</h1>
      <p className="muted" style={{ margin: "0 0 20px" }}>点今天上过的科目，再点那一节，顺手回想一下。</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SUBJECTS.map((s) => {
          const isOpen = open === s; const p = picks[s];
          return (
            <div key={s} className="card" style={{ borderColor: p ? "var(--accent)" : undefined }}>
              <button className="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s)}>
                <span style={{ fontSize: 18, lineHeight: "24px", fontWeight: 500 }}>{s}</span>
                <span className="t-small muted">{p ? summary(p) : isOpen ? "收起" : "没上"}</span>
              </button>
              {isOpen && <div className="fade" style={{ padding: "0 16px 16px" }}>{panel(s)}</div>}
            </div>
          );
        })}
      </div>
      <div className="spacer" />
      <button className="btn-primary" disabled={unfinished.length > 0} onClick={submit}>{label}</button>
    </section>
  );
}
