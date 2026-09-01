import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex } from "../../src/server/inbox/engine.ts";

/** 假 codex：按 FAKE_MODE 表现为成功 / 挂起 / 额度触顶 / 无输出 */
function fakeBin(mode: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fakecodex-"));
  const bin = join(dir, "codex");
  writeFileSync(bin, `#!/bin/bash
out=""; while [[ $# -gt 0 ]]; do if [[ "$1" == "-o" ]]; then out="$2"; shift; fi; shift; done
echo '{"type":"thread.started","thread_id":"fake-thread"}'
case "${mode}" in
  ok) echo '{"type":"turn.completed"}'; echo '{"questions":[],"page_summary":"x","subject":"数学"}' > "$out" ;;
  hang) sleep 30 ;;
  quota) echo '{"type":"turn.failed","error":{"message":"usage limit reached, resets at 2030-01-01T00:00:00Z"}}'; exit 1 ;;
  empty) echo "Reading additional input from stdin..." >&2; exit 2 ;;
esac
`);
  chmodSync(bin, 0o755);
  return bin;
}
const base = { schemaPath: "/dev/null", prompt: "p", effort: "low" as const };

describe("runCodex", () => {
  it("成功：结果只从 -o 文件读，thread_id 来自事件流", async () => {
    const r = await runCodex<{ subject: string }>({ ...base, bin: fakeBin("ok"), deadlineMs: 5000 });
    expect(r.ok).toBe(true);
    expect(r.json?.subject).toBe("数学");
    expect(r.threadId).toBe("fake-thread");
  });
  it("超时：杀进程组并返回超时", async () => {
    const r = await runCodex({ ...base, bin: fakeBin("hang"), deadlineMs: 500 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/超时/);
    expect(r.elapsedMs).toBeLessThan(5000);
  });
  it("额度触顶：带重置时间", async () => {
    const r = await runCodex({ ...base, bin: fakeBin("quota"), deadlineMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.quotaResetAt?.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });
  it("无输出文件：stderr 噪音过滤后报退出码", async () => {
    const r = await runCodex({ ...base, bin: fakeBin("empty"), deadlineMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/退出码 2/);
  });
});
