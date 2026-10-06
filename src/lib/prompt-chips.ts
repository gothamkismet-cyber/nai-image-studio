import { normalizePromptChips, type PromptChip } from "../types";

/** 普通文字编辑只移动未触碰的标签；改到标签内部时自动展开该标签。 */
export function rebasePromptChips(before: string, after: string, chips: PromptChip[]): PromptChip[] {
  const valid = normalizePromptChips(before, chips);
  if (before === after) return valid;
  let start = 0, suffix = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const oldEnd = before.length - suffix, shift = after.length - before.length;
  return valid.flatMap(c => c.end <= start ? [c] : c.start >= oldEnd ? [{ ...c, start: c.start + shift, end: c.end + shift }] : []);
}

export function replacePromptRange(value: string, chips: PromptChip[], start: number, end: number, text: string): { value: string; chips: PromptChip[] } {
  const shift = text.length - (end - start);
  return { value: value.slice(0, start) + text + value.slice(end), chips: chips.flatMap(c => c.end <= start ? [c]
    : c.start >= end ? [{ ...c, start: c.start + shift, end: c.end + shift }] : []) };
}

export function removePromptChip(value: string, chips: PromptChip[], id: string): { value: string; chips: PromptChip[] } {
  const chip = chips.find(c => c.id === id);
  if (!chip) return { value, chips };
  let { start, end } = chip;
  // 一并去掉相邻的一个逗号分隔符；不吞掉其他文本或相邻标签的内容。
  const previousEnd = chips.filter(c => c.end <= start).at(-1)?.end ?? 0;
  const nextStart = chips.find(c => c.start >= end)?.start ?? value.length;
  const left = value.slice(previousEnd, start).match(/,\s*$/);
  const right = value.slice(end, nextStart).match(/^\s*,\s*/);
  if (left) start -= left[0].length;
  else if (right) end += right[0].length;
  return replacePromptRange(value, chips.filter(c => c.id !== id), start, end, "");
}

/** 保留旧追加规则的完整文本，同时记录名称在文本中的准确位置。 */
export function insertedPromptChips(existing: string, raw: PromptChip[] | undefined, value: string, mode: "append" | "replace", name?: string): PromptChip[] {
  const leading = existing.length - existing.trimStart().length;
  const prefix = existing.trim().replace(/,\s*$/, "");
  // 旧追加规则会裁去首尾空白和末尾的一个逗号，标签也同步收缩到保留的文本。
  const chips = mode === "append" ? normalizePromptChips(existing, raw).filter(c => c.end > leading && c.start < leading + prefix.length)
    .map(c => {
      const start = Math.max(0, c.start - leading), end = Math.min(prefix.length, c.end - leading);
      return { ...c, start, end, text: prefix.slice(start, end) };
    }) : [];
  if (name?.trim() && (mode === "replace" || value !== existing)) {
    const offset = mode === "append" && existing.trim() ? prefix.length + 2 : 0;
    // 收藏自带的标点也属于它；删除时不能把这些逗号遗留在框里。
    if (value.length > offset) chips.push({ id: crypto.randomUUID(), name: name.trim().slice(0, 80), start: offset, end: value.length, text: value.slice(offset) });
  }
  return normalizePromptChips(value, chips);
}
