import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/server/db/open.ts";
import { startInbox } from "../../src/server/inbox/watcher.ts";
import * as store from "../../src/server/inbox/store.ts";

describe("StudyInbox 监听", () => {
  it("新图片出现后 30 秒内入库排队；非图片忽略", async () => {
    const db = openDb(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "inbox-"));
    const stop = startInbox(db, { dir, recognize: async () => ({ ok: false, error: "off", elapsedMs: 0 }), pollMs: 60_000 });
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(dir, "note.txt"), "x");
    writeFileSync(join(dir, "hw.jpg"), "jpg-bytes");
    copyFileSync(join(dir, "hw.jpg"), join(dir, "hw2.jpg")); // 同内容 → 去重
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && store.photos(db).length === 0) await new Promise((r) => setTimeout(r, 250));
    stop();
    const photos = store.photos(db);
    expect(photos).toHaveLength(1);
    expect(photos[0]!.status).toBe("queued");
  }, 30_000);
});
