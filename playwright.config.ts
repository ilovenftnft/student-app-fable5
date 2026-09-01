import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const TMP = join(import.meta.dirname, "tests/e2e/.tmp");
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  globalSetup: "./tests/e2e/setup.ts",
  use: { baseURL: "http://127.0.0.1:8799", viewport: { width: 480, height: 860 }, launchOptions: { args: ["--no-proxy-server"] } },
  projects: [{ name: "chromium", use: { browserName: "chromium", channel: "chromium" } }],
  webServer: { command: "node src/server/index.ts", port: 8799, env: { PORT: "8799", DATA_DIR: TMP, NO_PROXY: "127.0.0.1" }, reuseExistingServer: false },
});
