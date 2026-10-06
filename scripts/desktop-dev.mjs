// 桌面端开发联动：以注入 VITE_DEV_SERVER_URL 的方式启动 Electron（Windows cmd 不支持 VAR=... 前缀，故用 node 包装）
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
if (!existsSync(exe)) {
  console.error("找不到 Electron 可执行文件，请先运行 npm install");
  process.exit(1);
}
const child = spawn(exe, ["."], {
  cwd: root,
  env: { ...process.env, VITE_DEV_SERVER_URL: "http://localhost:5173" },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
