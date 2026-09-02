/** 入口：node src/server/index.ts。PORT 默认 8787，DATA_DIR 见 db/open.ts。 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { openDb } from "./db/open.ts";
import { createApp } from "./app.ts";
import { ROOT } from "./content/textbooks.ts";
import { DATA_DIR } from "./db/open.ts";
import { startInbox } from "./inbox/watcher.ts";
import { codexExplainer, codexVerifier, fakeExplainer, passVerifier, retryDue } from "./explain/service.ts";

const db = openDb();
// EXPLAIN=fake：端到端测试用的假讲解，不调用 Codex
const app = createApp(db, undefined, process.env.EXPLAIN === "fake" ? { explainer: fakeExplainer, verifier: passVerifier } : {});
process.chdir(ROOT); // serveStatic 的 root 相对 cwd
app.use("/audio/*", async (c, next) => { await next(); if (c.req.path.endsWith(".ogg")) c.res.headers.set("content-type", "audio/ogg"); }); // serveStatic 不认 .ogg，给个正确的类型
app.use("/audio/*", serveStatic({ root: "./content" }));
app.use("/photos/*", serveStatic({ root: DATA_DIR.startsWith("/") ? DATA_DIR : `./${DATA_DIR}` }));
if (process.env.INBOX !== "off") startInbox(db);
if (process.env.EXPLAIN !== "fake") setInterval(() => void retryDue(db, new Date(), codexExplainer, codexVerifier).catch((e) => console.error(`[explain] ${String(e)}`)), 60_000);
if (existsSync("dist/client")) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));
}
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`listening on http://127.0.0.1:${port}`));
