/**
 * XSN 提示词库（D:\nai提示词）接入层。
 *
 * 该库的数据是若干 `data*.js` 文件：data.js 定义 window.NAI_DATA，
 * 其余文件是往 NAI_DATA 追加的 IIFE。这里按库自身 index.html 的脚本顺序
 * 在禁止联网、无同源权限的 Worker 中执行，得到与原库一致的合并数据。
 */

import type { GenParams } from "../types";
import { insertedPromptChips } from "./prompt-chips";
import { libraryFrameHtml, runLibrarySandbox } from "../../electron/library-runtime.mjs";

export type LibTarget = { kind: "main" } | { kind: "negative" } | { kind: "char"; id: string; negative?: boolean };

export interface LibEntry {
  kind: "tag" | "recipe";
  /** 词条=英文 tag；配方=标题 */
  en: string;
  /** 词条=中文名；配方=徽标 */
  zh: string;
  note: string;
  /** 可插入的提示词文本 */
  prompt: string;
  catName: string;
  catId: string;
  adult: boolean;
}

export interface LibData {
  version: string;
  cats: { id: string; name: string }[];
  entries: LibEntry[];
  /** 执行失败被跳过的数据文件（词条可能不全，需向用户可见） */
  failedFiles?: string[];
}

export type LibStatus =
  | { state: "idle" }
  | { state: "need-permission" }
  | { state: "loading" }
  | { state: "ready"; data: LibData; dirName: string }
  | { state: "error"; message: string };

/* ---------- 桌面端（Electron）分支：主进程直接读文件，免目录授权 ---------- */

interface DesktopIpcResult {
  state: "ready" | "unconfigured" | "canceled" | "error";
  data?: LibData & { dirName?: string };
  dirName?: string;
  message?: string;
}

declare global {
  interface Window {
    desktop?: {
      loadPromptLib: () => Promise<DesktopIpcResult>;
      pickPromptLibDir: () => Promise<DesktopIpcResult>;
      copyImage?: (png: Uint8Array) => Promise<{ ok: boolean; message?: string }>;
      updateInfo?: () => Promise<import("../components/UpdateDialog").UpdateInfo>;
      checkLatestRelease?: () => Promise<import("../components/UpdateDialog").ReleaseCheck>;
      openReleases?: () => Promise<{ ok: boolean; message?: string }>;
      chooseUpdate?: () => Promise<import("../components/UpdateDialog").UpdateResult>;
      installUpdate?: (id: string) => Promise<import("../components/UpdateDialog").UpdateResult>;
    };
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && typeof window.desktop?.loadPromptLib === "function";
}

function ipcToStatus(r: DesktopIpcResult): LibStatus {
  switch (r.state) {
    case "ready":
      return {
        state: "ready",
        data: r.data!,
        dirName: r.data?.dirName ?? "提示词库",
      };
    case "error":
      return { state: "error", message: r.message ?? "未知错误" };
    case "unconfigured":
      return { state: "idle" };
    case "canceled":
      return { state: "idle" };
  }
}

export async function desktopLoadLib(): Promise<LibStatus> {
  if (!isDesktop()) return { state: "idle" };
  try {
    return ipcToStatus(await window.desktop!.loadPromptLib());
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function desktopPickLib(): Promise<LibStatus> {
  if (!isDesktop()) return { state: "idle" };
  try {
    return ipcToStatus(await window.desktop!.pickPromptLibDir());
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

const FS_DB = "nai-image-studio-fs";
const FS_STORE = "handles";
const HANDLE_KEY = "promptlib-dir";

function openFsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FS_STORE)) {
        req.result.createObjectStore(FS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

export async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FS_STORE, "readwrite");
    tx.objectStore(FS_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openFsDb();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(FS_STORE, "readonly");
    const req = tx.objectStore(FS_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}

export function directoryPickerSupported(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  return picker.call(window, { mode: "read" });
}

type PermState = "granted" | "prompt" | "denied";

export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: "read" }) => Promise<PermState>;
  };
  return h.queryPermission ? h.queryPermission({ mode: "read" }) : "granted";
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  const h = handle as FileSystemDirectoryHandle & {
    requestPermission?: (o: { mode: "read" }) => Promise<PermState>;
  };
  return h.requestPermission ? h.requestPermission({ mode: "read" }) : "granted";
}

/** 优先按库 index.html 的 <script src="data*.js"> 顺序；读不到则 data.js 最先、其余按文件名排序 */
async function discoverDataFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const jsNames = new Set<string>();
  for await (const [name, entry] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (entry.kind === "file" && /^data.*\.js$/i.test(name)) jsNames.add(name);
  }
  try {
    const html = await (await dir.getFileHandle("index.html")).getFile();
    // 注意 [^"]*：data.js 本身只有 ".js" 后缀，用 + 会漏掉它
    const order = [...(await html.text()).matchAll(/<script src="(data[^"]*\.js)"/g)].map((m) => m[1]);
    const valid = order.filter((n) => jsNames.has(n));
    if (valid.length > 0) {
      // index.html 可能漏掉新增文件：把没进顺序表的名字追加到末尾
      const rest = [...jsNames].filter((n) => !valid.includes(n)).sort(compareDataFileNames);
      return [...valid, ...rest];
    }
  } catch {
    /* 没有 index.html 就走 fallback */
  }
  return [...jsNames].sort(compareDataFileNames);
}

