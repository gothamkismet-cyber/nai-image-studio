// 旧词库使用 JS。只在无同源权限的 iframe 内创建 Worker 执行，主页面只收纯数据。
function libraryWorker() {
  const send = self.postMessage.bind(self);
  const stringify = JSON.stringify.bind(JSON);
  self.onmessage = ({ data: codes }) => {
    const fakeWindow = {};
    const failedFiles = [];
    try {
      for (const { name, code } of codes) {
        try { new Function("window", code)(fakeWindow); }
        catch { failedFiles.push(name); }
      }
      const data = fakeWindow.NAI_DATA;
      const imported = fakeWindow.NAI_IMPORTED;
      if (data && imported) {
        const normalize = s => s.toLowerCase().replace(/_/g, " ").trim();
        const have = new Set(data.cats.map(c => c.id));
        for (const c of imported.cats ?? []) if (!have.has(c.id)) { data.cats.push(c); have.add(c.id); }
        for (const [id, items] of Object.entries(imported.tags ?? {})) {
          const current = data.tags[id] ?? (data.tags[id] = []);
          const seen = new Set(current.map(row => normalize(row[0])));
          for (const row of items) if (!seen.has(normalize(row[0]))) { current.push(row); seen.add(normalize(row[0])); }
        }
      }
      send({ json: stringify({ data, failedFiles }) });
    } catch { send({ error: "词库数据格式不正确，原文件未改动。" }); }
  };
}

const workerSource = `(${libraryWorker.toString()})()`;
// Blob Worker 继承此 CSP；无网络、无同源存储、无 Node、无桌面桥接。
export const libraryFrameHtml = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none';"><script>
onmessage = e => {
  if (e.source !== parent || !e.ports[0]) return;
  onmessage = null;
  const port = e.ports[0];
  const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSource).replace(/</g, "\\u003c")}], {type:'text/javascript'}));
  const worker = new Worker(url);
  const finish = result => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); port.postMessage(result); port.close(); };
  const timer = setTimeout(() => finish({error:'词库读取超时，已停止脚本。请检查数据文件。'}), 7000);
  worker.onmessage = event => finish(event.data);
  worker.onerror = () => finish({error:'词库脚本无法读取，请检查数据文件。'});
  worker.postMessage(e.data);
};</script>`;

export function runLibrarySandbox(codes, frameHtml, timeoutMs = 9000) {
  if (!Array.isArray(codes) || codes.length > 64 || codes.some(c => typeof c.name !== "string" || typeof c.code !== "string") || codes.reduce((n, c) => n + c.code.length, 0) > 32 * 1024 * 1024) {
    return Promise.reject(new Error("词库超过读取上限（64 个文件 / 32 MiB 文本）。"));
  }
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.title = "词库数据读取";
    const channel = new MessageChannel();
    const finish = (error, value) => {
      clearTimeout(timer);
      channel.port1.close(); channel.port2.close(); frame.remove();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("词库读取超时，已停止脚本。")), timeoutMs);
    channel.port1.onmessage = ({ data: result }) => {
      try {
        if (typeof result?.error === "string") throw new Error(result.error);
        if (typeof result?.json !== "string" || result.json.length > 64 * 1024 * 1024) throw new Error("词库返回的数据无效或过大。");
        const value = JSON.parse(result.json);
        const d = value.data;
        if (!d || !Array.isArray(d.cats) || !d.cats.every(c => c && typeof c.id === "string" && typeof c.name === "string")) throw new Error("词库缺少有效分类数据。");
        for (const [field, rowsAreArrays] of [["tags", true], ["info", false]]) {
          const groups = d[field] ?? {};
          if (!groups || typeof groups !== "object" || Array.isArray(groups)) throw new Error("词库分类内容格式不正确。");
          for (const rows of Object.values(groups)) {
            if (!Array.isArray(rows) || !rows.every(row => rowsAreArrays
              ? Array.isArray(row) && row.slice(0, 3).every(s => s == null || typeof s === "string")
              : row && typeof row === "object" && ["t", "s", "b", "badge"].every(k => row[k] == null || typeof row[k] === "string"))) throw new Error("词库条目格式不正确。");
          }
        }
        if (!Array.isArray(value.failedFiles) || !value.failedFiles.every(f => typeof f === "string")) throw new Error("词库读取结果不正确。");
        finish(null, value);
      } catch (error) { finish(error); }
    };
    frame.onload = () => frame.contentWindow?.postMessage(codes, "*", [channel.port2]);
    frame.srcdoc = frameHtml;
    document.body.append(frame);
  });
}
