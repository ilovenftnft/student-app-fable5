import { useEffect, useState } from "react";
import { api, SUBJECTS, type ChapterNode, type Today } from "../api.ts";

/** 章节勾选："今天学到这"。一次看一科的叶子；勾好按主按钮。 */
export function Checkin({ onDone }: { onDone: (t: Today) => void }) {
  const [subject, setSubject] = useState(SUBJECTS[0]!);
  const [trees, setTrees] = useState<Record<string, ChapterNode[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  useEffect(() => { api.chapters().then(setTrees).catch((e) => setError(String(e))); }, []);
  const tree = trees[subject] ?? [];

  const leaves: { id: string; title: string; path: string }[] = [];
  const walk = (nodes: ChapterNode[], path: string[]) => {
    for (const n of nodes) {
      if (n.children.length) walk(n.children, [...path, n.title]);
      else leaves.push({ id: n.id, title: n.title, path: path.join(" · ") });
    }
  };
  walk(tree, []);

  const toggle = (id: string, label: string) => setPicked((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, label); return n; });

  return (
    <section>
      <h1 className="t-title" style={{ margin: "0 0 16px" }}>今天学到哪了</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {SUBJECTS.map((s) => <button key={s} className="btn-text" aria-pressed={s === subject} style={{ color: s === subject ? "var(--text)" : undefined, fontSize: 16 }} onClick={() => setSubject(s)}>{s}</button>)}
      </div>
      <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {error && <p className="muted t-small">章节目录没取到。{error}</p>}
        {!error && leaves.length === 0 && <p className="muted t-small">这一科还没有章节目录。</p>}
        {leaves.map((l) => (
          <button key={l.id} className="choice" aria-pressed={picked.has(l.id)} onClick={() => toggle(l.id, `${subject} ${l.title}`)}>
            <span>{l.title}</span>
            {l.path && <span className="t-small muted" style={{ display: "block" }}>{l.path}</span>}
          </button>
        ))}
      </div>
      {picked.size > 0 && <p className="t-small muted" style={{ marginTop: 12 }}>{[...picked.values()].join("，")}</p>}
      <div style={{ marginTop: 24 }}>
        <button className="btn-primary" onClick={() => void api.checkin([...picked.keys()]).then(onDone)}>{picked.size ? "好了" : "今天没学新的"}</button>
      </div>
    </section>
  );
}
