const { app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, nativeImage } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
require("./updates.cjs").registerUpdates({ app, BrowserWindow, ipcMain, dialog });

// 词库默认探测路径：配置为空时尝试，命中即零配置融合
const DEFAULT_LIB_DIR = "D:\\nai提示词";

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8"));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** 与库自身 index.html 的脚本顺序保持一致；读不到时 data.js 最先、其余按文件名排序 */
async function discoverDataFiles(dir) {
  const names = (await fsp.readdir(dir)).filter((n) => /^data.*\.js$/i.test(n));
  try {
    const html = await fsp.readFile(path.join(dir, "index.html"), "utf-8");
    // 注意 [^"]*：data.js 本身只有 ".js" 后缀，用 + 会漏掉它
    const order = [...html.matchAll(/<script src="(data[^"]*\.js)"/g)].map((m) => m[1]);
    const valid = order.filter((n) => names.includes(n));
    if (valid.length > 0) {
      return [...valid, ...names.filter((n) => !valid.includes(n)).sort()];
    }
  } catch {
    /* 无 index.html 走 fallback */
  }
  return names.sort((a, b) => (a === "data.js" ? -1 : b === "data.js" ? 1 : a.localeCompare(b)));
}

async function execDataChain(dir, fileNames) {
  if (fileNames.length > 64) throw new Error("词库超过 64 个数据文件的读取上限。");
  const codes = [];
  let bytes = 0;
  for (const name of fileNames) {
    const file = path.join(dir, name);
    bytes += (await fsp.stat(file)).size;
    if (bytes > 32 * 1024 * 1024) throw new Error("词库超过 32 MiB 的读取上限。");
    codes.push({ name, code: await fsp.readFile(file, "utf8") });
  }
  const { libraryFrameHtml, runLibrarySandbox } = await import("./library-runtime.mjs");
  const loader = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true,
    backgroundThrottling: false, partition: "nai-library-loader",
  } });
  loader.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loader.webContents.on("will-navigate", event => event.preventDefault());
  loader.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  loader.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "file://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await loader.loadURL("data:text/html,<!doctype html><title>Library loader</title>");
        return loader.webContents.executeJavaScript("(" + runLibrarySandbox.toString() + ")(" + JSON.stringify(codes) + ", " + JSON.stringify(libraryFrameHtml) + ")");
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("词库读取超时，已停止脚本。")), 12000); }),
    ]);
  } finally { clearTimeout(timer); if (!loader.isDestroyed()) loader.destroy(); }
}

function flatten(D) {
  const cats = Array.isArray(D?.cats) ? D.cats : [];
  const catNameById = new Map(cats.map((c) => [c.id, c.name]));
  const adultIds = new Set(cats.filter((c) => c.adult).map((c) => c.id));
  const entries = [];
  for (const [catId, items] of Object.entries(D?.tags ?? {})) {
    const catName = catNameById.get(catId) ?? catId;
    for (const item of items) {
      const [en, zh, note] = item;
      if (typeof en !== "string" || !en.trim()) continue;
      entries.push({ kind: "tag", en, zh: zh ?? "", note: note ?? "", prompt: en, catName, catId, adult: adultIds.has(catId) });
    }
  }
  for (const [catId, items] of Object.entries(D?.info ?? {})) {
    for (const item of items) {
      if (typeof item.t !== "string" || typeof item.s !== "string" || !item.s.trim()) continue;
      entries.push({
        kind: "recipe",
        en: item.t,
        zh: item.badge ?? "",
        note: item.b ?? "",
        prompt: item.s,
        catName: catNameById.get(catId) ?? catId,
        catId,
        adult: adultIds.has(catId),
      });
    }
  }
  return { version: D?.version ?? "?", cats: cats.map((c) => ({ id: c.id, name: c.name })), entries };
}

async function loadLib(dirPath) {
  const stat = await fsp.stat(dirPath).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error(`目录不存在：${dirPath}`);
  const names = await discoverDataFiles(dirPath);
  if (names.length === 0) throw new Error("目录里没有 data*.js 数据文件");
  const { data: D, failedFiles } = await execDataChain(dirPath, names);
  if (!D) throw new Error("数据链执行后没有产生 NAI_DATA（首个文件可能执行失败）");
  return { ...flatten(D), dirName: path.basename(dirPath), failedFiles };
}

function libResultPayload(result, dirPath, extra = {}) {
  if (result.state === "ready") {
    try {
      writeConfig({ ...readConfig(), promptLibDir: dirPath });
    } catch {
      /* 配置写失败不应吞掉已成功的加载 */
    }
  }
  return { ...result, dirPath, ...extra };
}

