/** 识题结果 → problem 行。纯函数，golden 样本测试。 */
export interface RecognizedQuestion {
  number: string; type: string; stem: string; options: string[];
  student_answer?: string; teacher_mark?: "wrong" | "right" | "none"; reference_answer?: string;
  knowledge_points: string[]; grade_chapter: string; difficulty: string; confidence: number; needs_figure: boolean; bbox?: number[];
}
export interface Recognized { subject?: string; page_summary: string; questions: RecognizedQuestion[] }

const SUBJECTS = new Set(["语文", "数学", "英语", "历史", "地理", "生物", "道法"]);

export interface ProblemDraft {
  subject: string | null; stem: string; answer: string | null; tags: string[]; needsFigure: boolean;
  crop: number[] | null; teacherMark: "✗" | "✓" | null; confidence: number; raw: RecognizedQuestion;
}

export function toProblems(r: Recognized): ProblemDraft[] {
  const subject = r.subject && SUBJECTS.has(r.subject) ? r.subject : null;
  return r.questions
    .filter((q) => q.stem && q.stem.trim().length > 0)
    .map((q) => ({
      subject,
      stem: q.options?.length ? `${q.stem.trim()}\n${q.options.join("\n")}` : q.stem.trim(),
      answer: q.reference_answer?.trim() || null,
      tags: [...new Set([...(q.knowledge_points ?? []), q.grade_chapter].filter((t) => t && t.trim()))],
      needsFigure: !!q.needs_figure,
      crop: Array.isArray(q.bbox) && q.bbox.length === 4 ? q.bbox : null,
      teacherMark: q.teacher_mark === "wrong" ? "✗" : q.teacher_mark === "right" ? "✓" : null,
      confidence: typeof q.confidence === "number" ? q.confidence : 0,
      raw: q,
    }));
}

/** 待确认队列的默认排序：老师打 ✗ 的在前，其次置信度低的（更需要人看）。 */
export function sortForReview<T extends { teacherMark: "✗" | "✓" | null; confidence: number }>(ps: T[]): T[] {
  return [...ps].sort((a, b) => (b.teacherMark === "✗" ? 1 : 0) - (a.teacherMark === "✗" ? 1 : 0) || a.confidence - b.confidence);
}
