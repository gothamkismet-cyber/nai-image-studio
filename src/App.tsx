import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampSeed,
  normalizeParams, effectiveGenerationParams, characterLimit, isV4Model,
  PARAMS_KEY,
  snapSize,
  type GenParams,
  type HistoryItem,
} from "./types";
import { generateDemoImage, generateImage } from "./lib/nai";
import { addHistory, listHistory, deleteHistory, clearHistory } from "./lib/history";
import {
  insertPrompt,
  isDesktop,
  desktopLoadLib,
  loadDirHandle,
  loadLibraryFrom,
  queryPermission,
  type LibStatus,
} from "./lib/promptlib";
import ParamPanel from "./components/ParamPanel";
import ResultView from "./components/ResultView";
import TokenDialog from "./components/TokenDialog";
import VisionDialog from "./components/VisionDialog";
import UpdateDialog from "./components/UpdateDialog";
import PromptLibraryDialog, { type LibTarget } from "./components/PromptLibraryDialog";
import { normalizePromptTag } from "./lib/promptHighlight";

const TOKEN_KEY = "nai_token";
const DEMO_KEY = "nai_demo";

function loadParams(): GenParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) {
      return normalizeParams(JSON.parse(raw));
    }
  } catch {
    /* 损坏的存档按默认来 */
  }
  return normalizeParams(null);
}

