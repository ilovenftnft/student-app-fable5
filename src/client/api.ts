export interface Today {
  date: string;
  session: { id: number; started: boolean; ended: boolean } | null;
  step: "checkin" | "recall" | "review" | "reflect" | "done";
  progress: { index: number; total: number };
  timer: { minutes: number; phase: "normal" | "break" | "can_end" | "hard_stop"; accent: boolean; message: string | null } | null;
  checkins: string[];
  recallPending: { chapterId: string; title: string; points: string[] }[];
  queue: { remaining: number; deferred: number; estMinutes: number };
  summary: { reviews: number; dueTomorrow: number };
}
export interface ChapterNode { id: string; title: string; page: number | null; points: { text: string; quote: string }[]; children: ChapterNode[] }
export interface CardFront { itemId: string; kind: string; subtype: string; front: string; isNew: boolean; audio?: string }
export interface Answer { back: string; answerPoints?: string[]; sourceQuote: string; sourceRef: string }
export interface Weekly { week: { from: string; to: string }; daysDone: number; daysTotal: number; masteredCards: number; weakest: { subject: string; topic: string } | null; suggestion: string }
export interface TodayItem { itemId: string; front: string }

export const SUBJECTS = ["语文", "数学", "英语", "历史", "地理", "生物", "道法"];
export interface ExamScore { id: number; date: string; name: string; subject_id: string; score: number; full_score: number; class_rank: number | null; class_size: number | null; grade_rank: number | null; grade_size: number | null }
export interface ExamInput { date: string; name: string; subject: string; score: string; fullScore: string; classRank: string; classSize: string; gradeRank: string; gradeSize: string }

async function req<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `${path} ${res.status}`;
    try { const j = await res.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* 非 JSON */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  today: () => req<Today>("/api/today"),
  chapters: () => req<Record<string, ChapterNode[]>>("/api/chapters"),
  checkin: (chapterIds: string[]) => req<Today>("/api/checkin", { chapterIds }),
  recallCarry: () => req<{ chapterId: string; title: string; points: { text: string }[] }[]>("/api/recall/carry"),
  recall: (chapterId: string, thinkMs: number, missed: number[]) => req<Today>("/api/recall", { chapterId, thinkMs, missed }),
  nextCard: () => req<CardFront | null>("/api/card/next"),
  answer: (id: string) => req<Answer>(`/api/card/${encodeURIComponent(id)}/answer`),
  review: (itemId: string, knew: boolean, elapsedMs: number) => req<{ rating: number; feedback: string; next: CardFront | null }>("/api/review", { itemId, knew, elapsedMs }),
  todayItems: () => req<TodayItem[]>("/api/today/items"),
  reflect: (r: { hardest: string | null; guessed: string | null; tomorrow: string | null }) => req<Today>("/api/reflect", r),
  end: () => req<Today>("/api/session/end", {}),
  weekly: () => req<Weekly>("/api/parent/weekly"),
  exams: () => req<ExamScore[]>("/api/parent/exams"),
  addExam: (e: ExamInput) => req<{ id: number }>("/api/parent/exams", e),
  deleteExam: (id: number) => req<{ ok: true }>(`/api/parent/exams/${id}`, {}, "DELETE"),
};
export const EXAM_SUBJECTS = ["总分", ...SUBJECTS];

