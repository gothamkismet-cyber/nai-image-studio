export const PERSONAL_PROMPTS_KEY = "nai_personal_prompts_v1";
export const MAX_PERSONAL_PROMPTS = 2000;
export const MAX_PROMPT_NAME = 80;
export const MAX_PERSONAL_PROMPT_LENGTH = 50_000;

export interface PersonalPrompt { id: string; name: string; prompt: string }
export interface PersonalPromptCollection { items: PersonalPrompt[]; revision: string | null; error: string | null }
type PromptStorage = Pick<Storage, "getItem" | "setItem">;

function validateItems(value: unknown): PersonalPrompt[] {
  if (!Array.isArray(value) || value.length > MAX_PERSONAL_PROMPTS) throw new Error("收藏列表格式或数量不正确。");
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("收藏条目格式不正确。");
    const { id, name, prompt } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || id.length > 100 || ids.has(id)) throw new Error("收藏条目标识不正确或重复。");
    if (typeof name !== "string" || !name.trim() || name.length > MAX_PROMPT_NAME) throw new Error("收藏名称需要 1–80 个字符。");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PERSONAL_PROMPT_LENGTH) throw new Error("提示词内容需要 1–50,000 个字符。");
    ids.add(id);
    return { id, name, prompt };
  });
}

export function loadPersonalPrompts(storage?: PromptStorage): PersonalPromptCollection {
  try {
    const revision = (storage ?? localStorage).getItem(PERSONAL_PROMPTS_KEY);
    if (revision === null) return { items: [], revision, error: null };
    const data: unknown = JSON.parse(revision);
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).version !== 1) throw new Error("收藏版本不支持。");
    return { items: validateItems((data as Record<string, unknown>).items), revision, error: null };
  } catch {
    return { items: [], revision: null, error: "无法读取我的提示词，原有收藏未改动。请重新读取；仍失败时请先保留应用数据，再排查存储问题。" };
  }
}

// 先落盘再更新界面；比较原始快照，避免另一窗口的收藏被旧列表覆盖。
export function savePersonalPrompts(items: PersonalPrompt[], revision: string | null, storage?: PromptStorage): string {
  const validated = validateItems(items);
  const next = JSON.stringify({ version: 1, items: validated });
  try {
    const target = storage ?? localStorage;
    if (target.getItem(PERSONAL_PROMPTS_KEY) !== revision) throw new Error("personal-prompts-conflict");
    target.setItem(PERSONAL_PROMPTS_KEY, next);
    return next;
  } catch (e) {
    if (e instanceof Error && e.message === "personal-prompts-conflict") throw new Error("收藏已在其他窗口更改，请重新读取后再保存。当前草稿会保留。");
    throw new Error("没有保存成功，原有收藏和当前草稿仍保留。请检查本机存储空间或权限后重试。");
  }
}
