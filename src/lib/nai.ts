import JSZip from "jszip";
import type { GenParams } from "../types";
import { characterLimit, effectiveGenerationParams, isMediumModel } from "../types";

export const IMAGE_ENDPOINT = "https://image.novelai.net/ai/generate-image";
export const SUBSCRIPTION_ENDPOINT = "https://image.novelai.net/user/subscription";
const GENERATE_TIMEOUT_MS = 120_000;
const TOKEN_CHECK_TIMEOUT_MS = 10_000;

/** V5 时代官方要求请求头带关联 id（词库实现验证可用） */
function correlationId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => chars[n % chars.length]).join("");
}

/** V5 响应为 JSON {images:[{image: base64, seed}]}，旧模型可能仍回 ZIP；统一转成 PNG blob + 服务端实际 seed */
async function parseImageResponse(res: Response, fallbackSeed: number): Promise<{ png: Blob; seed: number }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as { images?: { image?: string; seed?: number }[] };
    const first = data.images?.find((i) => i.image);
    if (!first?.image) throw new NaiError("NovelAI 已响应，但返回内容里没有图片。", -1);
    const raw = first.image.replace(/\s/g, "");
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    const blob = await (await fetch(dataUrl)).blob();
    const returnedSeed = first.seed;
    const seed = typeof returnedSeed === "number" && Number.isFinite(returnedSeed) ? returnedSeed : fallbackSeed;
    return { png: blob, seed };
  }
  const zip = await JSZip.loadAsync(await res.blob()).catch(() => {
    throw new NaiError("返回数据解压失败，可能拿到了非图片内容。", -1);
  });
  const entry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith(".png"));
  if (!entry) throw new NaiError("返回包里没有找到图片。", -1);
  return { png: await entry.async("blob"), seed: fallbackSeed };
}

/** 带人话恢复提示的 API 错误 */
export class NaiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "NaiError";
  }
}

function mapError(status: number, body: string): NaiError {
  switch (status) {
    case 401:
      return new NaiError("Token 无效或已过期。请打开右上角「API 配置」检查 NovelAI API Token。", 401);
    case 402:
      return new NaiError(
        "可用额度不足：V5 的 Opus 免费生成也有使用上限。可以等待额度恢复、调整尺寸，或试用 V5 全量版的 Medium 模式；以账户实际额度为准。",
        402,
      );
    case 429:
      return new NaiError("请求太频繁，被官方限流了。等一小会儿再点生成。", 429);
    default:
      return new NaiError(`生成失败（HTTP ${status}）${body ? `：${body.slice(0, 200)}` : ""}`, status);
  }
}

/** V4/V5 都需要正负 caption；characterPrompts 与其角色顺序/坐标保持一致。 */
export function buildPayload(raw: GenParams) {
  const p = effectiveGenerationParams(raw);
  const isV4 = p.model.startsWith("nai-diffusion-4");
  const isV5 = p.model.startsWith("nai-diffusion-5");
  const medium = isMediumModel(p.model);
  const chars = p.characters.filter(c => c.enabled !== false && c.caption.trim().length > 0);
  if ((isV4 || isV5) && chars.length > characterLimit(p.model)) throw new NaiError(`当前模型最多同时使用 ${characterLimit(p.model)} 个角色，请停用多出的角色或切换到 V5。`, 0);
  const prompt = isV5 ? prepareV5Prompt(p, chars) : p.prompt;
  const negative = medium ? V5_HEAVY_NEGATIVE : p.negativePrompt;
  const parameters: Record<string, unknown> = {
    params_version: isV4 || isV5 ? 4 : 3,
    width: p.width,
    height: p.height,
    scale: p.scale,
    sampler: p.sampler,
    steps: p.steps,
    n_samples: 1,
    seed: p.seed,
    qualityToggle: p.qualityToggle,
    ucPreset: 0,
    cfg_rescale: p.cfgRescale,
    noise_schedule: p.noiseSchedule,
    skip_cfg_above_sigma: null,
    legacy: false,
    add_original_image: false,
    controlnet_strength: 1,
    dynamic_thresholding: false,
    negative_prompt: "",
  };
  if (isV4 || isV5) {
    // 空白/停用角色只留在本机，名称/id 等界面信息不进入 API。
    const coordinate = (v: number) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
    const centerOf = (c: GenParams["characters"][number]) => c.positionMode === "custom"
      ? { x: coordinate(c.x), y: coordinate(c.y) } : { x: 0.5, y: 0.5 };
    const useCoords = chars.some(c => c.positionMode === "custom");
    Object.assign(parameters, {
      legacy_v3_extend: false, sm: false, sm_dyn: false, add_original_image: true,
      negative_prompt: negative, use_coords: useCoords, legacy_uc: false,
      characterPrompts: chars.map(c => ({ prompt: c.caption, uc: c.negative, center: centerOf(c), enabled: true })),
    });
    // 官方 v4Prompts: !0 表示 true，V5 也走这组结构。零角色时同样保留。
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: chars.map(c => ({ char_caption: c.caption, centers: [centerOf(c)] })) },
      use_coords: useCoords, use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: negative, char_captions: chars.map(c => ({ char_caption: c.negative, centers: [centerOf(c)] })) },
      legacy_uc: false,
    };
    if (isV5) {
      delete parameters.qualityToggle;
      delete parameters.ucPreset;
      parameters.image_format = "png";
      parameters.straight_alpha = true;
      parameters.tag_hint_transparent_background = p.transparentBackground === true;
      parameters.tag_hint_qt = !p.qualityToggle ? 0 : p.qualityPreset === "light" ? 3 : 1;
      if (medium) { parameters.tag_hint_uc_preset = 2; delete parameters.cfg_rescale; }
    }
  } else {
    parameters.negative_prompt = p.negativePrompt;
    parameters.sm = false;
    parameters.sm_dyn = false;
  }
  return { input: prompt, model: p.model, action: "generate", parameters };
}

