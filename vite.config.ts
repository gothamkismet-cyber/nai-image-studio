import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // base './'：Electron 以 file:// 加载 dist 时资源路径必须相对
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    watch: {
      // 证据目录含被 Electron 锁定的 Chromium 缓存文件，watch 会 EBUSY 崩溃
      ignored: ["**/.tavernweave/**", "**/release/**", "**/dist/**"],
    },
  },
});
