import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { directoryPickerSupported, isDesktop, desktopPickLib, desktopLoadLib, loadDirHandle,
  loadLibraryFrom, pickDirectory, queryPermission, requestPermission, saveDirHandle, searchEntries,
  targetText, type LibStatus, type LibTarget } from "../lib/promptlib";
import { MAX_CHARACTERS, isV4Model, type GenParams } from "../types";
import PersonalPrompts from "./PersonalPrompts";
export type { LibTarget } from "../lib/promptlib";

interface Props {
  status: LibStatus;
  params: GenParams;
  target: LibTarget;
  onStatusChange: (s: LibStatus) => void;
  onTargetChange: (t: LibTarget) => void;
  onInsert: (text: string, mode: "append" | "replace", name?: string) => void;
  onDraftDirtyChange?: (dirty: boolean) => void;
}

export default function PromptLibraryDialog({ status, params, target, onStatusChange, onTargetChange, onInsert, onDraftDirtyChange }: Props) {
  const [collection, setCollection] = useState<"library" | "personal">("library");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [cat, setCat] = useState("");
  const [kind, setKind] = useState("all");
  const [adult, setAdult] = useState(false);
  const [limit, setLimit] = useState(60);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const data = status.state === "ready" ? status.data : null;
  const pool = useMemo(() => data?.entries.filter((e) => (adult || !e.adult) && (kind === "all" || e.kind === kind)) ?? [], [data, adult, kind]);
  const categories = useMemo(() => {
    const ids = new Set(pool.map((e) => e.catId));
    return data?.cats.filter((c) => ids.has(c.id)) ?? [];
  }, [data, pool]);
  const { results, total } = useMemo(() => searchEntries(pool, deferredQuery, cat || null, limit), [pool, deferredQuery, cat, limit]);
  useEffect(() => { setCat(""); setExpanded(null); }, [data, adult, kind]);
  useEffect(() => { setLimit(60); setExpanded(null); }, [query, cat, kind, adult]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const targetOptions: { target: LibTarget; label: string }[] = [
    { target: { kind: "main" }, label: "主提示词" },
    { target: { kind: "negative" }, label: "主负面词" },
    ...(isV4Model(params.model) ? params.characters.slice(0, MAX_CHARACTERS).flatMap((c, i) => [
      { target: { kind: "char" as const, id: c.id }, label: `${c.name?.trim() || `角色 ${i + 1}`}${c.enabled === false ? "（停用）" : ""} · 提示词` },
      { target: { kind: "char" as const, id: c.id, negative: true }, label: `${c.name?.trim() || `角色 ${i + 1}`}${c.enabled === false ? "（停用）" : ""} · 负面词` },
    ]) : []),
  ];
  const targetValue = JSON.stringify(target);
  const selected = targetOptions.find((o) => JSON.stringify(o.target) === targetValue);
  useEffect(() => {
    if (!selected) onTargetChange({ kind: "main" });
  }, [selected, onTargetChange]);
  const text = targetText(params, target) ?? "";

  async function connect() {
    const previous = status;
    onStatusChange({ state: "loading" });
    try {
      const handle = await pickDirectory();
      const perm = await queryPermission(handle);
      if (perm !== "granted" && await requestPermission(handle) !== "granted") {
        onStatusChange({ state: "error", message: "没有获得目录读取授权。" });
        return;
      }
      const lib = await loadLibraryFrom(handle);
      await saveDirHandle(handle);
      onStatusChange({ state: "ready", data: lib, dirName: handle.name });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        onStatusChange(previous);
        return;
      }
      onStatusChange({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  async function reconnect() {
    onStatusChange({ state: "loading" });
    try {
      const handle = await loadDirHandle();
      if (!handle) { onStatusChange({ state: "idle" }); return; }
      if (await requestPermission(handle) !== "granted") {
        onStatusChange({ state: "error", message: "没有获得目录读取授权。" });
        return;
      }
      const lib = await loadLibraryFrom(handle);
      onStatusChange({ state: "ready", data: lib, dirName: handle.name });
    } catch (e) {
      onStatusChange({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  async function pick() {
    if (!isDesktop()) { await connect(); return; }
    const previous = status;
    onStatusChange({ state: "loading" });
    const next = await desktopPickLib();
    onStatusChange(next.state === "idle" ? previous : next);
  }
  async function reload() {
    if (!isDesktop()) { await reconnect(); return; }
    onStatusChange({ state: "loading" });
    onStatusChange(await desktopLoadLib());
  }
  function insert(prompt: string, mode: "append" | "replace", name?: string) {
    if (!selected) return;
    if (mode === "replace" && text.trim() && text !== prompt && !window.confirm(`将替换「${selected.label}」的现有内容。确认替换？`)) return;
    onInsert(prompt, mode, name);
    setFeedback(name ? `「${name}」已作为标签加入${selected.label}，点击标签查看内容，× 移除。` : `${mode === "append" ? "已追加到" : "已载入"}${selected.label}`);
  }
  return (
    <section className="library-panel" aria-label="提示词库" data-collection={collection}>
      <div className="pane-heading">
        <div><p className="eyebrow">灵感与素材</p><h2>提示词库</h2></div>
        <span className="count-badge">{collection === "personal" ? "个人收藏" : data ? data.entries.length.toLocaleString() : "本地连接"}</span>
      </div>
      <div className="prompt-collection-switch" role="group" aria-label="选择提示词来源"><button type="button" aria-pressed={collection === "library"} onClick={() => setCollection("library")}>本地词库</button><button type="button" aria-pressed={collection === "personal"} onClick={() => setCollection("personal")}>我的提示词</button></div>
      <div className="library-tools" hidden={collection !== "library"}>
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          <span className="truncate">{status.state === "ready" ? `● ${status.dirName}` : "读取你自己的提示词库"}</span>
          <div className="flex shrink-0 gap-2">
            {data && <button type="button" onClick={reload} className="subtle-button">重新读取</button>}
            <button type="button" onClick={pick} disabled={status.state === "loading" || (!isDesktop() && !directoryPickerSupported())} className="subtle-button">{data ? "换库" : "选择目录"}</button>
          </div>
        </div>
        <details className="trust-note"><summary>本地词库读取说明</summary><p>读取不会改动原文件。脚本在独立、禁止联网的环境中解析，不能访问你的 Token 或历史；仍请使用自己维护、信任的词库。桌面端自动尝试 D:\nai提示词。</p></details>
        {data?.failedFiles?.length ? <p role="alert" className="rounded-lg bg-amber-950/60 p-2 text-xs text-amber-300">有 {data.failedFiles.length} 个文件读取失败：{data.failedFiles.join("、")}。内容可能不全。</p> : null}
        <label className="search-field"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="搜索提示词库" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索中文、英文或配方…" />{query && <button type="button" aria-label="清空搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>×</button>}</label>
        <div className="library-filters">
          {[{ id: "all", label: "全部" }, { id: "tag", label: "词条" }, { id: "recipe", label: "配方" }].map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}
          <select aria-label="词库分类" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">全部分类</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="accent-violet-500" />显示原库标记的成人分区</label>
      </div>
      <div className="library-results" hidden={collection !== "library"} aria-busy={status.state === "loading" || query !== deferredQuery}>
        {status.state === "loading" && <p className="empty-note">正在读取本地词库…</p>}
        {status.state === "error" && <p role="alert" className="empty-note text-red-300">{status.message}<br />可以重新选择词库目录。</p>}
        {status.state === "need-permission" && <div className="empty-note"><p>本次会话需要重新授权读取词库。</p><button type="button" className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-white" onClick={reconnect}>重新连接词库</button></div>}
        {status.state === "idle" && <div className="empty-note"><p className="text-2xl">📚</p><p className="mt-3">把灵感直接放进画面</p><p className="mt-2 text-xs">连接本地目录，搜索词条或成品配方。<br />浏览器需要手动选择目录，桌面端会自动连接。</p></div>}
        {data && <><p className="mb-3 text-xs text-zinc-400">匹配 {total.toLocaleString()} 条 · 已显示 {results.length}{query !== deferredQuery && " · 搜索中…"}</p>
          {results.map((e, i) => <article key={i} className="library-card">
            <div className="flex items-center justify-between gap-2"><span className={e.kind === "recipe" ? "entry-kind recipe" : "entry-kind"}>{e.kind === "recipe" ? "成品配方" : "词条"}</span><span className="truncate text-[11px] text-zinc-500">{e.catName}</span></div>
            <h3>{e.en}</h3>{e.zh && <p className="entry-translation">{e.zh}</p>}
            {e.note && <p className="entry-note" title={e.note}>{e.note}</p>}
            {expanded === i && <p className="entry-preview">{e.prompt}</p>}
            <div className="entry-actions">{e.kind === "recipe" && <button type="button" aria-expanded={expanded === i} onClick={() => setExpanded(expanded === i ? null : i)}>{expanded === i ? "收起" : "查看配方"}</button>}<button type="button" className="append-action" onClick={() => insert(e.prompt, "append")}>＋ 追加</button>{e.kind === "recipe" && <button type="button" className="load-action" onClick={() => insert(e.prompt, "replace")}>载入</button>}</div>
          </article>)}
          {!results.length && <p className="empty-note">没有匹配结果，换个关键词或分类试试。</p>}
          {results.length < total && <button type="button" className="load-more" onClick={() => setLimit((n) => n + 60)}>再显示 60 条</button>}
        </>}
      </div>
      <PersonalPrompts hidden={collection !== "personal"} currentText={text} targetLabel={selected?.label ?? "主提示词"} onInsert={insert} onDirtyChange={onDraftDirtyChange} />
      <div className="insert-destination">
        <label><span>插入到</span><select aria-label="词库插入目标" value={selected ? targetValue : JSON.stringify({ kind: "main" })} onChange={(e) => onTargetChange(JSON.parse(e.target.value) as LibTarget)}>{targetOptions.map((o) => <option key={JSON.stringify(o.target)} value={JSON.stringify(o.target)}>{o.label}</option>)}</select></label>
        <p className="target-preview" title={text}>{text || "此处还没有提示词，选一条开始组装。"}</p>
        <p className="insert-feedback" role="status">{feedback || (collection === "personal" ? "点击收藏名称追加；替换已有内容会先确认。" : "词条可连续追加；载入配方会替换所选内容。")}</p>
      </div>
    </section>
  );
}
