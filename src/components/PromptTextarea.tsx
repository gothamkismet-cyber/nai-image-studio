import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type TextareaHTMLAttributes } from "react";
import { highlightPrompt, MAX_HIGHLIGHT_LENGTH } from "../lib/promptHighlight";

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> {
  value: string;
  colors: boolean;
  artists: ReadonlySet<string>;
  model: string;
}

/** 原生 textarea 负责输入/选区/撤销；下方的不可交互文本层仅负责着色。 */
export default function PromptTextarea({ value, colors, artists, model, className = "", onScroll, onCompositionStart, onCompositionEnd, ...props }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const measureInput = useRef<() => void>(() => {});
  const [metrics, setMetrics] = useState<CSSProperties>({});
  const [composing, setComposing] = useState(false);
  const tooLong = value.length > MAX_HIGHLIGHT_LENGTH;
  const active = colors && !composing && !tooLong && value.length > 0;
  const parsed = useMemo(() => colors && !tooLong ? highlightPrompt(value, artists, model) : { tokens: [], warnings: [] }, [value, colors, artists, model, tooLong]);
  const syncScroll = () => {
    if (input.current && content.current) content.current.style.transform = `translate(${-input.current.scrollLeft}px, ${-input.current.scrollTop}px)`;
  };
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setMetrics({ left: el.offsetLeft + parseFloat(cs.borderLeftWidth), top: el.offsetTop + parseFloat(cs.borderTopWidth), width: el.clientWidth, height: el.clientHeight,
        padding: cs.padding, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign as CSSProperties["textAlign"], tabSize: cs.tabSize });
      syncScroll();
    };
    let frame = 0;
    const refresh = () => {
      measure();
      cancelAnimationFrame(frame);
      // 窄屏重排时滚动条可能晚一帧消失，随后再读实际输入宽度。
      frame = requestAnimationFrame(measure);
    };
    measureInput.current = refresh;
    refresh();
    const observer = new ResizeObserver(refresh); observer.observe(el);
    window.addEventListener("resize", refresh);
    return () => { observer.disconnect(); window.removeEventListener("resize", refresh); cancelAnimationFrame(frame); };
  }, [className]);
  // 文本增减会改变滚动条占用宽度，外框不变时 ResizeObserver 可能不会通知。
  useLayoutEffect(() => { measureInput.current(); }, [value, active]);
  useLayoutEffect(syncScroll, [value, active, metrics]);
  useEffect(() => { if (props.disabled) setComposing(false); }, [props.disabled]);

  return <>
    <div className={`prompt-textarea ${active ? "is-highlighted" : ""} ${props.disabled ? "is-disabled" : ""}`}>
      <div aria-hidden="true" className="prompt-textarea-mirror" style={metrics}>
        <div ref={content} className="prompt-textarea-content">{parsed.tokens.map((token, i) => <span key={i} className={`prompt-tone-${token.tone} prompt-weight-${token.emphasis}`}>{token.text}</span>)}<span className="prompt-mirror-tail">{"\u200b"}</span></div>
      </div>
      <textarea {...props} ref={input} value={value} className={className} spellCheck={false}
        onScroll={e => { syncScroll(); onScroll?.(e); }}
        onCompositionStart={e => { setComposing(true); onCompositionStart?.(e); }}
        onCompositionEnd={e => { setComposing(false); onCompositionEnd?.(e); }} />
    </div>
    {colors && tooLong && <p className="prompt-color-note">提示词很长，已暂停着色以保持输入流畅；内容完整保留。</p>}
    {colors && parsed.warnings.map(note => <p className="prompt-color-note" key={note}>{note}</p>)}
  </>;
}
