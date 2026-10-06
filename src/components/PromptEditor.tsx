import { Fragment, useEffect, useId, useMemo, useRef, useState, type ComponentProps } from "react";
import { normalizePromptChips, type PromptChip } from "../types";
import { rebasePromptChips, removePromptChip, replacePromptRange } from "../lib/prompt-chips";
import PromptTextarea from "./PromptTextarea";

type Props = Omit<ComponentProps<typeof PromptTextarea>, "onChange"> & {
  chips?: PromptChip[];
  onValueChange: (value: string, chips: PromptChip[]) => void;
};

/** 收藏折叠为名称；普通文字仍由原生 textarea 输入，完整字符串始终是生成依据。 */
export default function PromptEditor({ value, chips, onValueChange, ...props }: Props) {
  const autoId = useId(), inputId = props.id ?? autoId;
  const section = useRef<HTMLDivElement>(null);
  const [fullText, setFullText] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ before: string; chips: PromptChip[]; after: string; nextChips: PromptChip[] } | null>(null);
  const valid = useMemo(() => normalizePromptChips(value, chips), [value, chips]);
  const selected = valid.find(c => c.id === openId);
  useEffect(() => { if (!valid.length) { setFullText(false); setOpenId(null); } }, [valid.length]);
  const label = props["aria-label"] ?? "提示词";
  const canUndo = undo && undo.after === value && JSON.stringify(undo.nextChips) === JSON.stringify(valid);
  const focusInput = () => requestAnimationFrame(() => {
    (section.current?.querySelector<HTMLTextAreaElement>("textarea") ?? document.getElementById(inputId))?.focus();
  });
  const change = (next: string, nextChips: PromptChip[]) => { setUndo(null); onValueChange(next, nextChips); };
  const remove = (chip: PromptChip) => {
    const next = removePromptChip(value, valid, chip.id);
    setUndo({ before: value, chips: valid, after: next.value, nextChips: next.chips });
    setOpenId(null); onValueChange(next.value, next.chips); focusInput();
  };
  const undoButton = canUndo && <button type="button" className="prompt-chip-undo" disabled={props.disabled}
    aria-label={`撤销删除${label}标签`} onClick={() => { onValueChange(undo.before, undo.chips); setUndo(null); focusInput(); }}>撤销删除</button>;

  // 没有标签时保持原编辑器与原生选区/输入法/撤销行为。
  if (!valid.length) return <><PromptTextarea {...props} id={inputId} value={value}
    onChange={e => change(e.target.value, [])} />{undoButton}</>;

  function textPart(start: number, end: number, key: string, tail = false) {
    const raw = value.slice(start, end), separator = /^[\s,]*$/.test(raw);
    if (!tail && separator) return null;
    const shown = separator ? "" : raw;
    return <div className="prompt-editor-text" key={key}>
      <PromptTextarea {...props} id={tail ? inputId : undefined} value={shown}
        aria-label={tail ? label : `${label}（标签前文字 ${key}）`}
        rows={Math.min(3, Math.max(1, shown.split("\n").length))}
        placeholder={tail ? "继续输入提示词…" : "输入文字…"}
        onChange={e => {
          const nextText = separator && e.target.value ? (raw || (start > 0 ? ", " : "")) + e.target.value : e.target.value;
          const next = replacePromptRange(value, valid, start, end, nextText);
          change(next.value, next.chips);
        }} />
    </div>;
  }

  return <div ref={section} className="prompt-editor" aria-label={`${label}标签编辑器`}>
    {fullText ? <PromptTextarea {...props} id={inputId} value={value}
      onChange={e => change(e.target.value, rebasePromptChips(value, e.target.value, valid))} /> : (
      <div className={`prompt-editor-surface ${props.disabled ? "is-disabled" : ""}`}>
        {valid.map((chip, index) => <Fragment key={chip.id}>
          {textPart(index ? valid[index - 1].end : 0, chip.start, String(index + 1))}
          <span className="prompt-chip" data-chip-id={chip.id}>
            <button type="button" className="prompt-chip-name" title={chip.name} disabled={props.disabled}
              aria-label={`查看提示词标签：${chip.name}`} aria-expanded={openId === chip.id}
              onClick={() => setOpenId(openId === chip.id ? null : chip.id)}>{chip.name}</button>
            <button type="button" className="prompt-chip-remove" disabled={props.disabled}
              aria-label={`移除提示词标签：${chip.name}`} title="只移除框内这段提示词，保留收藏" onClick={() => remove(chip)}>×</button>
          </span>
        </Fragment>)}
        {textPart(valid.at(-1)!.end, value.length, "tail", true)}
      </div>
    )}
    <div className="prompt-editor-tools"><span>标签按完整内容生成</span>{undoButton}<button type="button" disabled={props.disabled}
      aria-label={`${fullText ? "收起" : "编辑"}${label}全文`} onClick={() => { setFullText(!fullText); setOpenId(null); focusInput(); }}>{fullText ? "收起全文" : "编辑全文"}</button></div>
    {selected && <div className="prompt-chip-details" onKeyDown={e => { if (e.key === "Escape") { setOpenId(null); focusInput(); } }}>
      <div><strong>{selected.name}</strong><button type="button" aria-label={`关闭标签内容：${selected.name}`} onClick={() => { setOpenId(null); focusInput(); }}>×</button></div>
      <pre>{selected.text}</pre>
      <div><span>保留插入时的内容，修改收藏不会影响这里。</span><button type="button" disabled={props.disabled} onClick={() => {
        change(value, valid.filter(c => c.id !== selected.id)); setOpenId(null); focusInput();
      }}>展开为文字</button></div>
    </div>}
  </div>;
}
