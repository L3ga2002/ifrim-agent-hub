import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
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
