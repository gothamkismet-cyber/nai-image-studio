import { useEffect, useRef, useState } from "react";
import { checkToken, tierName, NaiError, normalizeToken, tokenInputError, IMAGE_ENDPOINT, SUBSCRIPTION_ENDPOINT } from "../lib/nai";

interface Props {
  open: boolean;
  token: string;
  onClose: () => void;
  onSave: (token: string) => string | null;
}

export default function TokenDialog({ open, ...props }: Props) {
  // 每次打开重新挂载，草稿和网络结果不跨越不同的配置会话。
  return open ? <TokenSettings {...props} /> : null;
}

function TokenSettings({ token, onClose, onSave }: Omit<Props, "open">) {
  const [value, setValue] = useState(token);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ message: string; active: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const normalized = normalizeToken(value);
  const dirty = normalized !== token;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      ++sequence.current;
      request.current?.abort();
      dialog?.close();
      previous?.focus();
    };
  }, []);

  function cancelTest() {
    ++sequence.current;
    request.current?.abort();
    request.current = null;
    setTesting(false);
  }

  function edit(next: string) {
    cancelTest();
    setValue(next);
    setResult(null);
    setError(null);
    setNotice(null);
  }

  async function test() {
    cancelTest();
    setResult(null);
    setNotice(null);
    const invalid = tokenInputError(normalized);
    setError(invalid);
    if (invalid) return;
    const id = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    try {
      const info = await checkToken(normalized, controller.signal);
      if (sequence.current !== id) return;
      setResult({ active: info.active, message: info.active
        ? "连接成功 · " + tierName(info.tier) + " 订阅有效"
        : "连接成功 · " + tierName(info.tier) + " 订阅当前不活跃，生图可能受限" });
    } catch (e) {
      if (sequence.current !== id) return;
      setError(e instanceof NaiError ? e.message : "连接测试失败，请稍后重试。");
    } finally {
      if (sequence.current === id) {
        request.current = null;
        setTesting(false);
      }
    }
  }

  function save() {
    cancelTest();
    const invalid = tokenInputError(normalized);
    setError(invalid);
    setNotice(null);
    if (invalid) return;
    const failed = onSave(normalized);
    if (failed) { setError(failed); return; }
    setValue(normalized);
    setNotice("配置已保存，下次启动仍可使用。");
  }

  function clear() {
    cancelTest();
    setNotice(null);
    const failed = onSave("");
    setError(failed);
    if (failed) return;
    setValue("");
    setResult(null);
    setNotice("已清除本机保存的 Token。");
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="token-title" aria-describedby="token-description" className="token-dialog" onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="api-settings animate-pop-in">
        <header className="api-settings-header">
          <div><p className="eyebrow">连接设置</p><h2 id="token-title">连接 NovelAI</h2><p id="token-description">填入 API Token（访问凭据），让灵感开始成像。</p></div>
          <button type="button" onClick={onClose} className="api-close" aria-label="关闭 API 配置">×</button>
        </header>
        <div className="api-settings-body">
          <aside className="api-connection-card" aria-label="当前接口">
            <div className="connection-mark" aria-hidden="true">✦</div>
            <span className="connection-badge">官方直连</span>
            <h3>图片服务</h3><p>连接测试与生图使用同一官方服务地址。</p>
            <dl><dt>服务地址</dt><dd>image.novelai.net</dd><dt>连接测试 · GET</dt><dd title={SUBSCRIPTION_ENDPOINT}>/user/subscription</dd><dt>图片生成 · POST</dt><dd title={IMAGE_ENDPOINT}>/ai/generate-image</dd></dl>
            <p className="connection-note">测试只查询订阅信息，不生成图片；测试成功不代表生图额度充足。</p>
          </aside>
          <section className="api-form" aria-label="Token 设置">
            <div className="api-label-row"><label htmlFor="api-token">API Token</label><span className={"draft-badge " + (dirty ? "dirty" : "")}>{dirty ? "有未保存修改" : token ? "已保存 · 本机" : "尚未配置"}</span></div>
            <div className="api-token-field">
              <input id="api-token" aria-label="NovelAI API Token" aria-describedby="token-help" aria-invalid={!!error && !!tokenInputError(normalized)} type={show ? "text" : "password"} value={value} onChange={(e) => edit(e.target.value)} placeholder="粘贴你的 API Token" autoComplete="off" spellCheck={false} />
              <button type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "隐藏" : "显示"}</button>
            </div>
            <p id="token-help" className="api-help">支持直接粘贴 Token，或带 Bearer 前缀的内容。保存时会去掉首尾空白和前缀。</p>
            <div className="api-test-row"><button type="button" className="api-secondary" onClick={testing ? cancelTest : test} disabled={!testing && !normalized}>{testing ? "取消测试" : "测试连接"}</button><span>{testing ? "正在查询订阅，最多等待 10 秒…" : "测试结果只对应当前输入"}</span></div>
            <div className="api-feedback" aria-live="polite" aria-atomic="true">
              {error ? <p role="alert" className="api-message error">{error}</p> : result ? <p className={"api-message " + (result.active ? "success" : "warning")}>{result.message}</p> : <p className="api-message neutral">{token && !dirty ? "凭据已保存，可点「测试连接」检查是否有效。" : "粘贴后可以先测试连接，再保存配置。"}</p>}
              {notice && <p className="api-save-notice">{notice}</p>}
            </div>
            <details className="api-guide"><summary>在哪里获取 Token？</summary><p>登录 novelai.net，打开账户设置（Account Settings），找到 Get Persistent API Token，复制后粘贴到这里。请使用 API Token，无需填写账号密码。</p></details>
            <p className="api-storage-note">Token 沿用本机浏览器存储，未加密。NovelAI 生图与订阅查询发往上述官方接口；图片转提示词使用单独配置的识图 API。请仅加载你信任的词库。</p>
          </section>
        </div>
        <footer className="api-settings-footer"><div><button type="button" className="api-clear" onClick={clear} disabled={!token && !value}>清除</button><span>关闭时放弃未保存的修改</span></div><button type="button" className="api-primary" onClick={save} disabled={!normalized || (!dirty && value === normalized)}>保存配置</button></footer>
      </div>
    </dialog>
  );
}
