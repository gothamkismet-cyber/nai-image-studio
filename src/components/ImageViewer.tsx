import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { boundImage, copyImage, fitImage, MAX_IMAGE_SCALE, MIN_IMAGE_SCALE, zoomImage, type ImageSize, type ImageView } from "../lib/imageView";

interface Props { png: Blob; busy: boolean; onDownload: () => void; onLoadParams: () => void }

export default function ImageViewer({ png, busy, onDownload, onLoadParams }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [image, setImage] = useState<ImageSize | null>(null);
  const [view, setView] = useState<ImageView>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const area = useRef<ImageSize>({ width: 0, height: 0 });
  const fitted = useRef(true);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const copyId = useRef(0);
  const live = useRef({ image, view, busy });
  live.current = { image, view, busy };

  useEffect(() => {
    const next = URL.createObjectURL(png); setUrl(next);
    return () => { URL.revokeObjectURL(next); copyId.current++; };
  }, [png]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      area.current = { width: el.clientWidth, height: el.clientHeight };
      // 窄屏切换区域时可能暂时隐藏；保留有效视图，显示后再测量。
      if (!image || !area.current.width || !area.current.height) return;
      setView(v => fitted.current ? fitImage(image, area.current) : boundImage(v, image, area.current));
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [image]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      const state = live.current;
      if (!state.image || state.busy || event.deltaY === 0) return;
      event.preventDefault(); fitted.current = false;
      const r = el.getBoundingClientRect();
      const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? r.height : 1);
      setView(v => zoomImage(v, v.scale * Math.exp(-Math.max(-200, Math.min(200, amount)) * 0.002), state.image!, area.current, { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => { if (busy) { drag.current = null; setDragging(false); } }, [busy]);

  function fit() { if (image) { fitted.current = true; setView(fitImage(image, area.current)); } }
  function zoom(scale: number) { if (image) { fitted.current = false; setView(v => zoomImage(v, scale, image, area.current)); } }
  function startDrag(e: PointerEvent<HTMLDivElement>) {
    if (!image || busy || e.button !== 0 || drag.current) return;
    e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; setDragging(true);
  }
  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !image || busy) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; fitted.current = false;
    setView(v => boundImage({ ...v, x: v.x + dx, y: v.y + dy }, image, area.current));
  }
  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null; setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (!image || busy) return;
    if (["+", "=", "-", "0", "1", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) e.preventDefault(); else return;
    if (e.key === "+" || e.key === "=") zoom(view.scale * 1.25);
    else if (e.key === "-") zoom(view.scale / 1.25);
    else if (e.key === "0") fit();
    else if (e.key === "1") zoom(1);
    else {
      fitted.current = false;
      setView(v => boundImage({ ...v, x: v.x + (e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0), y: v.y + (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0) }, image, area.current));
    }
  }
  async function copy() {
    if (copying) return;
    const id = ++copyId.current; setCopying(true); setNotice("");
    try { await copyImage(png); if (id === copyId.current) setNotice("完整图片已复制，可粘贴到支持图片的应用。"); }
    catch (e) { if (id === copyId.current) setNotice(e instanceof Error ? e.message : "复制失败，请使用下载 PNG。"); }
    finally { if (id === copyId.current) setCopying(false); }
  }

  return <div className="image-viewer">
    <div className="image-view-toolbar" role="group" aria-label="图片查看工具">
      <button type="button" aria-label="缩小图片" onClick={() => zoom(view.scale / 1.25)} disabled={!image || busy || view.scale <= MIN_IMAGE_SCALE}>−</button>
      <output aria-label="图片缩放比例">{image ? `${Math.round(view.scale * 100)}%` : "—"}</output>
      <button type="button" aria-label="放大图片" onClick={() => zoom(view.scale * 1.25)} disabled={!image || busy || view.scale >= MAX_IMAGE_SCALE}>＋</button>
      <button type="button" onClick={() => zoom(1)} disabled={!image || busy}>原始尺寸</button>
      <button type="button" onClick={fit} disabled={!image || busy}>适应窗口</button>
      <span>滚轮缩放 · 按住拖动</span>
    </div>
    <div ref={stage} className={`checkerboard image-view-stage ${dragging ? "is-dragging" : ""}`} role="region" aria-label="图片查看区" aria-describedby="image-view-help" tabIndex={0}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onKeyDown={key} onDoubleClick={() => { if (!busy) { if (fitted.current) zoom(1); else fit(); } }}>
      <span id="image-view-help" className="sr-only">滚轮或加减键缩放，鼠标或手指拖动，方向键移动，0 适应窗口，1 原始尺寸，双击切换。</span>
      {url && <img src={url} alt="当前生成结果" draggable={false} className="image-view-picture" onLoad={e => {
        const next = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
        setImage(next); fitted.current = true; setError("");
      }} onError={() => { setImage(null); setError("图片预览失败，仍可尝试下载原图。"); }}
        style={{ visibility: image ? "visible" : "hidden", width: image ? image.width * view.scale : 0, height: image ? image.height * view.scale : 0, transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))` }} />}
      {error && <p role="alert" className="image-view-error">{error}</p>}
      {busy && <div className="image-view-busy"><div><div className="mx-auto size-10 animate-spin rounded-full border-4 border-zinc-700 border-t-violet-400" /><p role="status">正在生成画面…</p><small>可回到编辑区取消生成</small></div></div>}
    </div>
    <div className="image-view-actions">
      <button type="button" onClick={() => void copy()} disabled={copying || busy}>{copying ? "正在复制…" : "复制图片"}</button>
      <button type="button" onClick={onDownload}>下载 PNG</button>
      <button type="button" onClick={onLoadParams}>载入参数</button>
    </div>
    {notice && <p role="status" className="image-copy-notice">{notice}</p>}
  </div>;
}
