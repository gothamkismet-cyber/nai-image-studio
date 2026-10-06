import { useEffect, useMemo, useRef, useState } from "react";
import { loadPersonalPrompts, savePersonalPrompts, MAX_PERSONAL_PROMPTS, MAX_PROMPT_NAME,
  MAX_PERSONAL_PROMPT_LENGTH, type PersonalPrompt } from "../lib/personal-prompts";

interface Props {
  hidden: boolean;
  currentText: string;
  targetLabel: string;
  onInsert: (text: string, mode: "append" | "replace", name?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
interface Draft extends PersonalPrompt { originalName: string; originalPrompt: string }

export default function PersonalPrompts({ hidden, currentText, targetLabel, onInsert, onDirtyChange }: Props) {
  const [collection, setCollection] = useState(() => loadPersonalPrompts());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(60);
  const nameRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const dirty = !!draft && (draft.name !== draft.originalName || draft.prompt !== draft.originalPrompt);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return collection.items.filter((item) => !needle || `${item.name}\n${item.prompt}`.toLocaleLowerCase().includes(needle));
  }, [collection.items, query]);
  useEffect(() => { if (draft && !hidden) nameRef.current?.focus(); }, [draft?.id, hidden]);
  useEffect(() => { setLimit(60); }, [query]);

  function canDiscard() { return !dirty || window.confirm("当前提示词还没保存，要放弃这些修改吗？"); }
  function open(item?: PersonalPrompt, fromCurrent = false) {
    if (!canDiscard()) return;
    if (!item && collection.items.length >= MAX_PERSONAL_PROMPTS) { setError("最多保存 2,000 条提示词，请先整理已有收藏。"); return; }
    const prompt = item?.prompt ?? (fromCurrent ? currentText : "");
    const name = item?.name ?? "";
    setDraft({ id: item?.id ?? crypto.randomUUID(), name, prompt, originalName: name, originalPrompt: item ? prompt : "" });
    setError(""); setNotice("");
  }
  function commit(items: PersonalPrompt[]) {
    if (collection.error) return false;
    try {
      const revision = savePersonalPrompts(items, collection.revision);
      setCollection({ items, revision, error: null }); setError("");
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "没有保存成功，请重试。"); return false; }
  }
  function save() {
    if (!draft) return;
    const item = { id: draft.id, name: draft.name.trim(), prompt: draft.prompt };
    if (!item.name || !item.prompt.trim()) { setError("请填写名称和提示词内容，不能只填空格。"); return; }
    const exists = collection.items.some((entry) => entry.id === item.id);
    if (draft.originalName && !exists) { setError("这条收藏已经被删除，当前草稿仍保留。可以复制内容后新建一条。"); return; }
    const items = exists ? collection.items.map((entry) => entry.id === item.id ? item : entry) : [item, ...collection.items];
    if (commit(items)) { setDraft(null); setQuery(""); setNotice(`已保存「${item.name}」，点击名称即可追加。`); addRef.current?.focus(); }
  }
  function remove(item: PersonalPrompt) {
    if (!window.confirm(`删除「${item.name}」？删除后无法恢复，已经插入框内的内容会保留。`)) return;
    if (draft?.id === item.id && !canDiscard()) return;
    if (commit(collection.items.filter((entry) => entry.id !== item.id))) {
      if (draft?.id === item.id) setDraft(null);
      setNotice(`已删除「${item.name}」。`); addRef.current?.focus();
    }
  }
  function reload() { const next = loadPersonalPrompts(); setCollection(next); setError(""); setNotice(next.error ? "" : "已重新读取；正在编辑的草稿会保留。"); }

  return <div className="personal-prompts" hidden={hidden}>
    <div className="personal-results">
    <div className="personal-tools">
      <div className="personal-heading"><div><h3>我的提示词 <span>{collection.items.length} 条</span></h3><p>保存常用片段，点击名称追加到下方选择的框。</p></div><button type="button" className="subtle-button" onClick={reload}>重新读取收藏</button></div>
      <div className="personal-toolbar"><button ref={addRef} type="button" className="api-primary" disabled={!!collection.error} onClick={() => open()}>＋ 新增提示词</button><button type="button" className="api-secondary" disabled={!!collection.error || !currentText.trim()} onClick={() => open(undefined, true)}>保存当前框</button></div>
      <p className="personal-local-note">只保存在本机生图台，不同步 NovelAI 账号。当前框：{targetLabel}。</p>
      <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="搜索我的提示词" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索收藏名称或内容…" /></label>
    </div>
    <div className="personal-entries">
      {(collection.error || error) && <p id="personal-prompt-error" className="personal-message error" role="alert">{collection.error || error}</p>}
      <p className="personal-notice" role="status">{notice}</p>
      {draft && <form className="personal-form" aria-label="录入我的提示词" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="personal-form-heading"><h4>{draft.originalName ? "修改提示词" : "录入提示词"}</h4><span>{dirty ? "尚未保存" : "填写后保存"}</span></div>
        <label htmlFor="personal-prompt-name">名称 <span>插入后显示为小标签，生成时使用完整内容</span></label>
        <input ref={nameRef} id="personal-prompt-name" aria-describedby={`personal-draft-note${error ? " personal-prompt-error" : ""}`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={MAX_PROMPT_NAME} required placeholder="例如：我的柔和光线" />
        <label htmlFor="personal-prompt-content">提示词内容</label>
        <textarea id="personal-prompt-content" aria-describedby={`personal-draft-note${error ? " personal-prompt-error" : ""}`} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} maxLength={MAX_PERSONAL_PROMPT_LENGTH} required rows={5} placeholder="soft lighting, warm colors, detailed background" />
        <p id="personal-draft-note">名称最多 80 字，内容最多 50,000 字。保留权重、换行和画师标签；保存不会自动插入。</p>
        <div className="personal-form-actions"><button type="submit" className="api-primary" disabled={!!collection.error}>保存提示词</button><button type="button" className="subtle-button" onClick={() => { if (canDiscard()) { setDraft(null); setError(""); addRef.current?.focus(); } }}>取消编辑</button></div>
      </form>}
      {!collection.error && !results.length && <div className="personal-empty"><span aria-hidden="true">✦</span><h4>{collection.items.length ? "没有找到这条提示词" : "把好用的提示词留下来"}</h4><p>{collection.items.length ? "换个名称或内容关键词搜索。" : "点击「新增提示词」填写，或把选中的提示词框直接保存。下次不用再从头输入。"}</p></div>}
      {results.slice(0, limit).map((item) => <article className="personal-prompt-card" key={item.id}>
        <button type="button" className="personal-insert" aria-label={`插入提示词：${item.name}`} onClick={() => onInsert(item.prompt, "append", item.name)}><span>{item.name}</span><small>＋ 标签</small></button>
        <p className="personal-content" title={item.prompt}>{item.prompt}</p>
        <div className="personal-card-actions"><button type="button" aria-label={`修改提示词：${item.name}`} onClick={() => open(item)}>修改 / 改名</button><button type="button" aria-label={`替换提示词：${item.name}`} onClick={() => onInsert(item.prompt, "replace", item.name)}>替换当前框</button><button type="button" className="personal-delete" aria-label={`删除提示词：${item.name}`} onClick={() => remove(item)}>删除</button></div>
      </article>)}
      {results.length > limit && <button type="button" className="load-more" onClick={() => setLimit((n) => n + 60)}>再显示 60 条收藏</button>}
    </div>
    </div>
  </div>;
}
