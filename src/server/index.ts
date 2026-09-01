/** 入口：node src/server/index.ts。PORT 默认 8787，DATA_DIR 见 db/open.ts。 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { openDb } from "./db/open.ts";
import { createApp } from "./app.ts";
import { ROOT } from "./content/textbooks.ts";

const db = openDb();
const app = createApp(db);
process.chdir(ROOT); // serveStatic 的 root 相对 cwd
app.use("/audio/*", serveStatic({ root: "./content" }));
if (existsSync("dist/client")) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));
}
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`listening on http://127.0.0.1:${port}`));
