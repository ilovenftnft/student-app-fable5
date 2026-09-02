import { useEffect, useState } from "react";
import { api, inboxApi, EXAM_SUBJECTS, SUBJECTS, type ExamInput, type ExamScore, type InboxPhoto, type Problem, type Weekly } from "../api.ts";

/** 家长页：周报四项 + 成绩与位次录入 + 位次趋势。同一视觉系统，信息密度可更高；不显示逐题与时长。 */
export function Parent() {
  const [w, setW] = useState<Weekly | null>(null);
  const [exams, setExams] = useState<ExamScore[]>([]);
  const reload = () => api.exams().then(setExams);
  useEffect(() => { void api.weekly().then(setW); void reload(); }, []);
  if (!w) return null;
  return (
    <section>
      <header className="mono t-small muted" style={{ display: "flex", justifyContent: "space-between" }}><span>家长</span><span>{w.week.from} 至 {w.week.to}</span></header>
      <h1 className="t-title" style={{ margin: "32px 0 20px" }}>这一周</h1>
      <div className="card" style={{ padding: "4px 18px" }}>
        <Row label="完成天数" value={`${w.daysDone} / ${w.daysTotal}`} />
        <Row label="已掌握卡片" value={String(w.masteredCards)} />
        <Row label="讲解次数" value={String(w.explanations)} />
        <Row label="最薄弱的一点" value={w.weakest ? `${w.weakest.subject} · ${w.weakest.topic}` : "还没有数据"} last />
      </div>
      <p style={{ margin: "20px 0 0", fontSize: 17, lineHeight: "27px" }}>{w.suggestion}</p>

      <Inbox />

      <h2 className="t-h" style={{ margin: "44px 0 12px" }}>成绩与位次</h2>
      <RankChart exams={exams} />
      <ExamTable exams={exams} onDelete={(id) => void api.deleteExam(id).then(reload)} />
      <ExamForm onAdded={reload} />
    </section>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <span className="muted">{label}</span><span className="num">{value}</span>
    </div>
  );
}

