/**
 * Codex 引擎（AGENTS.md「LLM 调用约定」）：
 *   codex exec -i <img> --sandbox read-only --skip-git-repo-check --json -c model_reasoning_effort=<档> --output-schema <schema> -o <out> "<prompt>" < /dev/null
 * stdin 接 /dev/null；detached 进程组；硬 deadline 到点杀进程组；结果只从 -o 文件读；stdout JSONL 只用来抓 thread_id 与错误事件。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Effort = "low" | "medium" | "high";

export interface EngineResult<T = unknown> {
  ok: boolean;
  json?: T;
  threadId?: string;
  error?: string;
  /** 额度触顶：事件里读到的重置时间 */
  quotaResetAt?: Date;
  exitCode?: number | null;
  elapsedMs: number;
}

export interface EngineOptions {
  image?: string;
  schemaPath: string;
  prompt: string;
  effort: Effort;
  deadlineMs: number;
  /** 测试用：替换可执行文件 */
  bin?: string;
  cwd?: string;
}

/** 从 JSONL 事件里抓 thread_id、错误文本、额度重置时间。纯函数，golden 测试覆盖。 */
export function parseEvents(jsonl: string): { threadId?: string; errors: string[]; quotaResetAt?: Date } {
  const errors: string[] = [];
  let threadId: string | undefined, quotaResetAt: Date | undefined;
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === "thread.started" && typeof ev.thread_id === "string") threadId = ev.thread_id;
    const msg = typeof ev.message === "string" ? ev.message : typeof ev.error === "string" ? ev.error : (ev.error as { message?: string } | undefined)?.message;
    if (ev.type === "error" || ev.type === "turn.failed" || (typeof ev.type === "string" && ev.type.endsWith(".failed"))) {
      if (msg) errors.push(msg);
    }
    const text = msg ?? "";
    if (/rate limit|usage limit|quota|too many requests/i.test(text)) {
      const at = /resets? (?:at|in) ([^.。\n]+)/i.exec(text)?.[1];
      const parsed = at ? Date.parse(at) : NaN;
      quotaResetAt = Number.isFinite(parsed) ? new Date(parsed) : new Date(Date.now() + 60 * 60_000);
      if (!errors.includes(text)) errors.push(text);
    }
  }
  return { threadId, errors, quotaResetAt };
}

export function runCodex<T = unknown>(o: EngineOptions): Promise<EngineResult<T>> {
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "codex-"));
  const out = join(dir, "out.json");
  const args = ["exec"];
  if (o.image) args.push("-i", o.image);
  args.push("--sandbox", "read-only", "--skip-git-repo-check", "--json", "-c", `model_reasoning_effort=${o.effort}`, "--output-schema", o.schemaPath, "-o", out, o.prompt);
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false;
    const child = spawn(o.bin ?? "codex", args, { stdio: ["ignore", "pipe", "pipe"], detached: true, cwd: o.cwd });
    const finish = (r: Omit<EngineResult<T>, "elapsedMs">) => {
      if (done) return; done = true;
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      resolve({ ...r, elapsedMs: Date.now() - started });
    };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* 已退出 */ }
      finish({ ok: false, error: `超时 ${o.deadlineMs} ms`, ...parseEvents(stdout) });
    }, o.deadlineMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish({ ok: false, error: String(e) }));
    child.on("close", (code) => {
      const ev = parseEvents(stdout);
      if (existsSync(out)) {
        try {
          const json = JSON.parse(readFileSync(out, "utf8")) as T;
          finish({ ok: true, json, threadId: ev.threadId, exitCode: code });
          return;
        } catch (e) { finish({ ok: false, error: `输出不是合法 JSON：${String(e)}`, threadId: ev.threadId, exitCode: code }); return; }
      }
      const noise = stderr.replace(/Reading additional input from stdin\.\.\.\s*/g, "").trim();
      finish({ ok: false, error: ev.errors[0] ?? (noise || `退出码 ${code}，无输出文件`), threadId: ev.threadId, quotaResetAt: ev.quotaResetAt, exitCode: code });
    });
  });
}
