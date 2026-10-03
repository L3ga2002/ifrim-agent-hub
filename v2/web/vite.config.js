import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { HUB_VERSION, API_CONTRACT } from "../server/config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  // M07: the build carries the contract it was made for; the API client refuses to drive a server with another one.
  define: { __UI_VERSION__: JSON.stringify(HUB_VERSION), __UI_CONTRACT__: String(API_CONTRACT) },
  server: {
    host: "127.0.0.1",
    port: 3011,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8011", changeOrigin: true } },
  },
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