// 与官方 Medium 固定 heavy 预设对应；用户自己的负面词始终保留在编辑器里。
const V5_HEAVY_NEGATIVE = "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";

function quotedText(text: string): string[] {
  const quotes: Record<string, string> = { '"': '"', "“": "”", "「": "」", "'": "'", "‘": "’" };
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const endQuote = quotes[text[i]];
    if (!endQuote || (text[i] === "'" && i > 0 && !/[\s,.]/.test(text[i - 1]))) continue;
    let end = i + 1;
    while (end < text.length && (text[end] !== endQuote || ((endQuote === "'" || endQuote === "’") && /[\p{L}\p{N}]/u.test(text[end + 1] ?? "")))) end++;
    if (end === text.length) continue;
    const content = text.slice(i + 1, end).trim();
    if (content) found.push(content);
    i = end;
  }
  return found;
}

/** 在请求副本中追加 V5 标签和 teXt 区块，绝不重写用户的提示词或名称标签。 */
function prepareV5Prompt(p: GenParams, chars: GenParams["characters"]): string {
  const textMarker = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i;
  const manual = textMarker.exec(p.prompt);
  const split = manual ? manual.index : p.prompt.length;
  const tags = [p.transparentBackground ? "transparent background" : "", p.qualityToggle
    ? `very aesthetic, ${p.qualityPreset === "light" ? "amazing quality" : "masterpiece"}, no text` : ""].filter(Boolean);
  const texts = !manual && p.autoText !== false && !chars.some(c => textMarker.test(c.caption))
    ? [p.prompt, ...chars.map(c => c.caption)].flatMap(quotedText) : [];
  if (!tags.length && !texts.length) return p.prompt;
  let prompt = p.prompt.slice(0, split).replace(/[\s,]+$/, "");
  if (tags.length) prompt = [prompt, ...tags].filter(Boolean).join(", ");
  if (manual) {
    const markerAt = manual.index + manual[0].toLowerCase().indexOf("text:");
    return `${prompt}${prompt ? ", " : ""}${p.prompt.slice(markerAt)}`;
  }
  if (texts.length) prompt = `${prompt}${prompt ? ", " : ""}teXt: ${texts.join("\n\n")}`;
  return prompt;
}

/** 可中止的延时：演示模式取消用 */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NaiError("已取消本次生成。", 0));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new NaiError("已取消本次生成。", 0));
      },
      { once: true },
    );
  });
}

function abortMessage(signal: AbortSignal | undefined, timeout: AbortSignal): string {
  if (signal?.aborted) return "已取消本次生成。";
  if (timeout.aborted) return "生成超时：服务器长时间无响应（网络可能不稳定）。请重试。";
  return "网络错误：连不上 NovelAI。请确认网络/代理已开启，且浏览器能访问 novelai.net。";
}

export async function generateImage(
  token: string,
  p: GenParams,
  signal?: AbortSignal,
): Promise<{ png: Blob; seed: number }> {
  const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-correlation-id": correlationId(),
      },
      body: JSON.stringify(buildPayload(p)),
      signal: composed,
    });
  } catch {
    throw new NaiError(abortMessage(signal, timeout), 0);
  }
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  try {
    const result = await parseImageResponse(res, p.seed ?? 0);
    if (composed.aborted) throw composed.reason;
    return result;
  } catch (e) {
    if (composed.aborted) throw new NaiError(abortMessage(signal, timeout), 0);
    throw e;
  }
}

