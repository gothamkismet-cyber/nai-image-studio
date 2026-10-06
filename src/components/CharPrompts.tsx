import { MAX_CHARACTERS, type CharPrompt } from "../types";
import PromptEditor from "./PromptEditor";

interface Props {
  characters: CharPrompt[];
  colors: boolean;
  artists: ReadonlySet<string>;
  model: string;
  disabled: boolean;
  onChange: (chars: CharPrompt[]) => void;
  onOpenLibrary: (index: number) => void;
}

/** 官方九宫格位置：取格子中心的归一化坐标 */
function gridCenter(col: number, row: number): { x: number; y: number } {
  return { x: (col * 2 + 1) / 6, y: (row * 2 + 1) / 6 };
}

function posLabel(x: number, y: number): string {
  const col = Math.round(x * 3 - 0.5);
  const row = Math.round(y * 3 - 0.5);
  const rows = ["上", "中", "下"];
  const cols = ["左", "中", "右"];
  return `${rows[row] ?? "?"}${cols[col] ?? "?"}`;
}

function NineGrid({ x, y, disabled, onPick }: { x: number; y: number; disabled?: boolean; onPick: (x: number, y: number) => void }) {
  const activeCol = Math.round(x * 3 - 0.5);
  const activeRow = Math.round(y * 3 - 0.5);
  return (
    <div className="grid grid-cols-3 gap-0.5 rounded-md border border-zinc-700 bg-zinc-950 p-1">
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const active = row === activeRow && col === activeCol;
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            aria-label={`位置：${posLabel(gridCenter(col, row).x, gridCenter(col, row).y)}`}
            aria-pressed={active}
            onClick={() => {
              const c = gridCenter(col, row);
              onPick(c.x, c.y);
            }}
            className={`size-6 rounded-sm ${active ? "bg-violet-500" : "bg-zinc-800 hover:bg-zinc-700"}`}
            title={`位置：${posLabel(gridCenter(col, row).x, gridCenter(col, row).y)}`}
          />
        );
      })}
    </div>
  );
}

let charSeq = 0;
function newChar(): CharPrompt {
  charSeq += 1;
  return {
    id: `char-${Date.now()}-${charSeq}`,
    name: "",
    enabled: true,
    caption: "",
    negative: "",
    positionMode: "ai",
    x: 0.5,
    y: 0.5,
  };
}

export default function CharPrompts({ characters, colors, artists, model, disabled, onChange, onOpenLibrary }: Props) {
  function patch(id: string, p: Partial<CharPrompt>) {
    onChange(characters.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }

  return (
    <div className="rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium text-zinc-300">
          人物提示词
          <span className="ml-2 text-xs font-normal text-zinc-500">分别设定外貌与服装</span>
        </span>
        <button
          type="button"
          disabled={disabled || characters.length >= MAX_CHARACTERS}
          onClick={() => onChange([...characters, newChar()])}
          className="rounded-md border border-zinc-700 px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          title={characters.length >= MAX_CHARACTERS ? `最多 ${MAX_CHARACTERS} 个角色` : "添加角色"}
        >
          ＋ 角色
        </button>
      </div>

      {characters.length === 0 && (
        <p className="px-3 pb-3 text-xs leading-relaxed text-zinc-600">
          多人画面可以分别写角色词，再选择各自的位置。单人画面也可直接使用主提示词。
        </p>
      )}

      <div className="space-y-2 px-3 pb-3">
        {characters.map((c, idx) => (
          <div key={c.id} className={`rounded-md border bg-zinc-950/60 p-2.5 ${c.enabled === false ? "border-zinc-800" : "border-violet-500/25"}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-violet-300">
                <input type="checkbox" aria-label={`角色 ${idx + 1} 加入生成`} checked={c.enabled !== false}
                  disabled={disabled} onChange={e => patch(c.id, { enabled: e.target.checked })} className="accent-violet-400" />
                加入生成
              </label>
              <input type="text" aria-label={`角色 ${idx + 1} 名称`} value={c.name ?? ""} maxLength={80}
                disabled={disabled} onChange={e => patch(c.id, { name: e.target.value })} placeholder={`角色 ${idx + 1}`}
                className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-violet-200 outline-none focus:border-violet-400" />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(characters.filter((x) => x.id !== c.id))}
                className="text-xs text-zinc-500 hover:text-red-400"
              >
                删除
              </button>
            </div>
            <p className="mb-2 text-xs text-zinc-500">{c.enabled === false ? "已停用，提示词保留，可继续编辑。" : !c.caption.trim() ? "填写角色提示词后才会加入生成。" : "已加入本次生成。"}</p>
            <PromptEditor colors={colors} artists={artists} model={model}
              aria-label={`角色 ${idx + 1} 提示词`}
              value={c.caption}
              disabled={disabled}
              chips={c.captionChips}
              onValueChange={(caption, captionChips) => patch(c.id, { caption, captionChips })}
              rows={2}
              placeholder="角色外貌与服装，如：girl, silver hair, red eyes, gothic dress"
              className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch(c.id, { positionMode: "ai" })}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    c.positionMode === "ai"
                      ? "border-violet-500 bg-violet-600/30 text-violet-200"
                      : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  AI 自选位置
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch(c.id, { positionMode: "custom" })}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    c.positionMode === "custom"
                      ? "border-violet-500 bg-violet-600/30 text-violet-200"
                      : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  指定位置
                </button>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpenLibrary(idx)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                title="从提示词库插入到这个角色"
              >
                📖 词库
              </button>
            </div>
            {c.positionMode === "custom" && (
              <div className="mt-2 flex items-center gap-3">
                <NineGrid x={c.x} y={c.y} disabled={disabled} onPick={(x, y) => patch(c.id, { x, y })} />
                <span className="text-xs text-zinc-500">
                  站位：{posLabel(c.x, c.y)}
                  <br />
                  <span className="text-zinc-600">（x {c.x.toFixed(2)} / y {c.y.toFixed(2)}）</span>
                </span>
              </div>
            )}
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-zinc-500 select-none hover:text-zinc-300">
                该角色的负面词（可选）
              </summary>
              <PromptEditor colors={colors} artists={artists} model={model}
                aria-label={`角色 ${idx + 1} 负面词`}
                value={c.negative}
                disabled={disabled}
                chips={c.negativeChips}
                onValueChange={(negative, negativeChips) => patch(c.id, { negative, negativeChips })}
                rows={2}
                placeholder="只作用于这个角色的负面词"
                className="mt-1 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/20 transition-colors"
              />
            </details>
          </div>
        ))}
      </div>
      <details className="character-help"><summary>角色与定位说明</summary><p>名称只作本机备注，不发送给模型。人数词如 2girls 写在主提示词。指定位置会开启整张图的角色定位；同图中 AI 自选的角色使用中心参考点。</p></details>
    </div>
  );
}
