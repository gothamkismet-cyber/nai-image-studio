import { useEffect, useRef, useState } from "react";

export interface UpdateInfo { version: string; available: boolean; installDir: string; mode: "local" }
export type UpdateSelection = { state: "ready"; id: string; version: string; filename: string; sameVersion: boolean };
export type UpdateResult = UpdateSelection | { state: "canceled" | "launching" } | { state: "error"; message: string };
interface Props { open: boolean; onClose: () => void; blockedReason?: string }

export default function UpdateDialog({ open, ...props }: Props) {
  return open ? <UpdateSettings {...props} /> : null;
}
function UpdateSettings({ onClose, blockedReason }: Omit<Props, "open">) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [selection, setSelection] = useState<UpdateSelection | null>(null);
  const [activity, setActivity] = useState<"checking" | "installing" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [launching, setLaunching] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    let active = true;
    window.desktop?.updateInfo?.().then((value) => { if (active) setInfo(value); }).catch(() => { if (active) setError("无法读取当前版本，请关闭后重试。"); });
    return () => { active = false; ++sequence.current; dialog.current?.close(); previous?.focus(); };
  }, []);
  async function choose() {
    if (!window.desktop?.chooseUpdate || activity || launching) return;
    const id = ++sequence.current;
    setActivity("checking"); setError(""); setNotice(""); setSelection(null);
    try {
      const result = await window.desktop.chooseUpdate();
      if (id !== sequence.current) return;
      if (result.state === "ready") setSelection(result);
      else if (result.state === "error") setError(result.message);
      else if (result.state === "canceled") setNotice("已取消选择，当前版本未改变。");
    } catch { if (id === sequence.current) setError("安装包检查失败，请重新选择。"); }
    finally { if (id === sequence.current) setActivity(null); }
  }
  async function install() {
    if (!selection || !window.desktop?.installUpdate || activity || launching || blockedReason) return;
    const id = ++sequence.current;
    setActivity("installing"); setError(""); setNotice("");
    try {
      const result = await window.desktop.installUpdate(selection.id);
      if (id !== sequence.current) return;
      if (result.state === "launching") { setLaunching(true); setNotice("安装程序已打开，生图台即将关闭。请在安装向导中完成覆盖。取消安装后可重新打开原版本。"); }
      else if (result.state === "error") { setError(result.message); setSelection(null); }
      else if (result.state === "canceled") setNotice("已取消更新，当前版本和数据仍保留。");
    } catch { if (id === sequence.current) setError("安装程序未能启动，当前版本仍保留。请重试。"); }
    finally { if (id === sequence.current) setActivity(null); }
  }
  function close() { if (!activity && !launching) onClose(); }
  return <dialog ref={dialog} className="token-dialog update-dialog" aria-labelledby="update-title" onCancel={(e) => { e.preventDefault(); close(); }}>
    <div className="api-settings">
      <div className="api-settings-header"><div><p className="eyebrow">版本与升级</p><h2 id="update-title">软件更新</h2><p className="api-help">选择新版安装包，在原位置覆盖升级，保留已保存的数据。</p></div><button type="button" aria-label="关闭软件更新" className="api-close" disabled={!!activity || launching} onClick={close}>×</button></div>
      <div className="update-body">
        <div className="update-current"><span>当前版本</span><b>{info ? `v${info.version}` : "读取中…"}</b><span className="connection-badge">本地安装包更新</span></div>
        {info?.installDir && <p className="update-path">程序位置：{info.installDir}</p>}
        <p className="api-help">将 NAI生图台-Setup-版本号.exe 和同名 .exe.sha256 校验文件放在一起，再选择安装包。支持新版升级和同版本重装；旧版本会被拦截。</p>
        <button type="button" className="api-secondary update-pick" disabled={!info?.available || !!activity || launching} onClick={choose}>{activity === "checking" ? "正在检查安装包…" : "选择新版安装包"}</button>
        {info && !info.available && <p className="personal-message" role="status">本地覆盖更新只用于 Windows 安装版；源码或便携版请直接运行新版安装包。</p>}
        {selection && <div className="update-selection"><span>安装包检查通过</span><h3>v{selection.version}{selection.sameVersion ? " · 同版本重装" : " · 可覆盖升级"}</h3><p>{selection.filename}</p><small>完整性校验和产品版本一致；仍需使用你信任的安装包。</small></div>}
        {blockedReason && <p className="api-message warning" role="status">{blockedReason}</p>}
        {error && <p className="api-message error" role="alert">{error}</p>}
        <p className="update-notice" role="status">{notice}</p>
        <p className="api-storage-note">目前通过本地安装包更新，不会联网检查或自动下载。开始安装前会再次确认并关闭生图台；提示词草稿请先保存。安装中不要关闭安装程序。</p>
      </div>
      <div className="api-settings-footer"><span>更新保留配置、收藏和历史。</span><div><button type="button" className="subtle-button" disabled={!!activity || launching} onClick={close}>关闭</button><button type="button" className="api-primary" disabled={!selection || !!activity || launching || !!blockedReason} onClick={install}>{launching ? "正在打开安装…" : activity === "installing" ? "正在准备安装…" : selection?.sameVersion ? "覆盖重新安装" : "开始覆盖更新"}</button></div></div>
    </div>
  </dialog>;
}
