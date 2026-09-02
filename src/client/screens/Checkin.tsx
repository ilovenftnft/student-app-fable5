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
  const label = picked.size ? `好了，${[...picked.values()].map((v) => v.split(" ").slice(1).join(" ").split(" ")[0]).join("、")}` : "今天没学新的";

  return (
    <section className="screen" style={{ minHeight: 0 }}>
      <h1 className="t-title" style={{ margin: "40px 0 4px" }}>今天学到哪了</h1>
      <p className="muted" style={{ margin: "0 0 20px" }}>点一下今天上过的那节。</p>
      <div className="tabs" style={{ marginBottom: 14 }}>
        {SUBJECTS.map((s) => <button key={s} aria-pressed={s === subject} onClick={() => setSubject(s)}>{s}</button>)}
      </div>
      <div style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {error && <p className="muted t-small">章节目录没取到。{error}</p>}
        {!error && leaves.length === 0 && <p className="muted t-small">这一科还没有章节目录。</p>}
        {leaves.map((l) => (
          <button key={l.id} className="choice" aria-pressed={picked.has(l.id)} onClick={() => toggle(l.id, `${subject} ${l.title}`)}>
            <span>{l.title}</span>
            {l.path && <span className="mono t-small muted" style={{ display: "block", marginTop: 2 }}>{l.path}</span>}
          </button>
        ))}
      </div>
      {picked.size > 0 && <p className="t-small muted" style={{ marginTop: 12 }}>{[...picked.values()].join("，")}</p>}
      <div style={{ marginTop: 24 }}>
        <button className="btn-primary" onClick={() => void api.checkin([...picked.keys()]).then(onDone)}>{label}</button>
      </div>
    </section>
  );
}
