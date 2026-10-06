import { useEffect, useState } from "react";
import type { HistoryItem } from "../types";
import ImageViewer from "./ImageViewer";

/** blob → objectURL 的生命周期管理 */
function BlobImg({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}

interface Props {
  current: HistoryItem | null;
  history: HistoryItem[];
  busy: boolean;
  onSelect: (item: HistoryItem) => void;
  onLoadParams: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

function download(item: HistoryItem) {
  const url = URL.createObjectURL(item.png);
  const a = document.createElement("a");
  const t = new Date(item.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  a.href = url;
  a.download = `nai_${item.demo ? "demo_" : ""}${item.params.seed}_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultView({ current, history, busy, onSelect, onLoadParams, onDelete, onClearAll }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 当前预览 */}
      {current ? <ImageViewer key={current.id} png={current.png} busy={busy} onDownload={() => download(current)} onLoadParams={() => onLoadParams(current)} /> : (
        <div className="checkerboard relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-zinc-950/70 p-4">
          {busy ? <div className="text-center"><div className="mx-auto size-10 animate-spin rounded-full border-4 border-zinc-700 border-t-violet-400" /><p role="status" className="mt-3 text-sm text-zinc-400">正在生成画面…</p><p className="mt-2 text-xs text-zinc-500">可回到编辑区取消生成</p></div> : (
            <div className="canvas-empty animate-fade-in text-center">
              <div className="canvas-empty-art" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="10" y="12" width="44" height="40" rx="5"/><circle cx="40" cy="25" r="4"/><path d="m11 44 13-14 12 12 7-7 10 10"/><path d="M24 6v9M19.5 10.5h9"/></svg>
              </div>
              <p className="mt-6 text-lg font-medium text-zinc-300">下一张画面，从一个想法开始</p>
              <p className="mt-3 text-xs leading-6 text-zinc-400">从词库挑选灵感 → 调整提示词 → 点击生成<br />没有 Token 时，可开启演示模式试用</p>
            </div>
          )}
        </div>
      )}

      {/* 当前图参数摘要 */}
      {current && (
        <div className="result-summary animate-fade-in border-t border-white/5 bg-zinc-950/50 px-4 py-2 text-xs leading-relaxed break-all text-zinc-400 backdrop-blur-sm">
          <span className="text-zinc-400">Seed {current.params.seed}</span> · {current.params.width}×{current.params.height} ·{" "}
          {current.params.steps}步 · {current.params.model} {current.demo && <span className="text-amber-400">· 演示图</span>}
          <br />
          {current.params.prompt || "（空提示词）"}
        </div>
      )}

      {/* 历史 */}
      <div className="result-history max-h-56 shrink-0 border-t border-white/5 bg-zinc-950/60 backdrop-blur-sm">
        <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
          <h3 className="text-sm font-medium text-zinc-300">本地历史</h3>
          <div className="flex items-baseline gap-3">
            <span className="text-xs text-zinc-600">{history.length} 张</span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`清空全部 ${history.length} 张历史？此操作不可恢复。`)) onClearAll();
                }}
                className="text-xs text-zinc-600 transition hover:text-red-400"
              >
                清空
              </button>
            )}
          </div>
        </div>
        <div className="result-history-grid grid max-h-44 grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 overflow-y-auto p-3">
          {history.length === 0 && <p className="col-span-full py-4 text-center text-xs text-zinc-600">还没有生成过图片</p>}
          {history.map((h) => (
            <div key={h.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(h)}
                aria-label={`查看历史图片 ${h.params.seed}`}
                aria-pressed={current?.id === h.id}
                className={`block aspect-square w-full overflow-hidden rounded-lg border transition duration-150 ${
                  current?.id === h.id
                    ? "border-violet-500 ring-2 ring-violet-500/30"
                    : "border-white/5 hover:border-zinc-500"
                } hover:brightness-110`}
              >
                <BlobImg blob={h.png} alt="历史图片" className="size-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => { if (window.confirm("删除这张历史图片？此操作不可恢复。")) onDelete(h.id); }}
                title="删除这张"
                aria-label={`删除历史图片 ${h.params.seed}`}
                className="absolute top-1 right-1 flex size-6 items-center justify-center rounded bg-black/70 text-xs text-zinc-300 opacity-70 backdrop-blur-sm transition hover:opacity-100 hover:bg-black/90 hover:text-red-400 focus-visible:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
