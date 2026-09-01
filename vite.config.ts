import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/client",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787", "/audio": "http://127.0.0.1:8787" } },
});
