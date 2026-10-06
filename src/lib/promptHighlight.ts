export type PromptTone = "normal" | "artist" | "function" | "text" | "syntax";
export type PromptEmphasis = "normal" | "strong" | "weak" | "negative" | "zero";
export interface PromptToken { text: string; tone: PromptTone; emphasis: PromptEmphasis }
export const MAX_HIGHLIGHT_LENGTH = 50000;
export const PROMPT_COLORS_KEY = "nai_prompt_colors_v1";

const FUNCTION_TAGS = new Set([
  "best quality", "amazing quality", "great quality", "normal quality", "bad quality", "worst quality",
  "masterpiece", "top aesthetic", "very aesthetic", "aesthetic", "displeasing", "very displeasing",
  "low complexity", "medium complexity", "high complexity", "ultra complexity", "no text",
  "fur dataset", "background dataset", "transparent background", "has alpha", "alpha transparency",
]);
export const normalizePromptTag = (tag: string) => tag.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");

/** 本机显示用的词法拆分；所有片段拼回去必须逐字等于输入，不修改 API 提示词。 */
export function highlightPrompt(value: string, artists: ReadonlySet<string> = new Set(), model = "nai-diffusion-5-full") {
  const tokens: PromptToken[] = [];
  let weight = 1, brackets = 0, pos = 0;
  let hasNumeric = false, hasNegative = false, hasText = false;
  const emphasis = (): PromptEmphasis => weight === 0 ? "zero" : weight < 0 ? "negative"
    : Math.abs(weight * Math.pow(1.05, brackets) - 1) < 0.000001 ? "normal"
    : weight * Math.pow(1.05, brackets) > 1 ? "strong" : "weak";
  const push = (text: string, tone: PromptTone, mode = emphasis()) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last?.tone === tone && last.emphasis === mode) last.text += text;
    else tokens.push({ text, tone, emphasis: mode });
  };
  const plain = (text: string) => {
    for (const part of text.split(/(,|\n)/)) {
      const tag = normalizePromptTag(part);
      const tone = /^artist\s*:\s*\S/i.test(tag) || artists.has(tag) ? "artist"
        : FUNCTION_TAGS.has(tag) || /^(?:rating|meta)\s*:\s*\S/.test(tag) || /^year \d{4}$/.test(tag) ? "function" : "normal";
      push(part, tone);
    }
  };
  // Text: 后的全部内容是画面文字，不再把其中的括号、画师前缀或数字解释为权重。
  const syntax = /(?<![\w.+-])([+-]?(?:\d+(?:\.\d+)?|\.\d+))::|::|Text:|[{}[\]|]/gi;
  for (const match of value.matchAll(syntax)) {
    const start = match.index!;
    plain(value.slice(pos, start)); pos = start + match[0].length;
    const marker = match[0];
    if (/^Text:$/i.test(marker) && (start === 0 || /[\s,]/.test(value[start - 1]))) {
      hasText = true; push(marker + value.slice(pos), "text", "normal"); pos = value.length; break;
    }
    if (marker.endsWith("::")) {
      const numeric = match[1] === undefined ? 1 : Number(match[1]);
      if (!Number.isFinite(numeric)) { push(marker, "normal"); continue; }
      if (match[1] !== undefined) { hasNumeric = true; if (numeric < 0) hasNegative = true; }
      weight = numeric; brackets = 0; push(marker, "syntax");
    } else if (marker === "{" || marker === "]") { brackets++; push(marker, "syntax"); }
    else if (marker === "}" || marker === "[") { push(marker, "syntax"); brackets--; }
    else push(marker, /^Text:$/i.test(marker) ? "normal" : "syntax");
  }
  plain(value.slice(pos));
  const warnings: string[] = [];
  const newer = /^nai-diffusion-(?:4|5)/.test(model);
  if (hasNumeric && !newer) warnings.push("数字权重需要 V4 或更新模型；当前颜色只表示写法。");
  else if (hasNegative && !/^nai-diffusion-(?:4-5|5)/.test(model)) warnings.push("负数权重需要 V4.5 或更新模型；当前颜色只表示写法。");
  if (hasText && !newer) warnings.push("Text: 画面文字需要 V4 或更新模型。");
  return { tokens, warnings };
}

export function loadPromptColors(): boolean {
  try { return localStorage.getItem(PROMPT_COLORS_KEY) !== "0"; } catch { return true; }
}
