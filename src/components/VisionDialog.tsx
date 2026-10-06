import { useEffect, useRef, useState } from "react";
import { EMPTY_VISION_CONFIG, loadVisionConfig, normalizeVisionConfig, prepareVisionImage, requestVision, saveVisionConfig, visionConfigError, visionEndpoint, visionInstruction, visionTestImage, type VisionConfig, type VisionImage, type VisionStyle } from "../lib/vision";

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (text: string, mode: "append" | "replace") => boolean;
}

export default function VisionDialog({ open, ...props }: Props) {
  return open ? <VisionWorkspace {...props} /> : null;
}

function VisionWorkspace({ onClose, onApply }: Omit<Props, "open">) {
  const [saved, setSaved] = useState(loadVisionConfig);
  const [draft, setDraft] = useState(saved);
  const [tab, setTab] = useState<"image" | "config">("image");
  const [image, setImage] = useState<VisionImage | null>(null);
  const [style, setStyle] = useState<VisionStyle>("tags");
  const [extra, setExtra] = useState("");
  const [result, setResult] = useState("");
  const [resultModel, setResultModel] = useState("");
  const [activity, setActivity] = useState<"image" | "test" | "read" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testReply, setTestReply] = useState("");
  const [showKey, setShowKey] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const copySequence = useRef(0);
  const isDirty = JSON.stringify(normalizeVisionConfig(draft)) !== JSON.stringify(saved);
  const configured = !visionConfigError(saved);
  let destination = "尚未配置";
  try { destination = new URL(visionEndpoint(saved.baseUrl)).host; } catch { /* 尚未配置 */ }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>(".vision-nav button")?.focus();
    return () => {
      ++sequence.current;
      ++copySequence.current;
      controller.current?.abort();
      dialog.current?.close();
      previous?.focus();
    };
  }, []);

  function stop() {
    ++sequence.current;
    ++copySequence.current;
    controller.current?.abort();
    controller.current = null;
    setActivity(null);
  }

  function switchTab(next: "image" | "config") {
    stop(); setTab(next); setError(null); setNotice(null);
  }

  function editConfig(patch: Partial<VisionConfig>) {
    stop(); setDraft(c => ({ ...c, ...patch })); setError(null); setNotice(null); setTestReply("");
  }

  function saveConfig() {
    stop(); setNotice(null);
    const invalid = visionConfigError(draft);
    if (invalid) { setError(invalid); return; }
    const c = normalizeVisionConfig(draft), failed = saveVisionConfig(c);
    setError(failed);
    if (failed) return;
    setSaved(c); setDraft(c); setNotice("识图 API 配置已保存，下次启动仍可使用。");
  }

  function clearConfig() {
    stop(); setNotice(null);
    const failed = saveVisionConfig(null); setError(failed);
    if (failed) return;
    setSaved({ ...EMPTY_VISION_CONFIG }); setDraft({ ...EMPTY_VISION_CONFIG }); setTestReply(""); setShowKey(false);
    setNotice("已清除识图配置，NovelAI 生图配置不受影响。");
  }

  async function selectImage(file?: File) {
    if (!file) return;
    stop(); ++copySequence.current;
    const id = sequence.current;
    setImage(null); setResult(""); setResultModel(""); setError(null); setNotice(null); setActivity("read");
    try {
      const prepared = await prepareVisionImage(file);
      if (sequence.current === id) setImage(prepared);
    } catch (e) { if (sequence.current === id) setError((e as Error).message); }
    finally { if (sequence.current === id) setActivity(null); }
  }

  async function run(kind: "image" | "test") {
    stop(); ++copySequence.current;
    setError(null); setNotice(null);
    const c = kind === "image" ? saved : draft, invalid = visionConfigError(c);
    if (invalid) { setError(invalid); return; }
    if (kind === "image" && !image) { setError("请先选择一张图片。"); return; }
    if (kind === "image") { setResult(""); setResultModel(""); } else setTestReply("");
    const id = sequence.current, ac = new AbortController();
    controller.current = ac; setActivity(kind);
    try {
      const text = await requestVision(c, kind === "image" ? image!.dataUrl : visionTestImage(), kind === "image"
        ? visionInstruction(style, extra)
        : "请说出图片左半和右半的主要颜色，只回答颜色，不要解释。", ac.signal);
      if (sequence.current !== id) return;
      if (kind === "image") { setResult(text); setResultModel(c.model); }
      else { setTestReply(text); setNotice("图片请求已返回。测试图是左红右蓝，请核对答复；实际识图效果还需用你的图片确认。"); }
    } catch (e) { if (sequence.current === id) setError((e as Error).message); }
    finally { if (sequence.current === id) { controller.current = null; setActivity(null); } }
  }

  function cancel() { stop(); setNotice("已取消。服务商仍可能处理已发送的请求并计费。"); }

  async function copy() {
    const id = ++copySequence.current;
    try { await navigator.clipboard.writeText(result); if (copySequence.current === id) setNotice("提示词已复制。"); }
    catch { if (copySequence.current === id) setError("复制失败，可以在结果框里全选后手动复制。"); }
  }

  function apply(mode: "append" | "replace") {
    if (onApply(result.trim(), mode)) onClose();
  }

  return (
    <dialog ref={dialog} aria-labelledby="vision-title" className="token-dialog vision-dialog" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="api-settings animate-pop-in">
        <header className="api-settings-header">
          <div><p className="eyebrow">从参考图开始创作</p><h2 id="vision-title">图片转提示词</h2><p id="token-description">识别画面里的主体、构图和画风，整理成可编辑的提示词。</p></div>
          <button type="button" className="api-close" aria-label="关闭图片转提示词" onClick={onClose}>×</button>
        </header>
        <nav className="vision-nav" aria-label="识图功能区域">
          <button type="button" aria-pressed={tab === "image"} onClick={() => switchTab("image")}>图片识别</button>
          <button type="button" aria-pressed={tab === "config"} onClick={() => switchTab("config")}>识图 API 设置</button>
          <span>{configured ? "已配置" : "待配置"}</span>
        </nav>
        <div className="vision-body">
          <p className="vision-model-note"><b>需要多模态 AI 模型</b>：模型必须支持图片输入。纯文本模型无法识图；这里使用单独的 OpenAI 兼容 API，与 NovelAI 生图配置分开。</p>
          {tab === "config" ? (
            <section className="vision-config" aria-label="识图 API 设置表单">
              <div className="api-label-row"><h3>OpenAI 兼容接口</h3><span className={`draft-badge ${isDirty ? "dirty" : ""}`}>{isDirty ? "有未保存修改" : configured ? "已保存 · 本机" : "尚未配置"}</span></div>
              <label htmlFor="vision-url">API 地址</label>
              <input id="vision-url" type="url" value={draft.baseUrl} onChange={e => editConfig({ baseUrl: e.target.value })} placeholder="https://你的服务地址/v1" aria-describedby="vision-url-help" spellCheck={false} autoComplete="off" />
              <p id="vision-url-help" className="api-help">填基础地址（通常以 /v1 结尾），也可填完整的 /chat/completions 地址。优先使用 HTTPS。</p>
              <label htmlFor="vision-key">API Key（识图服务的访问密钥）</label>
              <div className="api-token-field"><input id="vision-key" type={showKey ? "text" : "password"} value={draft.apiKey} onChange={e => editConfig({ apiKey: e.target.value })} placeholder="填写识图 API Key" autoComplete="off" spellCheck={false} /><button type="button" aria-label={showKey ? "隐藏识图密钥" : "显示识图密钥"} aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>{showKey ? "隐藏" : "显示"}</button></div>
              <label htmlFor="vision-model">多模态模型名称</label>
              <input id="vision-model" value={draft.model} onChange={e => editConfig({ model: e.target.value })} placeholder="填写服务商提供的完整模型 ID" aria-describedby="vision-model-help" spellCheck={false} />
              <p id="vision-model-help" className="api-help">必须是支持图片输入的多模态 AI 模型。模型列表中的“聊天模型”不一定能识图，请查服务商说明。</p>
              <div className="api-test-row"><button type="button" className="api-secondary" onClick={() => activity === "test" ? cancel() : run("test")} disabled={activity === "read"}>{activity === "test" ? "取消测试" : "测试识图能力"}</button><span>发送本机生成的色块小图，不发送你选中的图片。测试可能产生少量 API 费用。</span></div>
              {testReply && <div className="vision-test-result"><b>测试图：左红右蓝 · 模型答复</b><p>{testReply}</p></div>}
              <p className="api-storage-note">配置只存本机，密钥未加密。图片会发送到你填写的服务，请确认地址和服务商的数据政策。保存后生效；关闭时放弃未保存的设置。</p>
            </section>
          ) : (
            <section className="vision-image-grid" aria-label="图片识别工作区">
              <div className="vision-image-input">
                <div className="vision-upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void selectImage(e.dataTransfer.files[0]); }}>
                  {image ? <img src={image.dataUrl} alt="待识别的图片预览" /> : <div className="vision-upload-empty"><span aria-hidden="true">▧</span><p>选一张参考图</p><small>也可以拖入图片</small></div>}
                  <button type="button" className="api-secondary" onClick={() => fileInput.current?.click()}>{image ? "更换图片" : "选择图片"}</button>
                  <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="选择识图图片" onChange={e => { void selectImage(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                <p className="api-help">PNG / JPG / WebP，最大 20 MB。本机转为 JPEG，长边最多 1600 像素；点击识别前不会上传。</p>
                {image && <p className="vision-image-name" title={image.name}>{image.name} · {image.width} × {image.height}</p>}
                <label htmlFor="vision-style">提示词形式</label><select id="vision-style" value={style} onChange={e => { stop(); setStyle(e.target.value as VisionStyle); setNotice(null); }}><option value="tags">英文标签 · 适合 NAI</option><option value="description">中文自然语言描述</option></select>
                <label htmlFor="vision-extra">补充要求（可选）</label><textarea id="vision-extra" rows={3} maxLength={1000} placeholder="例如：重点描述服装、光线和构图" value={extra} onChange={e => { stop(); setExtra(e.target.value); setNotice(null); }} />
              </div>
              <div className="vision-output">
                <div className="api-label-row"><label htmlFor="vision-result">识别出的提示词</label><span className="draft-badge">{resultModel || "结果可编辑"}</span></div>
                <textarea id="vision-result" value={result} onChange={e => { ++copySequence.current; setResult(e.target.value); setNotice(null); }} placeholder="识别完成后，提示词会显示在这里。" spellCheck={false} />
                <p className="api-help">AI 根据画面描述生成提示词，不能还原原图的原始提示词。检查并调整后再使用。</p>
                <div className="vision-output-actions"><button type="button" className="api-secondary" disabled={!result.trim() || !!activity} onClick={copy}>复制提示词</button><button type="button" className="api-secondary" disabled={!result.trim() || !!activity} onClick={() => apply("append")}>追加到主提示词</button><button type="button" className="api-clear" disabled={!result.trim() || !!activity} onClick={() => apply("replace")}>替换主提示词</button></div>
                <p className="vision-destination">{configured ? `识图服务：${destination} · ${saved.model}` : "先在「识图 API 设置」里保存地址、密钥和多模态模型。"}{isDirty && " 设置有未保存修改，当前识图仍使用已保存配置。"}</p>
              </div>
            </section>
          )}
          <div className="vision-feedback" aria-live="polite" aria-atomic="true">{error && <p role="alert" className="api-message error">{error}</p>}{notice && <p className="api-message neutral">{notice}</p>}{activity && <p role="status" className="api-help">{activity === "read" ? "正在本机处理图片…" : "正在等待模型答复，最多 90 秒…"}</p>}</div>
        </div>
        <footer className="api-settings-footer">
          {tab === "config" ? <><button type="button" className="api-clear" onClick={clearConfig} disabled={!saved.apiKey && !draft.apiKey && !draft.baseUrl && !draft.model}>清除识图配置</button><button type="button" className="api-primary" onClick={saveConfig}>保存识图配置</button></> : <><span>识图可能产生 API 费用；关闭后图片和结果不保存。</span><button type="button" className="api-primary" onClick={() => activity === "image" ? cancel() : configured ? run("image") : switchTab("config")} disabled={activity === "read" || (configured && !image)}>{activity === "image" ? "取消识别" : configured ? "识别图片" : "配置识图 API"}</button></>}
        </footer>
      </div>
    </dialog>
  );
}
