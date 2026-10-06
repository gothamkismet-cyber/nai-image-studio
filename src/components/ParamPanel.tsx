import { MODELS, SAMPLERS, NOISE_SCHEDULES, SIZE_PRESETS, isV4Model, snapSize, clampSeed, type GenParams } from "../types";
import CharPrompts from "./CharPrompts";
import type { LibTarget } from "./PromptLibraryDialog";
import { useState } from "react";
import PromptEditor from "./PromptEditor";
import { loadPromptColors, PROMPT_COLORS_KEY } from "../lib/promptHighlight";

interface Props {
  params: GenParams;
  artists: ReadonlySet<string>;
  busy: boolean;
  onChange: (patch: Partial<GenParams>) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenLibrary: (target: LibTarget) => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

export default function ParamPanel({ params, artists, busy, onChange, onGenerate, onCancel, onOpenLibrary }: Props) {
  const sizePresetMatched = SIZE_PRESETS.some((s) => s.w === params.width && s.h === params.height);
  const [colors, setColors] = useState(loadPromptColors);
  const [colorNotice, setColorNotice] = useState("");
  function toggleColors(enabled: boolean) {
    setColors(enabled); setColorNotice("");
    try { localStorage.setItem(PROMPT_COLORS_KEY, enabled ? "1" : "0"); }
    catch { setColorNotice("着色开关已在本次生效，但偏好保存失败，重开时可能恢复。"); }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="editor-fields min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* 模型 */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide text-zinc-500 uppercase">模型</span>
          <select
            value={params.model}
            onChange={(e) => onChange({ model: e.target.value })}
            className="w-full cursor-pointer rounded-lg border border-zinc-700/80 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {/* 提示词 */}
        <div>
          <span className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">提示词（想画什么）</span>
            <button
              type="button"
              onClick={() => onOpenLibrary({ kind: "main" })}
              className="rounded-md border border-zinc-700/80 bg-zinc-900/60 px-1.5 py-0.5 text-xs text-zinc-400 transition hover:border-violet-500/50 hover:text-violet-300"
              title="从本地提示词库搜索并插入"
            >
              📖 词库
            </button>
          </span>
          <PromptEditor colors={colors} artists={artists} model={params.model}
            value={params.prompt}
            chips={params.promptChips}
            onValueChange={(prompt, promptChips) => onChange({ prompt, promptChips })}
            rows={5}
            id="main-prompt"
            aria-label="提示词（想画什么）"
            placeholder="1girl, silver hair, red eyes, school uniform, ...（支持英文标签或自然句）"
            className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
          />
          <div className="prompt-color-tools">
            <label><input type="checkbox" checked={colors} onChange={e => toggleColors(e.target.checked)} />提示词着色</label>
            <details><summary>颜色说明</summary><div className="prompt-color-legend"><span className="prompt-tone-artist">画师 · 青色</span><span className="prompt-weight-strong">加强 · 金色</span><span className="prompt-weight-weak">减弱 · 蓝色</span><span className="prompt-weight-negative">负权重 · 粉色</span><span className="prompt-weight-zero">零权重 · 灰色</span><span className="prompt-tone-function">功能词 · 紫色</span><span className="prompt-tone-text">画面文字 · 绿色</span></div><p>参照 NovelAI 官方权重写法，颜色按本软件配色。权重以底色区分，画师等类别保留自己的字色。支持 {"{加强}、[减弱]、1.5::内容::"}；功能词含质量、年份、rating:、meta: 等。Text: 后全部作为画面文字显示。</p><p>颜色只帮助读写；不代表模型一定认识这个标签。旧画师名仅按当前词库识别，artist: 前缀不要求词库。</p></details>
          </div>
          {colorNotice && <p role="status" className="prompt-color-note">{colorNotice}</p>}
        </div>

        {/* 人物提示词（仅 v4 系模型） */}
        {isV4Model(params.model) && (
          <CharPrompts
            characters={params.characters}
            colors={colors} artists={artists} model={params.model}
            disabled={busy}
            onChange={(chars) => onChange({ characters: chars })}
            onOpenLibrary={(index) => onOpenLibrary({ kind: "char", id: params.characters[index].id })}
          />
        )}

        {/* 负面提示词 */}
        <div className="rounded-lg border border-zinc-800">
          <div className="flex items-center justify-between px-3 py-2"><label htmlFor="negative-prompt" className="text-sm font-medium text-zinc-300">负面词 · 不想要什么</label><button type="button" onClick={() => onOpenLibrary({ kind: "negative" })} className="subtle-button">词库</button></div>
          <PromptEditor colors={colors} artists={artists} model={params.model}
            id="negative-prompt"
            aria-label="负面提示词"
            value={params.negativePrompt}
            chips={params.negativePromptChips}
            onValueChange={(negativePrompt, negativePromptChips) => onChange({ negativePrompt, negativePromptChips })}
            rows={3}
            placeholder="lowres, bad anatomy, ..."
            className="w-full resize-y border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
          />
        </div>

        {/* 尺寸 */}
        <div>
          <span className="mb-1 block text-sm font-medium text-zinc-300">尺寸</span>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_PRESETS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onChange({ width: s.w, height: s.h })}
                aria-pressed={params.width === s.w && params.height === s.h}
                className={`size-preset rounded-md border px-2.5 py-1 text-xs ${
                  params.width === s.w && params.height === s.h
                    ? "border-violet-500 bg-violet-600/30 text-violet-200"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className={sizePresetMatched ? "text-zinc-500" : "text-zinc-300"}>自定义：</span>
            <input
              type="number"
              min={64}
              max={3072}
              step={64}
              value={params.width}
              aria-label="图片宽度"
              onChange={(e) => onChange({ width: Number(e.target.value) || 64 })}
              onBlur={() => onChange({ width: snapSize(params.width) })}
              className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            />
            <span className="text-zinc-500">×</span>
            <input
              type="number"
              min={64}
              max={3072}
              step={64}
              value={params.height}
              aria-label="图片高度"
              onChange={(e) => onChange({ height: Number(e.target.value) || 64 })}
              onBlur={() => onChange({ height: snapSize(params.height) })}
              className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            />
            <span className="text-xs text-zinc-500">（64 的倍数）</span>
          </div>
        </div>

        {/* 步数 */}
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-zinc-300">
            步数 <span className="text-zinc-500">{params.steps}</span>
          </span>
          <input
            type="range"
            min={1}
            max={50}
            value={params.steps}
            onChange={(e) => onChange({ steps: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
        </label>

        {/* CFG scale */}
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-zinc-300">
            提示词强度 (Scale) <span className="text-zinc-500">{params.scale}</span>
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={params.scale}
            onChange={(e) => onChange({ scale: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
        </label>

        {/* CFG rescale */}
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-zinc-300">
            对比度修正 (Rescale) <span className="text-zinc-500">{params.cfgRescale}</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.cfgRescale}
            onChange={(e) => onChange({ cfgRescale: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
        </label>

        {/* 采样器 / 噪声表 */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-300">采样器</span>
            <select
              value={params.sampler}
              onChange={(e) => onChange({ sampler: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            >
              {SAMPLERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-300">噪声表</span>
            <select
              value={params.noiseSchedule}
              onChange={(e) => onChange({ noiseSchedule: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            >
              {NOISE_SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* seed */}
        <div>
          <span className="mb-1 block text-sm font-medium text-zinc-300">Seed（随机种子）</span>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={params.seed ?? ""}
              aria-label="Seed（留空随机）"
              aria-describedby="seed-help"
              placeholder="留空，每次随机"
              onChange={(e) => onChange({ seed: e.target.value === "" ? null : Number(e.target.value) })}
              onBlur={() => onChange({ seed: params.seed === null ? null : clampSeed(params.seed) })}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            />
            <button
              type="button"
              onClick={() => onChange({ seed: null })}
              aria-pressed={params.seed === null}
              className={`shrink-0 rounded-lg border px-2 text-xs transition-colors ${params.seed === null ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
            >
              每次随机
            </button>
            <button
              type="button"
              onClick={() => onChange({ seed: randomSeed() })}
              title="换一个固定 Seed，后续生成重复使用这个值"
              aria-label="换一个固定 Seed"
              className="shrink-0 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              🎲
            </button>
          </div>
          <p id="seed-help" className="mt-2 text-xs leading-relaxed text-zinc-400">
            {params.seed === null
              ? "每次生成重新随机；实际 Seed 保存在图片详情和历史中。"
              : "当前固定 Seed，相同参数会复用它。想连续出新图，请点「每次随机」。"}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={params.qualityToggle}
            onChange={(e) => onChange({ qualityToggle: e.target.checked })}
            className="size-4 accent-violet-500"
          />
          追加官方质量标签
        </label>
      </div>

      <div className="generate-footer">
        <div className="generate-meta"><span>单张生成</span><span>{params.width} × {params.height} · {params.steps} 步</span></div>
        <button
          type="button"
          onClick={busy ? onCancel : onGenerate}
          className="generate-button"
          data-busy={busy}
        >
          {busy ? "取消生成" : "生成"}
        </button>
      </div>
    </div>
  );
}
