import { useEffect, useRef, useState } from "react";

export interface UpdateInfo { version: string; available: boolean; installDir: string; mode: "local" }
export type UpdateSelection = { state: "ready"; id: string; version: string; filename: string; sameVersion: boolean };
export type UpdateResult = UpdateSelection | { state: "canceled" | "launching" } | { state: "error"; message: string };
export type ReleaseCheck = { state: "ready"; latestVersion: string; newer: boolean; url: string; notes: string; publishedAt: string; installerAvailable: boolean | null; source: "api" | "page" }
  | { state: "error"; message: string };
interface Props { open: boolean; onClose: () => void; blockedReason?: string }

export default function UpdateDialog({ open, ...props }: Props) {
  return open ? <UpdateSettings {...props} /> : null;
}
function UpdateSettings({ onClose, blockedReason }: Omit<Props, "open">) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [selection, setSelection] = useState<UpdateSelection | null>(null);
  const [activity, setActivity] = useState<"checking" | "installing" | "online" | null>(null);
  const [release, setRelease] = useState<Extract<ReleaseCheck, { state: "ready" }> | null>(null);
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
  async function checkOnline() {
    if (!window.desktop?.checkLatestRelease || activity || launching) return;
    const id = ++sequence.current;
    setActivity("online"); setError(""); setNotice(""); setRelease(null);
    try {
      const result = await window.desktop.checkLatestRelease();
      if (id !== sequence.current) return;
      if (result.state === "ready") setRelease(result); else setError(result.message);
    } catch { if (id === sequence.current) setError("检查新版失败，请检查网络后重试。"); }
    finally { if (id === sequence.current) setActivity(null); }
  }
  async function openDownloads() {
    try {
      const result = await window.desktop?.openReleases?.();
      if (!result?.ok) setError(result?.message ?? "下载页无法打开，请手动访问 GitHub 仓库。");
    } catch { setError("下载页无法打开，请手动访问 GitHub 仓库。"); }
  }
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
        <div className="update-current"><span>当前版本</span><b>{info ? `v${info.version}` : "读取中…"}</b><span className="connection-badge">GitHub 正式版</span></div>
        <div className="update-online-actions"><button type="button" className="api-secondary" disabled={!info || !!activity || launching} onClick={checkOnline}>{activity === "online" ? "正在检查新版…" : "检查新版"}</button><button type="button" className="subtle-button" disabled={!!activity || launching} onClick={openDownloads}>打开下载页</button></div>
        {release && <div className="update-release" role="status"><h3>{release.newer ? `发现新版 v${release.latestVersion}` : `当前已是最新版，或高于正式版 v${release.latestVersion}`}</h3>
          <p>{release.publishedAt ? `发布时间：${release.publishedAt.slice(0, 10)}。` : ""}{release.installerAvailable === null ? "已从 GitHub 下载页读取版本；更新内容与安装包请到下载页查看。" : release.installerAvailable ? "下载页提供安装包和校验文件。" : "尚未检测到配套 Windows 安装包，请到下载页核对。"}</p>
          {release.notes && <details><summary>查看更新内容</summary><pre>{release.notes}</pre></details>}
        </div>}
        {info?.installDir && <p className="update-path">程序位置：{info.installDir}</p>}
        <p className="api-help">将 NAI-Image-Studio-Setup-版本号.exe 和同名 .exe.sha256 校验文件下载到一起，再选择安装包。也兼容旧中文文件名。支持新版升级和同版本重装；旧版本会被拦截。</p>
        <button type="button" className="api-secondary update-pick" disabled={!info?.available || !!activity || launching} onClick={choose}>{activity === "checking" ? "正在检查安装包…" : "选择新版安装包"}</button>
        {info && !info.available && <p className="personal-message" role="status">本地覆盖更新只用于 Windows 安装版；源码或便携版请直接运行新版安装包。</p>}
        {selection && <div className="update-selection"><span>安装包检查通过</span><h3>v{selection.version}{selection.sameVersion ? " · 同版本重装" : " · 可覆盖升级"}</h3><p>{selection.filename}</p><small>完整性校验和产品版本一致；仍需使用你信任的安装包。</small></div>}
        {blockedReason && <p className="api-message warning" role="status">{blockedReason}</p>}
        {error && <p className="api-message error" role="alert">{error}</p>}
        <p className="update-notice" role="status">{notice}</p>
        <p className="api-storage-note">点击“检查新版”时查询本软件的 GitHub 正式发布，不发送 Token、提示词或图片。下载后通过本地安装包覆盖升级；开始安装前会再次确认并关闭生图台，提示词草稿请先保存。</p>
      </div>
      <div className="api-settings-footer"><span>更新保留配置、收藏和历史。</span><div><button type="button" className="subtle-button" disabled={!!activity || launching} onClick={close}>关闭</button><button type="button" className="api-primary" disabled={!selection || !!activity || launching || !!blockedReason} onClick={install}>{launching ? "正在打开安装…" : activity === "installing" ? "正在准备安装…" : selection?.sameVersion ? "覆盖重新安装" : "开始覆盖更新"}</button></div></div>
    </div>
  </dialog>;
}
