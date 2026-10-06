/** 标签只折叠显示这段完整文本；不依赖收藏库的当前内容。 */
export interface PromptChip { id: string; name: string; start: number; end: number; text: string }

/** 坏标签退回普通文字，始终保留作为生成依据的完整字符串。 */
export function normalizePromptChips(value: string, raw: unknown): PromptChip[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  let end = 0;
  return raw.slice(0, 500).filter((c): c is PromptChip => !!c && typeof c === "object"
    && typeof c.id === "string" && c.id.length > 0 && c.id.length <= 100
    && typeof c.name === "string" && c.name.trim().length > 0 && c.name.length <= 80
    && Number.isInteger(c.start) && Number.isInteger(c.end) && c.start >= 0 && c.end > c.start && c.end <= value.length
    && typeof c.text === "string" && value.slice(c.start, c.end) === c.text)
    .sort((a, b) => a.start - b.start).filter(c => {
      if (ids.has(c.id) || c.start < end) return false;
      ids.add(c.id); end = c.end; return true;
    }).map(({ id, name, start, end, text }) => ({ id, name, start, end, text }));
}

export interface CharPrompt {
  id: string;
  /** 本机备注，不自动作为生图提示词发送；旧存档缺省兼容。 */
  name?: string;
  /** 缺省启用，保留旧角色行为；关闭后仍可编辑但不发送。 */
  enabled?: boolean;
  caption: string;
  negative: string;
  captionChips?: PromptChip[];
  negativeChips?: PromptChip[];
  /** ai = 官方 AI's Choice；custom = 九宫格定位 */
  positionMode: "ai" | "custom";
  /** custom 时的归一化坐标（0~1），取九宫格中心 */
  x: number;
  y: number;
}

export interface GenParams {
  model: string;
  prompt: string;
  negativePrompt: string;
  promptChips?: PromptChip[];
  negativePromptChips?: PromptChip[];
  width: number;
  height: number;
  steps: number;
  scale: number;
  cfgRescale: number;
  sampler: string;
  noiseSchedule: string;
  /** null = 点生成时随机 */
  seed: number | null;
  qualityToggle: boolean;
  /** V4/V4.5/V5 人物提示词 */
  characters: CharPrompt[];
}

/** v4 系模型的人物提示词上限（官方 UI 上限，未实测验证） */
export const MAX_CHARACTERS = 6;

/** v4/v5 系模型都支持人物提示词（char_captions） */
export function isV4Model(model: string): boolean {
  return model.startsWith("nai-diffusion-4") || model.startsWith("nai-diffusion-5");
}

/** 尺寸取 64 的倍数并夹到 [64, 3072]（非法/越界输入统一归一） */
export function snapSize(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 832;
  const snapped = Math.round(v / 64) * 64;
  return Math.min(3072, Math.max(64, snapped));
}

/** seed 夹到 [0, 2^32-1] 的整数 */
export function clampSeed(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(0xffffffff, Math.max(0, Math.floor(v)));
}

/** 历史回填等来源不可信时，把人物提示词数组归一为合法结构 */
export function normalizeCharacters(raw: unknown): CharPrompt[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const clamp01 = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  return raw.slice(0, MAX_CHARACTERS).map((c: unknown, i: number) => {
    const o = (c ?? {}) as Partial<CharPrompt>;
    let id = typeof o.id === "string" && o.id ? o.id : `char-restored-${i}`;
    while (ids.has(id)) id += `-${i}`;
    ids.add(id);
    const captionChips = normalizePromptChips(typeof o.caption === "string" ? o.caption : "", o.captionChips);
    const negativeChips = normalizePromptChips(typeof o.negative === "string" ? o.negative : "", o.negativeChips);
    return {
      id,
      name: typeof o.name === "string" ? o.name.slice(0, 80) : "",
      enabled: o.enabled !== false,
      caption: typeof o.caption === "string" ? o.caption : "",
      negative: typeof o.negative === "string" ? o.negative : "",
      ...(captionChips.length ? { captionChips } : {}),
      ...(negativeChips.length ? { negativeChips } : {}),
      positionMode: o.positionMode === "custom" ? "custom" : "ai",
      x: clamp01(o.x),
      y: clamp01(o.y),
    };
  });
}