/** 位次趋势：一科一条线（单序列，无图例），y 轴倒置——第 1 名在上。2px 线、8px 标记、hover 提示。 */
function RankChart({ exams }: { exams: ExamScore[] }) {
  const subjects = EXAM_SUBJECTS.filter((s) => exams.some((e) => e.subject_id === s && e.class_rank !== null));
  const [subject, setSubject] = useState<string | null>(null);
  const cur = subject && subjects.includes(subject) ? subject : subjects[0];
  if (!cur) return <p className="muted t-small">录入两次以上带班级排名的成绩后，这里出现位次趋势。</p>;
  const pts = exams.filter((e) => e.subject_id === cur && e.class_rank !== null).sort((a, b) => a.date.localeCompare(b.date));
  const W = 600, H = 200, L = 40, R = 16, T = 16, B = 32;
  const maxRank = Math.max(...pts.map((p) => p.class_size ?? p.class_rank!), 10);
  const x = (i: number) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (r: number) => T + ((r - 1) * (H - T - B)) / (maxRank - 1);
  const ticks = [1, Math.round(maxRank / 2), maxRank];
  return (
    <figure style={{ margin: "0 0 16px" }}>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {subjects.map((s) => <button key={s} aria-pressed={s === cur} onClick={() => setSubject(s)}>{s}</button>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${cur} 班级位次趋势`} style={{ width: "100%", height: "auto", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)" className="num">{t}</text>
          </g>
        ))}
        <polyline fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" points={pts.map((p, i) => `${x(i)},${y(p.class_rank!)}`).join(" ")} />
        {pts.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.class_rank!)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
            <circle cx={x(i)} cy={y(p.class_rank!)} r={12} fill="transparent"><title>{`${p.date} ${p.name}：第 ${p.class_rank} 名${p.class_size ? ` / ${p.class_size}` : ""}`}</title></circle>
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{p.name}</text>
          </g>
        ))}
      </svg>
      <figcaption className="t-small muted">{cur} · 班级位次（上为第 1 名）</figcaption>
    </figure>
  );
}

function ExamTable({ exams, onDelete }: { exams: ExamScore[]; onDelete: (id: number) => void }) {
  if (exams.length === 0) return null;
  return (
    <div style={{ overflowX: "auto", marginBottom: 16 }}>
      <table className="t-small" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr className="muted">{["日期", "考试", "科目", "分数", "班级", "年级", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", fontWeight: 400 }}>{h}</th>)}</tr></thead>
        <tbody>
          {exams.map((e) => (
            <tr key={e.id}>
              <td className="num" style={td}>{e.date}</td><td style={td}>{e.name}</td><td style={td}>{e.subject_id}</td>
              <td className="num" style={td}>{e.score} / {e.full_score}</td>
              <td className="num" style={td}>{e.class_rank ?? "—"}{e.class_size ? ` / ${e.class_size}` : ""}</td>
              <td className="num" style={td}>{e.grade_rank ?? "—"}{e.grade_size ? ` / ${e.grade_size}` : ""}</td>
              <td style={td}><button className="btn-text" onClick={() => onDelete(e.id)}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const td = { padding: "6px 8px", borderBottom: "1px solid var(--border)" } as const;

function ExamForm({ onAdded }: { onAdded: () => void }) {
  const empty: ExamInput = { date: "", name: "", subject: "总分", score: "", fullScore: "", classRank: "", classSize: "", gradeRank: "", gradeSize: "" };
  const [f, setF] = useState<ExamInput>(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof ExamInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.addExam(f); setF({ ...empty, date: f.date, name: f.name }); setMsg("已记录。"); onAdded(); }
    catch (err) { setMsg(String((err as Error).message)); }
  };
  const field = (label: string, k: keyof ExamInput, type = "text") => (
    <label className="t-small muted" style={{ display: "block" }}>{label}<input type={type} value={f[k]} onChange={set(k)} style={{ marginTop: 4 }} /></label>
  );
  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {field("日期", "date", "date")}
      {field("考试名称（期中 / 期末 / 月考）", "name")}
      <label className="t-small muted" style={{ display: "block" }}>科目
        <select value={f.subject} onChange={set("subject")} style={{ display: "block", marginTop: 4, width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 16 }}>
          {EXAM_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{field("分数", "score", "number")}{field("满分", "fullScore", "number")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{field("班级排名", "classRank", "number")}{field("班级人数", "classSize", "number")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{field("年级排名", "gradeRank", "number")}{field("年级人数", "gradeSize", "number")}</div>
      <div style={{ gridColumn: "1 / -1" }}>
        <button className="btn-primary" type="submit">记录这次考试</button>
        {msg && <p className="t-small muted" style={{ textAlign: "center", marginTop: 8 }}>{msg}</p>}
      </div>
    </form>
  );
}

/** 待确认队列：照片 → 识出的题 → 家长确认成卡 / 不要。Codex 不可用时显示"稍后重试"。 */
function Inbox() {
  const [photos, setPhotos] = useState<InboxPhoto[]>([]);
  const [pending, setPending] = useState<Problem[]>([]);
  const reload = () => Promise.all([inboxApi.photos().then(setPhotos), inboxApi.pending().then(setPending)]);
  useEffect(() => { void reload(); const t = setInterval(() => void reload(), 20_000); return () => clearInterval(t); }, []);
  const label: Record<string, string> = { queued: "排队中", running: "识别中", done: "已识别", failed: "失败", retry_later: "稍后重试" };
  const waiting = photos.filter((p) => p.status !== "done");
  return (
    <section>
      <h2 className="t-h" style={{ margin: "44px 0 12px" }}>待确认</h2>
      {waiting.length > 0 && (
        <ul className="t-small muted" style={{ paddingLeft: 16, margin: "0 0 16px" }}>
          {waiting.map((p) => <li key={p.id}>{p.path.split("/").pop()} · {label[p.status] ?? p.status}{p.error ? ` · ${p.error}` : ""}</li>)}
        </ul>
      )}
      {pending.length === 0 && waiting.length === 0 && <p className="muted t-small">把作业或试卷照片放进 ~/StudyInbox，识别出的题会出现在这里。</p>}
      {pending.map((p) => <ProblemCard key={p.id} p={p} onDone={reload} />)}
    </section>
  );
}

function ProblemCard({ p, onDone }: { p: Problem; onDone: () => void }) {
  const [subject, setSubject] = useState(p.subject ?? "");
  const [answer, setAnswer] = useState(p.answer ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); onDone(); } catch (e) { setMsg(String((e as Error).message)); } };
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <img src={`/${p.photoPath}`} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="t-small muted" style={{ margin: "0 0 4px" }}>
            {p.teacherMark === "✗" ? "老师打了 ✗ · " : p.teacherMark === "✓" ? "老师打了 ✓ · " : ""}置信度 {Math.round(p.confidence * 100)}%{p.needsFigure ? " · 带图" : ""}
          </p>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.stem}</p>
          {p.tags.length > 0 && <p className="t-small muted" style={{ margin: "8px 0 0" }}>{p.tags.join(" · ")}</p>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 12 }}>
        <select value={subject} onChange={(e) => setSubject(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 16 }}>
          <option value="">科目</option>{SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" placeholder="正确答案" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, alignItems: "center" }}>
        {msg && <span className="t-small muted">{msg}</span>}
        <button className="btn-text" onClick={() => void act(() => inboxApi.reject(p.id))}>不要</button>
        <button className="btn-primary" style={{ width: 120, padding: "10px 16px", fontSize: 16 }} onClick={() => void act(() => inboxApi.confirm(p.id, { subject: subject || undefined, answer: answer || undefined }))}>成卡</button>
      </div>
    </div>
  );
}