export default function App() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
  });
  const [demoMode, setDemoMode] = useState(() => {
    try { return localStorage.getItem(DEMO_KEY) === "1"; } catch { return false; }
  });
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [params, setParams] = useState<GenParams>(loadParams);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visionOpen, setVisionOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [personalDraftDirty, setPersonalDraftDirty] = useState(false);
  const [libOpen, setLibOpen] = useState(true);
  const [view, setView] = useState("edit");
  const [libTarget, setLibTarget] = useState<LibTarget>({ kind: "main" });
  const [libStatus, setLibStatus] = useState<LibStatus>({ state: "idle" });
  const artistNames = useMemo(() => {
    const names = new Set<string>();
    if (libStatus.state === "ready") for (const entry of libStatus.data.entries) {
      if (entry.kind === "tag" && entry.catId === "artist") names.add(normalizePromptTag(entry.en.replace(/^artist\s*:\s*/i, "")));
    }
    return names;
  }, [libStatus]);
  const abortRef = useRef<AbortController | null>(null);
  const libLoadSeq = useRef(0);

  useEffect(() => {
    listHistory().then(setHistory).catch(() => setError("本地历史库打开失败，历史功能不可用"));
    // 词库就绪：桌面端由主进程直接读文件（自动探测默认目录），免授权；
    // 网页端走 File System Access API，恢复句柄后可能需要一次重新授权。
    // libLoadSeq 防止过期结果覆盖（StrictMode 双发 / 手动选库竞态）。
    (async () => {
      const mySeq = ++libLoadSeq.current;
      const setStatus = (s: LibStatus) => {
        if (libLoadSeq.current === mySeq) setLibStatus(s);
      };
      if (isDesktop()) {
        setStatus({ state: "loading" });
        setStatus(await desktopLoadLib());
        return;
      }
      try {
        const handle = await loadDirHandle();
        if (!handle) return;
        const perm = await queryPermission(handle);
        if (perm === "granted") {
          setStatus({ state: "loading" });
          const lib = await loadLibraryFrom(handle);
          setStatus({ state: "ready", data: lib, dirName: handle.name });
        } else {
          setStatus({ state: "need-permission" });
        }
      } catch (e) {
        setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); setStorageNotice(null); }
    catch { setStorageNotice("草稿暂时无法保存，当前内容仍可编辑。关闭前请先复制提示词，并检查本机存储空间或权限。"); }
  }, [params]);

  function patchParams(patch: Partial<GenParams>) {
    setParams((p) => ({ ...p, ...patch }));
  }

  function saveToken(t: string): string | null {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
      setToken(t);
      return null;
    } catch {
      return "本机存储不可用，配置未保存。请检查存储空间或浏览器的存储权限后重试。";
    }
  }

  function toggleDemo(on: boolean) {
    setDemoMode(on);
    try { localStorage.setItem(DEMO_KEY, on ? "1" : "0"); }
    catch { setError("演示模式已在本次切换，但偏好没有保存，重开后可能恢复。"); }
  }

  async function handleGenerate() {
    if (abortRef.current) return;
    setError(null);
    const activeCharacters = params.characters.filter(c => c.enabled !== false && c.caption.trim());
    if (isV4Model(params.model) && activeCharacters.length > characterLimit(params.model)) {
      setError(`当前模型最多同时使用 ${characterLimit(params.model)} 个角色，请停用多出的角色或切换到 V5。已有角色内容会保留。`);
      return;
    }
    if (!demoMode && !token) {
      setDialogOpen(true);
      setError("还没有填 NovelAI Token：在下面弹窗里填好保存，或者打开顶栏「演示模式」先体验流程。");
      return;
    }
    // 请求使用本次实际 seed；编辑器中的 null 始终表示「每次随机」。
    const seed = params.seed === null ? Math.floor(Math.random() * 0xffffffff) : clampSeed(params.seed);
    const p = effectiveGenerationParams({
      ...params,
      seed,
      width: snapSize(params.width),
      height: snapSize(params.height),
    });
    setParams((prev) => ({ ...prev, seed: prev.seed === null ? null : clampSeed(prev.seed), width: p.width, height: p.height }));
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setView("result");
    try {
      const result = demoMode
        ? await generateDemoImage(p, ac.signal)
        : await generateImage(token, p, ac.signal);
      // 实际 seed 只保存到图片与历史；用户主动载入参数时再用于复现。
      const item: HistoryItem = {
        id: `${Date.now()}-${result.seed}`,
        createdAt: Date.now(),
        png: result.png,
        params: { ...p, seed: result.seed },
        demo: demoMode,
      };
      // 出图与入库解耦：存储失败只影响历史，不影响本次预览
      setCurrent(item);
      try {
        await addHistory(item);
        setHistory((h) => [item, ...h]);
      } catch (saveErr) {
        if (saveErr instanceof DOMException && saveErr.name === "QuotaExceededError") {
          setError("本机存储已满，这张图没能存进历史（预览和下载不受影响）。请在历史区删掉一些旧图后重试。");
        } else {
          setError(`历史保存失败：${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function handleCancelGenerate() {
    abortRef.current?.abort();
  }

  function handleLoadParams(item: HistoryItem) {
    setParams(normalizeParams(item.params));
    setError(null);
    setView("edit");
  }

  async function handleClearHistory() {
    try {
      await clearHistory();
      setHistory([]);
      setCurrent(null);
    } catch { setError("历史清空失败，原记录仍保留。请重试。"); }
  }

  /** 词库插入：词条追加、配方整段替换到目标（主提示词或某角色） */
  function handleLibInsert(text: string, mode: "append" | "replace", name?: string) {
    setParams((p) => insertPrompt(p, libTarget, text, mode, name));
  }

  async function handleDelete(id: string) {
    try {
      await deleteHistory(id);
      setHistory((h) => h.filter((x) => x.id !== id));
      setCurrent((c) => (c?.id === id ? null : c));
    } catch { setError("历史删除失败，原记录仍保留。请重试。"); }
  }

  return (
    <div className="studio-shell text-zinc-100">
      <header className="studio-header">
        <div className="brand"><span className="brand-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="24" height="24" rx="7" stroke="currentColor"/><path d="m9 22 6-12 8 12M12 17h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></span><div><h1>NAI 生图台 <span className="brand-edition">STUDIO</span></h1><p>把灵感，变成画面。</p></div></div>
        <div className="header-actions">
          {isDesktop() && <button type="button" className="subtle-button update-trigger" disabled={busy} onClick={() => setUpdateOpen(true)}>软件更新</button>}
          <button type="button" className="api-config-trigger vision-trigger" onClick={() => setVisionOpen(true)}>图片转提示词</button>
          <button type="button" className="desktop-libtoggle subtle-button" aria-pressed={libOpen} onClick={() => setLibOpen(!libOpen)}>{libOpen ? "收起词库" : "展开词库"}</button>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200">
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => toggleDemo(e.target.checked)}
              className="size-4 accent-amber-500"
            />
            演示模式
          </label>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="api-config-trigger"
            aria-label="API 配置"
          >
            <span className={`config-dot ${token ? "saved" : ""}`} aria-hidden="true" />
            API 配置 <span className="config-caption">{token ? "已保存" : "待配置"}</span>
          </button>
        </div>
      </header>

      {storageNotice && <div role="status" className="storage-notice">{storageNotice}</div>}
      {error && (
        <div role="alert" className="animate-fade-in shrink-0 border-b border-red-500/20 bg-red-950/50 px-4 py-2 text-sm text-red-200 backdrop-blur-sm">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 text-red-400 underline hover:text-red-200">
            知道了
          </button>
        </div>
      )}

      <nav className="workspace-tabs" aria-label="工作区切换">
        {[{ id: "edit", name: "编辑提示词" }, { id: "library", name: "提示词库" }, { id: "result", name: "结果与历史" }].map((v) => <button type="button" key={v.id} aria-pressed={view === v.id} onClick={() => { setView(v.id); if (v.id === "library") setLibOpen(true); }}>{v.name}</button>)}
      </nav>
      <main className={`studio-workspace ${libOpen ? "" : "library-collapsed"}`} data-view={view}>
        <aside className="editor-pane" aria-label="提示词与生成设置">
          <div className="pane-heading"><div><p className="eyebrow">画面设定</p><h2>创作工作台</h2></div><span className="count-badge">{params.width} × {params.height}</span></div>
          <ParamPanel
            params={params}
            artists={artistNames}
            busy={busy}
            onChange={patchParams}
            onGenerate={handleGenerate}
            onCancel={handleCancelGenerate}
            onOpenLibrary={(t) => {
              setLibTarget(t);
              setLibOpen(true);
              setView("library");
            }}
          />
        </aside>
        <aside className="library-pane">
          <PromptLibraryDialog
            status={libStatus} params={params} target={libTarget}
            onStatusChange={(s) => { libLoadSeq.current++; setLibStatus(s); }}
            onTargetChange={setLibTarget} onInsert={handleLibInsert} onDraftDirtyChange={setPersonalDraftDirty}
          />
        </aside>
        <section className="result-pane" aria-label="结果与历史">
          <div className="pane-heading"><div><p className="eyebrow">作品预览</p><h2>画布</h2></div><span className={`count-badge ${demoMode ? "demo-badge" : ""}`}>{busy ? "生成中" : demoMode ? "演示 · 不消耗额度" : "NovelAI 直连"}</span></div>
        <ResultView
          current={current}
          history={history}
          busy={busy}
          onSelect={setCurrent}
          onLoadParams={handleLoadParams}
          onDelete={handleDelete}
          onClearAll={handleClearHistory}
        />
        </section>
      </main>

      <TokenDialog open={dialogOpen} token={token} onClose={() => setDialogOpen(false)} onSave={saveToken} />
      <UpdateDialog open={updateOpen} onClose={() => setUpdateOpen(false)} blockedReason={personalDraftDirty ? "我的提示词还有未保存的草稿，请先关闭更新窗口并保存或取消编辑，再开始更新。" : undefined} />
      <VisionDialog open={visionOpen} onClose={() => setVisionOpen(false)} onApply={(text, mode) => {
        if (!text.trim()) return false;
        if (mode === "replace" && params.prompt.trim() && !window.confirm("用识图结果替换当前主提示词？原有内容将被覆盖。")) return false;
        setParams(p => insertPrompt(p, { kind: "main" }, text, mode));
        setView("edit");
        return true;
      }} />

    </div>
  );
}