export interface SubscriptionInfo {
  tier: number;
  active: boolean;
}

/** 粘贴请求头时允许带 Bearer 前缀，其余内容不做猜测或改写。 */
export function normalizeToken(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, "").trim();
}

export function tokenInputError(token: string): string | null {
  if (!token) return "请先粘贴 NovelAI 的 API Token。";
  if (/\s/.test(token)) return "Token 中间含有空格或换行，请重新复制完整的 Token。";
  if (/^https?:\/\//i.test(token)) return "这里需要 API Token，请不要填写网址。";
  return null;
}

export async function checkToken(token: string, signal?: AbortSignal): Promise<SubscriptionInfo> {
  const normalized = normalizeToken(token);
  const inputError = tokenInputError(normalized);
  if (inputError) throw new NaiError(inputError, 0);
  const timeout = AbortSignal.timeout(TOKEN_CHECK_TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(SUBSCRIPTION_ENDPOINT, {
      headers: { Authorization: `Bearer ${normalized}`, Accept: "application/json" },
      signal: composed,
    });
    if (!res.ok) {
      const messages: Record<number, string> = {
        400: "连接测试失败（HTTP 400）：服务器拒绝了查询。当前已使用图片接口，请确认运行的是更新后的版本。",
        401: "连接测试失败（HTTP 401）：Token 无效或已失效，请重新获取并粘贴。",
        403: "连接测试失败（HTTP 403）：服务器拒绝访问，请检查账户状态。",
        429: "连接测试失败（HTTP 429）：请求过于频繁，请稍后手动重试。",
      };
      throw new NaiError(messages[res.status] ?? `连接测试失败（HTTP ${res.status}）：NovelAI 服务暂时无法完成查询，请稍后重试。`, res.status);
    }
    let data: Partial<SubscriptionInfo> | null;
    try { data = await res.json(); }
    catch {
      if (composed.aborted) throw composed.reason;
      throw new NaiError("服务器已响应，但订阅信息无法读取。请稍后重试。", res.status);
    }
    if (!data || typeof data !== "object" || typeof data.active !== "boolean" || !Number.isInteger(data.tier)) {
      throw new NaiError("服务器已响应，但返回的订阅信息不完整，暂时无法确认连接。", res.status);
    }
    return { tier: data.tier!, active: data.active };
  } catch (e) {
    if (e instanceof NaiError) throw e;
    if (signal?.aborted) throw new NaiError("已取消连接测试。", 0);
    if (timeout.aborted) {
      throw new NaiError("连接测试超时：服务器无响应（网络可能不稳定）。", 0);
    }
    throw new NaiError("网络错误：连不上 NovelAI。请确认网络/代理已开启。", 0);
  }
}

const TIER_NAMES: Record<number, string> = { 0: "Paper", 1: "Tablet", 2: "Scroll", 3: "Opus" };
export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? `未知档位(${tier})`;
}

/** 演示模式：不调真实 API，本地画一张占位图，走完整闭环 */
export async function generateDemoImage(p: GenParams, signal?: AbortSignal): Promise<{ png: Blob; seed: number }> {
  await abortableDelay(1000 + Math.random() * 900, signal);
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext("2d")!;
  const hue = (p.seed ?? 0) % 360;
  const grad = ctx.createLinearGradient(0, 0, p.width, p.height);
  grad.addColorStop(0, `hsl(${hue} 65% 55%)`);
  grad.addColorStop(1, `hsl(${(hue + 140) % 360} 70% 35%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, p.width, p.height);

  // 几片装饰圆斑，让每张演示图不完全一样
  let s = p.seed ?? 1;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(rand() * p.width, rand() * p.height, 30 + rand() * 120, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${(hue + rand() * 80) % 360} 80% 70% / 0.25)`;
    ctx.fill();
  }

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, p.height / 2 - 74, p.width, 148);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textAlign = "center";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText("演示模式", p.width / 2, p.height / 2 - 14);
  ctx.font = "26px sans-serif";
  const text = `seed ${p.seed} · ${p.steps}步 · ${p.width}×${p.height}`;
  ctx.fillText(text, p.width / 2, p.height / 2 + 28);
  ctx.font = "22px sans-serif";
  ctx.fillText(p.prompt.slice(0, 30) || "（空提示词）", p.width / 2, p.height / 2 + 60);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve({ png: b, seed: p.seed ?? 0 }) : reject(new NaiError("演示图生成失败", -1))), "image/png"),
  );
}
