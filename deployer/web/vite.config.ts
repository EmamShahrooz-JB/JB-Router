import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Builds the deployer page into a single self-contained index.html (JS + CSS inlined), which is
// what `node deployer/build/make-page.mjs` copies to deployer/static/index.html for the Worker.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 1024 * 1024
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
});
