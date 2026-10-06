// 故障回归使用独立数据目录、合成数据与被禁止的外网，不接触用户存档。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const evidence = path.resolve(process.env.NAI_VERIFY_EVIDENCE || '.tavernweave/evidence/quality-ui/quality');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'test-profile-')));
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
const ready = new Promise(resolve => app.once('browser-window-created', (_e, win) => {
  win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
function loadTs(file, names, context = {}) {
  const mod = { exports: {} };
  const source = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'transform' }).replace('import JSZip from "jszip";', 'const JSZip = require("jszip");').replace(/^export /gm, '');
  vm.runInNewContext(source + '\nmodule.exports = {' + names + '};', { module: mod, setTimeout, clearTimeout, ...context });
  return mod.exports;
}
async function historyCheck(file, abort) {
  let tx, request;
  const db = { close() {}, transaction() {
    tx = { objectStore: () => ({ put: () => (request = {}) }) };
    return tx;
  } };
  const indexedDB = { open() {
    const req = { result: db };
    queueMicrotask(() => req.onsuccess()); return req;
  } };
  const api = loadTs(file, 'addHistory', { indexedDB });
  let state = 'pending';
  const job = api.addHistory({ id: 'synthetic' }).then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
  await new Promise(r => setTimeout(r, 0));
  request.result = 'synthetic'; request.onsuccess();
  await new Promise(r => setTimeout(r, 0));
  const beforeCommit = state;
  if (abort) { tx.error = new Error('synthetic rollback'); tx.onabort(); } else tx.oncomplete();
  await job;
  return { beforeCommit, final: state };
}
(async () => {
  const out = {};
  const old = '.tavernweave/backups/2026-10-04-quality-ui/source/src/lib/history.ts';
  out.oldHistoryBug = await historyCheck(old, true);
  assert.equal(out.oldHistoryBug.final, 'resolved', '旧版会误报回滚事务成功');
  out.historyAbort = await historyCheck('src/lib/history.ts', true);
  assert.deepEqual(out.historyAbort, { beforeCommit: 'pending', final: 'rejected' });
  out.historyCommit = await historyCheck('src/lib/history.ts', false);
  assert.deepEqual(out.historyCommit, { beforeCommit: 'pending', final: 'resolved' });
  const { normalizeParams, DEFAULT_PARAMS } = loadTs('src/types.ts', 'normalizeParams,DEFAULT_PARAMS');
  const normalize = value => JSON.parse(JSON.stringify(normalizeParams(value)));
  assert.deepEqual(normalize(null), JSON.parse(JSON.stringify(DEFAULT_PARAMS)));
  const bad = normalize({ model: null, prompt: 9, negativePrompt: [], width: -4, height: 'bad', steps: 900, scale: NaN, cfgRescale: -1, seed: Infinity, sampler: {}, characters: [{ id: 'same' }, { id: 'same' }] });
  assert.equal(bad.model, DEFAULT_PARAMS.model); assert.equal(bad.prompt, '');
  assert.equal(bad.width, 64); assert.equal(bad.height, 1216); assert.equal(bad.steps, 50);
  assert.equal(bad.scale, 5); assert.equal(bad.cfgRescale, 0); assert.equal(bad.seed, null);
  assert.notEqual(bad.characters[0].id, bad.characters[1].id);
  const originalText = '  1.5::artist: example::\n[blue sky], Text: Hello  ';
  assert.equal(normalize({ prompt: originalText }).prompt, originalText);
  out.parameterValidation = true;
  async function responseCancel(file) {
    const controller = new AbortController();
    const fetch = async url => String(url).startsWith('data:') ? { blob: async () => new Blob(['fixture']) } : {
      ok: true, headers: { get: () => 'application/json' },
      json: async () => { controller.abort(); return { images: [{ image: 'Zml4dHVyZQ==', seed: 1 }] }; },
    };
    const api = loadTs(file, 'generateImage', { require, fetch, AbortSignal, crypto: require('node:crypto').webcrypto });
    return api.generateImage('synthetic', DEFAULT_PARAMS, controller.signal);
  }
  await responseCancel('.tavernweave/backups/2026-10-04-quality-ui/source/src/lib/nai.ts');
  await assert.rejects(responseCancel('src/lib/nai.ts'), /已取消/);
  out.cancelDuringResponse = true;
  const win = await ready;
  const run = code => win.webContents.executeJavaScript(code);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (code, label) => { for (let i = 0; i < 120; i++) { if (await run(code)) return; await sleep(100); } throw Error('Timeout: ' + label); };
  await wait("document.body.textContent.includes('22,956')", 'library');
  await run("localStorage.setItem('nai_token','synthetic-no-real-token'); localStorage.setItem('nai_params_v1',JSON.stringify({model:null,prompt:42,negativePrompt:[],steps:999,characters:[null]}));");
  const reload = new Promise(r => win.webContents.once('did-finish-load', r)); win.reload(); await reload;
  await wait("!!document.querySelector('[aria-label=\"提示词（想画什么）\"]')", 'bad storage recovery');
  out.badStorageUI = await run("document.querySelector('[aria-label=\"提示词（想画什么）\"]').value === '' && JSON.parse(localStorage.getItem('nai_params_v1')).steps === 50");
  assert.equal(out.badStorageUI, true);
  await run(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k==='nai_params_v1'||k==='nai_demo') throw new DOMException('synthetic full','QuotaExceededError'); return window.originalSetItem.call(this,k,v); };
    const input=document.querySelector('[aria-label="提示词（想画什么）"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'storage failure keeps this draft'); input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait("document.body.textContent.includes('草稿暂时无法保存')", 'save warning');
  out.storageFailureKeepsEditor = await run("document.querySelector('[aria-label=\"提示词（想画什么）\"]').value === 'storage failure keeps this draft'");
  await run("[...document.querySelectorAll('input[type=checkbox]')].find(el=>el.closest('label')?.textContent.includes('演示模式')).click()");
  await wait("document.body.textContent.includes('偏好没有保存')", 'demo warning');
  assert.equal(out.storageFailureKeepsEditor, true);
  out.demoFailureVisible = true;
  await run('Storage.prototype.setItem=window.originalSetItem; void 0;');
  const { libraryFrameHtml, runLibrarySandbox } = await import('../electron/library-runtime.mjs');
  const sandbox = (codes, timeout) => run('(' + runLibrarySandbox.toString() + ')(' + JSON.stringify(codes) + ',' + JSON.stringify(libraryFrameHtml) + ',' + (timeout || 9000) + ')');
  const base = { name: 'data.js', code: 'window.NAI_DATA={cats:[{id:"test",name:"Test"}],tags:{test:[["hello","你好"]]},info:{}};' };
  const probes = { name: 'data-probe.js', code: `
    const g=Function('return this')();
    let storageBlocked=false, networkBlocked=false;
    try { indexedDB.open('nai-image-studio'); } catch { storageBlocked=true; }
    try { const xhr=new XMLHttpRequest(); xhr.open('GET','https://example.invalid/nai-sandbox-test',false); xhr.send(); } catch { networkBlocked=true; }
    window.NAI_DATA.tags.test.push([JSON.stringify({node:typeof g.process,require:typeof g.require,document:typeof g.document,localStorage:typeof g.localStorage,desktop:typeof g.desktop,storageBlocked,networkBlocked}),"probe"]);` };
  const tested = await sandbox([base, probes]);
  const probe = JSON.parse(tested.data.tags.test[1][0]);
  assert.deepEqual(probe, { node: 'undefined', require: 'undefined', document: 'undefined', localStorage: 'undefined', desktop: 'undefined', storageBlocked: true, networkBlocked: true });
  out.libraryIsolation = probe;
  assert.equal(await run("localStorage.getItem('nai_token') === 'synthetic-no-real-token'"), true);
  const partial = await sandbox([base, { name: 'data-bad.js', code: 'throw Error("fixture")' }]);
  assert.deepEqual(partial.failedFiles, ['data-bad.js']); out.partialLibraryVisible = true;
  await assert.rejects(sandbox([{ name: 'data.js', code: 'window.NAI_DATA={cats:[],tags:{x:42}}' }]));
  await run('window.sandboxTick=false; setTimeout(()=>{window.sandboxTick=true},80);');
  await assert.rejects(sandbox([{ name: 'data.js', code: 'while(true){}' }]), /超时/);
  out.infiniteLoopStopped = await run('window.sandboxTick === true && document.querySelectorAll("iframe").length === 0');
  assert.equal(out.infiniteLoopStopped, true);
  // 真实桌面导入分支也必须只能返回数据，不能让脚本接触主进程。
  const fixture = fs.mkdtempSync(path.join(evidence, 'library-fixture-'));
  fs.writeFileSync(path.join(fixture, 'data.js'), base.code + probes.code);
  fs.writeFileSync(path.join(app.getPath('userData'), 'config.json'), JSON.stringify({ promptLibDir: fixture }));
  const desktop = await run('window.desktop.loadPromptLib()');
  assert.equal(desktop.state, 'ready');
  assert.deepEqual(JSON.parse(desktop.data.entries[1].en), probe);
  out.desktopLibraryIsolation = true;
  fs.writeFileSync(path.join(app.getPath('userData'), 'config.json'), JSON.stringify({ promptLibDir: 'D:/nai提示词' }));
  // 不同大小下检查主要区域、控件和表单是否仍可访问。
  out.layouts = [];
  for (const [width, height, zoom] of [[1440,900,1],[1024,768,1],[390,844,1],[1440,900,2]]) {
    // Windows 隐藏窗口连续 setSize 偶尔保留旧尺寸；各场景独立启动并断言实际视口。
    const layoutWin = new BrowserWindow({ show:false,width,height,minWidth:320,minHeight:360,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
    await layoutWin.loadFile(path.resolve('dist/index.html')); layoutWin.webContents.setZoomFactor(zoom);
    let observation;
    for (let attempt=0;attempt<50;attempt++) {
      observation = await layoutWin.webContents.executeJavaScript(`({width:innerWidth,scroll:document.documentElement.scrollWidth,footer:document.querySelector('.generate-footer')?.getBoundingClientRect().height})`);
      if (observation.footer && observation.width <= width / zoom + 2 && observation.width >= (width - 40) / zoom) break;
      await sleep(100);
    }
    assert.ok(observation.width <= width / zoom + 2 && observation.width >= (width - 40) / zoom, 'actual viewport width');
    assert.ok(observation.scroll <= observation.width + 1, 'horizontal overflow');
    out.layouts.push({ requestedWidth:width,height,zoom,...observation });
    fs.writeFileSync(path.join(evidence,`layout-${width}-${zoom}.png`),(await layoutWin.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    layoutWin.destroy();
  }
  out.pass = true;
  fs.writeFileSync(path.join(evidence,'verification.json'), JSON.stringify(out,null,2));
  console.log('[QUALITY_VERIFY]',JSON.stringify(out));
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
