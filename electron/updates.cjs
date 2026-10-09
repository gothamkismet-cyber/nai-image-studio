const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path");
const crypto = require("node:crypto"), { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const runFile = promisify(execFile);
const APP_GUID = "ffcd3877-c614-52f9-84f7-1d5625f865ef";
const REPO_URL = "https://github.com/gothamkismet-cyber/nai-image-studio";
const LATEST_RELEASE_API = "https://api.github.com/repos/gothamkismet-cyber/nai-image-studio/releases/latest";

async function readReleaseResponse(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("GitHub 返回的版本信息不完整，请稍后重试。");
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("GitHub 返回的版本信息过大，请稍后重试。");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}
async function checkLatestReleasePage(currentVersion, fetchRelease) {
  const response = await fetchRelease(`${REPO_URL}/releases/latest`, {
    headers: { Accept: "text/html", "User-Agent": "NAI-Image-Studio" },
    redirect: "follow", credentials: "omit", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("GitHub 下载页暂时无法读取。");
  const html = await readReleaseResponse(response, 512 * 1024);
  const meta = html.match(/<meta\b[^>]*>/gi)?.find(tag => /\bproperty\s*=\s*["']og:url["']/i.test(tag));
  const canonical = meta?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  let url;
  try { url = new URL(canonical || "", REPO_URL).href; } catch { throw new Error("GitHub 下载页版本无法读取。"); }
  const prefix = `${REPO_URL}/releases/tag/`;
  const match = url.startsWith(prefix) && /^v(\d+\.\d+\.\d+)$/.exec(url.slice(prefix.length));
  if (!match) throw new Error("GitHub 下载页版本不符合本软件的发布规则。");
  // /releases/latest 由 GitHub 指向最新正式发布；网页只提供版本，不推测安装包是否存在。
  return { state: "ready", latestVersion: match[1], newer: compareVersions(match[1], currentVersion) > 0,
    url, notes: "", publishedAt: "", installerAvailable: null, source: "page" };
}
async function checkLatestRelease(currentVersion, fetchRelease = globalThis.fetch) {
  const response = await fetchRelease(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "NAI-Image-Studio" },
    redirect: "error", credentials: "omit", signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) throw new Error("GitHub 暂时没有可下载的正式版本，请稍后重试。");
  if (response.status === 403 || response.status === 429) {
    try { return await checkLatestReleasePage(currentVersion, fetchRelease); }
    catch { throw new Error("GitHub 查询次数暂时用完了，下载页也无法读取，请稍后重试。"); }
  }
  if (!response.ok) throw new Error(`检查新版失败（HTTP ${response.status}），请稍后重试。`);
  const json = await readReleaseResponse(response, 256 * 1024);
  let data;
  try { data = JSON.parse(json); }
  catch { throw new Error("GitHub 返回的版本信息无法读取，请稍后重试。"); }
  const match = /^v(\d+\.\d+\.\d+)$/.exec(data?.tag_name);
  if (!match || data.draft !== false || data.prerelease !== false || data.html_url !== `${REPO_URL}/releases/tag/${data.tag_name}`) {
    throw new Error("GitHub 返回的版本信息不符合本软件的发布规则，请到仓库下载页核对。");
  }
  const version = match[1];
  const names = new Set(Array.isArray(data.assets) ? data.assets.map(a => a?.name) : []);
  const filename = `NAI-Image-Studio-Setup-${version}.exe`;
  return { state: "ready", latestVersion: version, newer: compareVersions(version, currentVersion) > 0,
    url: data.html_url, notes: typeof data.body === "string" ? data.body.slice(0, 4000) : "",
    publishedAt: typeof data.published_at === "string" && Number.isFinite(Date.parse(data.published_at)) ? data.published_at : "",
    installerAvailable: names.has(filename) && names.has(filename + ".sha256"), source: "api" };
}

function compareVersions(a, b) {
  const parse = (v) => {
    if (typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) throw new Error("安装包版本格式不正确。");
    const parts = v.split(".").map(Number);
    if (parts.some((n) => !Number.isSafeInteger(n))) throw new Error("安装包版本格式不正确。");
    return parts;
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function readInstallerVersion(file) {
  // 路径只来自原生文件选择器，使用 PowerShell 单引号字面量，不经过 shell 拼接。
  const literal = "'" + file.replace(/'/g, "''") + "'";
  const command = `$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $v=(Get-Item -LiteralPath ${literal}).VersionInfo; @{name=$v.ProductName;version=$v.ProductVersion}|ConvertTo-Json -Compress`;
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const { stdout } = await runFile(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true, timeout: 15000, maxBuffer: 8192 });
  return JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
}
async function inspectInstaller(file, readVersion = readInstallerVersion) {
  const resolved = await fsp.realpath(file);
  const filename = path.basename(resolved);
  const match = /^(?:NAI生图台|NAI-Image-Studio)-Setup-(\d+\.\d+\.\d+)\.exe$/i.exec(filename);
  if (!match) throw new Error("请选择 NAI-Image-Studio-Setup-版本号.exe 或 NAI生图台-Setup-版本号.exe 安装包，不能选择程序本体或便携版。");
  const stat = await fsp.stat(resolved);
  if (!stat.isFile() || stat.size < 1024 || stat.size > 1024 * 1024 * 1024) throw new Error("安装包文件大小不正确。");
  const handle = await fsp.open(resolved, "r");
  try { const header = Buffer.alloc(2); await handle.read(header, 0, 2, 0); if (header.toString("ascii") !== "MZ") throw new Error("安装包不是 Windows 程序。"); }
  finally { await handle.close(); }
  let checksum;
  try {
    const sidecar = resolved + ".sha256";
    if ((await fsp.stat(sidecar)).size > 512) throw new Error("size");
    checksum = (await fsp.readFile(sidecar, "utf8")).trim().replace(/^\uFEFF/, "");
  } catch { throw new Error("缺少或无法读取校验文件。请将安装包与同名 .exe.sha256 文件放在一起，再重新选择。"); }
  const parts = /^([a-f\d]{64})(?:\s+\*?(.+))?$/i.exec(checksum);
  if (!parts || (parts[2] && parts[2] !== filename)) throw new Error("校验文件格式或对应文件名不正确，请重新获取安装包和校验文件。");
  const sha256 = await hashFile(resolved);
  if (sha256 !== parts[1].toLowerCase()) throw new Error("安装包校验失败，文件可能未下载完整或已改动。请重新获取安装包。");
  const metadata = await readVersion(resolved);
  if (metadata.name !== "NAI生图台" || metadata.version !== match[1]) throw new Error("安装包产品名称或版本与文件名不一致，不能更新。");
  return { file: resolved, filename, version: match[1], sha256 };
}
function launchInstaller(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, ["--updated", "--force-run"], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

function registerUpdates({ app, ipcMain, dialog, BrowserWindow, net, shell }, deps = {}) {
  const inspect = deps.inspectInstaller || inspectInstaller;
  const launch = deps.launchInstaller || launchInstaller;
  const quit = deps.scheduleQuit || (() => setTimeout(() => app.quit(), 200));
  const platform = deps.platform || process.platform;
  const checkingRelease = new Set();
  const pending = new Map(), choosing = new Set(), owners = new WeakSet();
  let installing = false;
  function windowFor(event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) throw new Error("更新请求来源不正确。");
    if (!owners.has(event.sender)) {
      owners.add(event.sender);
      event.sender.once("destroyed", () => { pending.delete(event.sender.id); choosing.delete(event.sender.id); });
    }
    return win;
  }
  function ensureAvailable() {
    if (platform !== "win32" || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) throw new Error("本地覆盖更新只用于 Windows 安装版。源码或便携版请直接运行新版安装包。");
    if (installing) throw new Error("已经在启动安装，请稍候。");
  }
  ipcMain.handle("updates:info", async (event) => {
    windowFor(event);
    return { version: app.getVersion(), available: platform === "win32" && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR,
      installDir: app.isPackaged ? path.dirname(app.getPath("exe")) : "", mode: "local" };
  });
  ipcMain.handle("updates:check-latest", async (event) => {
    let owner, claimed = false;
    try {
      const win = windowFor(event); owner = event.sender.id;
      if (checkingRelease.has(owner)) throw new Error("正在检查新版，请稍候。");
      checkingRelease.add(owner);
      claimed = true;
      const result = await checkLatestRelease(app.getVersion(), deps.fetchRelease || net.fetch.bind(net));
      return win.isDestroyed() ? { state: "error", message: "更新窗口已关闭，请重新检查。" } : result;
    } catch (e) {
      const message = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
        ? "检查新版超时，请检查网络或代理后重试。"
        : e instanceof Error && /GitHub|检查新版|正在检查/.test(e.message) ? e.message : "连不上 GitHub，请检查网络或代理后重试。";
      return { state: "error", message };
    } finally { if (claimed) checkingRelease.delete(owner); }
  });
  ipcMain.handle("updates:open-releases", async (event) => {
    try { windowFor(event); await (deps.openExternal || shell.openExternal)(`${REPO_URL}/releases/latest`); return { ok: true }; }
    catch { return { ok: false, message: "下载页无法打开，请手动访问 GitHub 仓库的 Releases。" }; }
  });
  ipcMain.handle("updates:choose", async (event) => {
    try {
      const win = windowFor(event); ensureAvailable();
      const owner = event.sender.id;
      if (choosing.has(owner)) throw new Error("正在检查安装包，请稍候。");
      choosing.add(owner); pending.delete(owner);
      try {
        const res = await dialog.showOpenDialog(win, { title: "选择新版 NAI 生图台安装包", properties: ["openFile"], filters: [{ name: "NAI 生图台安装包", extensions: ["exe"] }] });
        if (res.canceled || !res.filePaths[0]) return { state: "canceled" };
        const item = await inspect(res.filePaths[0]);
        if (compareVersions(item.version, app.getVersion()) < 0) throw new Error("所选版本比当前版本旧，请选择新版；同版本可覆盖重新安装。");
        if (win.isDestroyed()) return { state: "canceled" };
        const id = crypto.randomUUID();
        pending.set(owner, { ...item, id, expires: Date.now() + 15 * 60 * 1000 });
        return { state: "ready", id, version: item.version, filename: item.filename, sameVersion: compareVersions(item.version, app.getVersion()) === 0 };
      } finally { choosing.delete(owner); }
    } catch (e) { return { state: "error", message: e instanceof Error ? e.message : "安装包检查失败，请重新选择。" }; }
  });
  ipcMain.handle("updates:install", async (event, id) => {
    try {
      const win = windowFor(event); ensureAvailable();
      const item = pending.get(event.sender.id);
      if (!item || typeof id !== "string" || item.id !== id || item.expires < Date.now() || choosing.has(event.sender.id)) throw new Error("安装包选择已经失效，请重新选择。");
      installing = true;
      let handedOff = false;
      try {
        const confirmation = await dialog.showMessageBox(win, { type: "question", title: "覆盖安装 NAI 生图台", message: `安装 ${item.version} 并关闭当前生图台？`,
          detail: `安装包：${item.file}\n\n只使用你信任的本软件安装包，完整性校验不代表发布者身份。安装器会沿用已登记的安装位置覆盖程序，保留已保存的提示词、配置和历史。请在安装向导中完成更新。`,
          buttons: ["覆盖安装并关闭", "取消"], defaultId: 1, cancelId: 1, noLink: true });
        if (confirmation.response !== 0) return { state: "canceled" };
        // 固定主进程选中的文件，复制后再次校验，后续启动只使用本机暂存副本。
        const dir = await fsp.mkdtemp(path.join(app.getPath("temp"), "nai-studio-update-"));
        const staged = path.join(dir, item.filename);
        await fsp.copyFile(item.file, staged);
        if (await hashFile(staged) !== item.sha256) throw new Error("安装包在选择后发生了变化，请重新选择。当前程序不会关闭。");
        await launch(staged);
        handedOff = true;
        pending.delete(event.sender.id); quit();
        return { state: "launching" };
      } finally { if (!handedOff) installing = false; }
    } catch (e) { return { state: "error", message: e instanceof Error ? e.message : "安装程序启动失败，当前生图台仍保留。请重试。" }; }
  });
}
module.exports = { registerUpdates, compareVersions, inspectInstaller, hashFile, checkLatestRelease, APP_GUID };