export interface HistoryItem {
  id: string;
  createdAt: number;
  png: Blob;
  /** 回填用：seed 已是定值 */
  params: GenParams;
  demo: boolean;
}

export const MODELS = [
  { id: "nai-diffusion-5-full", label: "NAI Diffusion v5 全量版" },
  { id: "nai-diffusion-5-curated", label: "NAI Diffusion v5 精选版" },
  { id: "nai-diffusion-4-5-full", label: "NAI Diffusion v4.5 全量版" },
  { id: "nai-diffusion-4-5-curated", label: "NAI Diffusion v4.5 精选版" },
  { id: "nai-diffusion-4-full", label: "NAI Diffusion v4 全量版" },
  { id: "nai-diffusion-4-curated", label: "NAI Diffusion v4 精选版" },
  { id: "nai-diffusion-3", label: "NAI Diffusion v3" },
] as const;

export const SAMPLERS = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2m",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_sde",
] as const;

export const NOISE_SCHEDULES = ["karras", "exponential", "polyexponential"] as const;

export const SIZE_PRESETS = [
  { label: "竖版 832×1216", w: 832, h: 1216 },
  { label: "横版 1216×832", w: 1216, h: 832 },
  { label: "方形 1024×1024", w: 1024, h: 1024 },
  { label: "小方 512×512", w: 512, h: 512 },
] as const;

export const DEFAULT_PARAMS: GenParams = {
  model: "nai-diffusion-5-curated",
  prompt: "",
  negativePrompt: "",
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  cfgRescale: 0,
  sampler: "k_euler_ancestral",
  noiseSchedule: "karras",
  seed: null,
  qualityToggle: true,
  characters: [],
};

export const PARAMS_KEY = "nai_params_v1";

/** 本机存档和历史回填共用入口：保留有效内容，只修正错误类型和越界值。 */
export function normalizeParams(raw: unknown): GenParams {
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const number = (key: "steps" | "scale" | "cfgRescale", min: number, max: number) =>
    typeof p[key] === "number" && Number.isFinite(p[key]) ? Math.min(max, Math.max(min, p[key])) : DEFAULT_PARAMS[key];
  const choice = (value: unknown, options: readonly string[], fallback: string) =>
    typeof value === "string" && options.includes(value) ? value : fallback;
  const promptChips = normalizePromptChips(typeof p.prompt === "string" ? p.prompt : "", p.promptChips);
  const negativePromptChips = normalizePromptChips(typeof p.negativePrompt === "string" ? p.negativePrompt : "", p.negativePromptChips);
  return {
    model: choice(p.model, MODELS.map(m => m.id), DEFAULT_PARAMS.model),
    prompt: typeof p.prompt === "string" ? p.prompt : "",
    negativePrompt: typeof p.negativePrompt === "string" ? p.negativePrompt : "",
    ...(promptChips.length ? { promptChips } : {}),
    ...(negativePromptChips.length ? { negativePromptChips } : {}),
    width: snapSize(typeof p.width === "number" && Number.isFinite(p.width) ? p.width : DEFAULT_PARAMS.width),
    height: snapSize(typeof p.height === "number" && Number.isFinite(p.height) ? p.height : DEFAULT_PARAMS.height),
    steps: Math.round(number("steps", 1, 50)),
    scale: number("scale", 0, 10),
    cfgRescale: number("cfgRescale", 0, 1),
    seed: typeof p.seed === "number" && Number.isFinite(p.seed) ? clampSeed(p.seed) : null,
    sampler: choice(p.sampler, SAMPLERS, DEFAULT_PARAMS.sampler),
    noiseSchedule: choice(p.noiseSchedule, NOISE_SCHEDULES, DEFAULT_PARAMS.noiseSchedule),
    qualityToggle: typeof p.qualityToggle === "boolean" ? p.qualityToggle : DEFAULT_PARAMS.qualityToggle,
    characters: normalizeCharacters(p.characters),
  };
}