const appWindows = new WeakSet();
function validLibrarySender(event) {
  return appWindows.has(BrowserWindow.fromWebContents(event.sender)) && event.senderFrame === event.sender.mainFrame;
}
ipcMain.handle("promptlib:load", async (event) => {
  if (!validLibrarySender(event)) return { state: "error", message: "词库请求来源无效。" };
  try {
    const cfg = readConfig();
    let dir = cfg.promptLibDir;
    let autoDetected = false;
    if (!dir) {
      try {
        await fsp.access(DEFAULT_LIB_DIR);
        dir = DEFAULT_LIB_DIR;
        autoDetected = true;
      } catch {
        /* 默认路径不存在 */
      }
    }
    if (!dir) return { state: "unconfigured" };
    const data = await loadLib(dir);
    return libResultPayload({ state: "ready", data }, dir, { autoDetected });
  } catch (e) {
    return { state: "error", message: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("promptlib:pick", async (event) => {
  if (!validLibrarySender(event)) return { state: "error", message: "词库请求来源无效。" };
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, {
    title: "选择提示词库目录",
    properties: ["openDirectory"],
    defaultPath: DEFAULT_LIB_DIR,
  });
  if (res.canceled || !res.filePaths[0]) return { state: "canceled" };
  const dir = res.filePaths[0];
  try {
    const data = await loadLib(dir);
    return libResultPayload({ state: "ready", data }, dir);
  } catch (e) {
    return { state: "error", message: e && e.message ? e.message : String(e) };
  }
});

// 只接收当前窗口的 PNG 内容，不接受文件路径/URL，也不读取剪贴板。
ipcMain.handle("image:copy", async (event, png) => {
  try {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error("sender");
    if (!(png instanceof Uint8Array) || png.byteLength < 33 || png.byteLength > 32 * 1024 * 1024) throw new Error("size");
    const bytes = Buffer.from(png);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("format");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 16000000) throw new Error("dimensions");
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (image.isEmpty() || size.width !== width || size.height !== height) throw new Error("decode");
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
    return { ok: true };
  } catch {
    return { ok: false, message: "图片复制失败，请重试或使用下载 PNG。" };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "NAI 生图台",
    autoHideMenuBar: true,
    backgroundColor: "#18181b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  appWindows.add(win);
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // 自动化自测通道（NAI_SELFTEST=1 时启用，产品路径不含此逻辑）
  if (process.env.NAI_SELFTEST === "1") {
    win.webContents.on("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const r = await win.webContents.executeJavaScript(`(async () => {
            const out = { steps: [] };
            const step = (name, fn) => { try { return fn(); } catch (e) { out.steps.push(name + ": " + String(e)); return null; } };
            await new Promise(r => setTimeout(r, 1200));
            out.desktopBridge = !!window.desktop;
            const lib = await window.desktop.loadPromptLib();
            out.rawState = lib.state;
            out.libReady = lib.state === 'ready';
            out.libEntries = lib.data?.entries.length ?? 0;
            // V5 请求体校准断言：仅 dev 模式可动态 import 源码模块（生产 bundle 无 /src）
            if (location.protocol !== "file:") {
              const m = await import("/src/lib/nai.ts");
              const t = await import("/src/types.ts");
              const payload = m.buildPayload({ ...t.DEFAULT_PARAMS, seed: 1 });
              out.v5Model = t.DEFAULT_PARAMS.model;
              out.paramsVersion = payload.parameters.params_version;
              out.hasImageFormat = payload.parameters.image_format === "png";
              out.negSynced = payload.parameters.negative_prompt === t.DEFAULT_PARAMS.negativePrompt;
            }
            out.libHeader = (document.querySelector('.library-panel h2') || {}).textContent || '';
            const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('搜索'));
            if (inp) {
              step("setter", () => {
                const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setVal.call(inp, '银发');
              });
              step("dispatch", () => inp.dispatchEvent(new Event('input', { bubbles: true })));
              await new Promise(r => setTimeout(r, 400));
            }
            out.searchResults = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('追加')).length;
            try {
              const res = await fetch('https://api.novelai.net/user/subscription', { headers: { Authorization: 'Bearer pst-selftest-invalid' } });
              out.netStatus = res.status;
            } catch (e) { out.netError = String(e).slice(0, 120); }
            return out;
          })()`, true);
          console.log("[SELFTEST_RESULT]", JSON.stringify(r));
        } catch (e) {
          console.log("[SELFTEST_RESULT]", JSON.stringify({ fatal: String(e) }));
        }
        app.quit();
      }, 2000);
    });
    win.webContents.on("console-message", (_e, _level, message) => {
      if (message.includes("Error") || message.includes("error")) console.log("[renderer]", message.slice(0, 300));
    });
  }
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
