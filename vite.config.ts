import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";

const pkg = JSON.parse(
  fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8")
);
const appVersion =
  process.env.VITE_APP_VERSION ||
  process.env.APP_VERSION ||
  pkg.version ||
  "1.0.2";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