/** data.js 必须最先（它定义 NAI_DATA），其余按文件名稳定排序（与主进程一致） */
function compareDataFileNames(a: string, b: string): number {
  if (a === "data.js") return -1;
  if (b === "data.js") return 1;
  return a.localeCompare(b);
}

function flatten(data: Record<string, unknown>): LibData {
  const cats = (data.cats as { id: string; icon?: string; name: string; adult?: boolean }[] | undefined) ?? [];
  const catNameById = new Map(cats.map((c) => [c.id, c.name]));
  const adultIds = new Set(cats.filter((c) => c.adult).map((c) => c.id));
  const tags = (data.tags as Record<string, unknown[][]> | undefined) ?? {};
  const info = (data.info as Record<string, Record<string, unknown>[]> | undefined) ?? {};
  const entries: LibEntry[] = [];

  for (const [catId, items] of Object.entries(tags)) {
    const catName = catNameById.get(catId) ?? catId;
    for (const item of items) {
      const [en, zh, note] = item as [string, string, string?];
      if (typeof en !== "string" || !en.trim()) continue;
      entries.push({ kind: "tag", en, zh: zh ?? "", note: note ?? "", prompt: en, catName, catId, adult: adultIds.has(catId) });
    }
  }
  for (const [catId, items] of Object.entries(info)) {
    for (const item of items) {
      const t = item.t as string;
      const s = item.s as string;
      if (typeof t !== "string" || typeof s !== "string" || !s.trim()) continue;
      entries.push({
        kind: "recipe",
        en: t,
        zh: (item.badge as string) ?? "",
        note: (item.b as string) ?? "",
        prompt: s,
        catName: catNameById.get(catId) ?? catId,
        catId,
        adult: adultIds.has(catId),
      });
    }
  }
  return {
    version: (data.version as string) ?? "?",
    cats: cats.map((c) => ({ id: c.id, name: c.name })),
    entries,
  };
}

export async function loadLibraryFrom(dir: FileSystemDirectoryHandle): Promise<LibData> {
  const names = await discoverDataFiles(dir);
  if (names.length === 0) throw new Error("目录里没有找到 data*.js 数据文件");
  const codes: { name: string; code: string }[] = [];
  for (const name of names) {
    const file = await dir.getFileHandle(name).then((h) => h.getFile());
    codes.push({ name, code: await file.text() });
  }
  const { data, failedFiles } = await runLibrarySandbox(codes, libraryFrameHtml);
  if (!data) throw new Error("数据链执行后没有产生 NAI_DATA（首个文件可能执行失败）");
  return { ...flatten(data), failedFiles };
}

export function searchEntries(
  entries: LibEntry[],
  query: string,
  cat: string | null,
  limit = 80,
): { results: LibEntry[]; total: number } {
  const q = query.trim().toLowerCase();
  const pool = cat ? entries.filter((e) => e.catId === cat) : entries;
  if (!q) return { results: pool.slice(0, limit), total: pool.length };
  const results: LibEntry[] = [];
  let total = 0;
  for (const e of pool) {
    if (
      e.en.toLowerCase().includes(q) ||
      e.zh.toLowerCase().includes(q) ||
      e.note.toLowerCase().includes(q) ||
      e.prompt.toLowerCase().includes(q)
    ) {
      total++;
      if (results.length < limit) results.push(e);
    }
  }
  return { results, total };
}

/** 把一段提示词追加到目标文本末尾，自动处理逗号衔接 */
export function appendPrompt(existing: string, addition: string): string {
  const a = addition.trim();
  if (!a) return existing;
  if (!existing.trim()) return a;
  return `${existing.trim().replace(/,\s*$/, "")}, ${a}`;
}

export function targetText(params: GenParams, target: LibTarget): string | null {
  if (target.kind === "main") return params.prompt;
  if (target.kind === "negative") return params.negativePrompt;
  const char = params.characters.find((c) => c.id === target.id);
  return char ? (target.negative ? char.negative : char.caption) : null;
}

export function insertPrompt(params: GenParams, target: LibTarget, text: string, mode: "append" | "replace", name?: string): GenParams {
  const existing = targetText(params, target);
  if (existing === null) return params;
  if (mode === "append" && !text.trim()) return params;
  const value = mode === "append" ? appendPrompt(existing, text) : text;
  if (target.kind === "main") return { ...params, prompt: value, promptChips: insertedPromptChips(existing, params.promptChips, value, mode, name) };
  if (target.kind === "negative") return { ...params, negativePrompt: value, negativePromptChips: insertedPromptChips(existing, params.negativePromptChips, value, mode, name) };
  return { ...params, characters: params.characters.map((c) => c.id === target.id
    ? { ...c, [target.negative ? "negative" : "caption"]: value,
      [target.negative ? "negativeChips" : "captionChips"]: insertedPromptChips(existing, target.negative ? c.negativeChips : c.captionChips, value, mode, name) } : c) };
}
