import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, openDb } from "../../src/server/db/open.ts";

describe("迁移：给老库补列", () => {
  it("缺 last_pass_session / points 时补上，已有时不动", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE session (id INTEGER PRIMARY KEY); CREATE TABLE card_state (item_id TEXT PRIMARY KEY, pass_streak INTEGER NOT NULL DEFAULT 0); CREATE TABLE chapter (id TEXT PRIMARY KEY); CREATE TABLE explanation (id INTEGER PRIMARY KEY)");
    expect(migrate(db)).toEqual(["card_state.last_pass_session", "chapter.points", "explanation.retry_at"]);
    expect(migrate(db)).toEqual([]);
    db.prepare("INSERT INTO session (id) VALUES (3)").run();
    db.prepare("INSERT INTO card_state (item_id, last_pass_session) VALUES ('a', 3)").run();
    expect((db.prepare("SELECT last_pass_session FROM card_state").get() as { last_pass_session: number }).last_pass_session).toBe(3);
  });
  it("新库不需要迁移", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toEqual([]);
  });
});
