// 真实 Electron 窗口验收：独立数据目录，仅演示生成，禁止外部网络请求。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const evidence = process.env.NAI_VERIFY_EVIDENCE ? path.resolve(process.env.NAI_VERIFY_EVIDENCE) : path.resolve(__dirname, '../.tavernweave/evidence/ui-library');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'test-profile-')));
delete process.env.NAI_SELFTEST;
delete process.env.VITE_DEV_SERVER_URL;
const windowReady = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
// 打包检查可从成品 ASAR 加载主进程与界面；默认仍验证源码构建。
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
(async () => {
  const win = await windowReady;
  const capture = async name => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const bitmap = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(path.join(evidence, name), bitmap.toPNG());
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  };
  const results = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const wait = async (fn, label) => { for (let i=0;i<100;i++) { if (fn()) return; await sleep(100); } throw new Error('Timeout: '+label); };
    const out = {};
    const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
    const input = label => document.querySelector('[aria-label="'+label+'"]');
    const fill = (el, value) => { const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value); el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true})); };
    await wait(()=>document.querySelector('.count-badge') && document.body.textContent.includes('22,956'), 'library ready');
    const raw = await window.desktop.loadPromptLib();
    out.entries = raw.data.entries.length; out.categories = raw.data.cats.length;
    out.libraryReady = raw.state === 'ready';
    out.adultDefaultHidden = !input('搜索提示词库').closest('section').querySelector('input[type="checkbox"]').checked;
    out.pageInitial = document.querySelectorAll('.library-card').length;
    button('再显示 60 条').click(); await sleep(100);
    out.pageMore = document.querySelectorAll('.library-card').length;
    fill(input('搜索提示词库'), '银发'); await sleep(250);
    out.searchCount = document.querySelectorAll('.library-card').length;
    const entry = document.querySelector('.library-card h3').textContent;
    button('＋ 追加').click(); await sleep(100);
    out.mainInsert = input('提示词（想画什么）').value === entry;
    fill(input('词库插入目标'), JSON.stringify({kind:'negative'})); await sleep(100);
    button('＋ 追加').click(); await sleep(100);
    out.negativeInsert = input('负面提示词').value === entry;
    button('＋ 角色').click(); await sleep(100);
    const targets = [...input('词库插入目标').options];
    const charTarget = targets.find(o=>o.textContent.includes('角色 1 · 提示词')).value;
    fill(input('词库插入目标'), charTarget); await sleep(100);
    button('＋ 追加').click(); await sleep(100);
    out.characterInsert = input('角色 1 提示词').value === entry;
    button('删除').click(); await sleep(100);
    out.removedTargetFallback = input('词库插入目标').value === JSON.stringify({kind:'main'});
    button('配方').click(); fill(input('搜索提示词库'), ''); await sleep(200);
    fill(input('词库分类'), 'template'); await sleep(100);
    out.recipeCategory = [...document.querySelectorAll('.library-card .entry-kind')].every(e=>e.textContent==='成品配方') && document.querySelectorAll('.library-card').length > 0;
    fill(input('提示词（想画什么）'), ''); await sleep(100);
    const savedConfirm = window.confirm;
    fill(input('提示词（想画什么）'), '保留草稿'); await sleep(100);
    window.confirm = () => false; button('载入').click(); await sleep(100);
    out.replaceCancel = input('提示词（想画什么）').value === '保留草稿';
    window.confirm = () => true; button('载入').click(); await sleep(100); window.confirm = savedConfirm;
    out.recipeLoad = input('提示词（想画什么）').value.length > 0;
    const tokenTrigger = document.querySelector('[aria-label="API 配置"]'); tokenTrigger.focus(); tokenTrigger.click(); await sleep(100);
    out.dialogFocus = document.activeElement === input('NovelAI API Token');
    document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})); await sleep(100);
    out.dialogClosed = !document.querySelector('dialog');
    out.dialogFocusReturn = document.activeElement === tokenTrigger;
    const demo = [...document.querySelectorAll('input[type="checkbox"]')].find(e=>e.closest('label')?.textContent.includes('演示模式'));
    demo.click(); await sleep(100);
    button('生成').click(); await sleep(100); button('取消生成').click(); await sleep(150);
    out.cancel = document.body.textContent.includes('已取消本次生成');
    button('生成').click(); await wait(()=>!!button('下载 PNG'),'demo image');
    await wait(()=>!!document.querySelector('img[alt="历史图片"]'),'history saved');
    out.demo = !!button('下载 PNG') && document.body.textContent.includes('演示图');
    out.history = document.querySelectorAll('img').length >= 2;
    return out;
  })()`);
  console.log('[STUDIO_STEPS]', JSON.stringify(results));
  for (const [key, value] of Object.entries(results)) {
    if (!['entries','categories','pageInitial','pageMore','searchCount'].includes(key)) assert.equal(value, true, key);
  }
  assert.equal(results.entries,22956); assert.equal(results.categories,137);
  assert.equal(results.pageInitial,60); assert.equal(results.pageMore,120); assert.ok(results.searchCount > 0);
  // 保留用于视觉核对的场景：词条搜索 + 已生成的演示图。
  await win.webContents.executeJavaScript(`(async()=>{const buttons=[...document.querySelectorAll('button')];buttons.find(b=>b.textContent.trim()==='全部').click();const i=document.querySelector('[aria-label="搜索提示词库"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'银发');i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,200));})()`);
  await capture('studio-desktop.png');
  // 重启页面后，参数与历史必须仍在。
  const reloaded = new Promise(resolve=>win.webContents.once('did-finish-load',resolve)); win.reload(); await reloaded;
  await new Promise(r=>setTimeout(r,600));
  const persisted = await win.webContents.executeJavaScript(`document.querySelector('[aria-label="提示词（想画什么）"]').value.length > 0 && document.querySelectorAll('img').length > 0`);
  assert.equal(persisted,true,'persisted params and history'); results.persisted = persisted;
  win.setMinimumSize(320,480); win.setSize(390,844);
  await win.webContents.executeJavaScript(`document.querySelector('.workspace-tabs button:last-child').click()`);
  await new Promise(r=>setTimeout(r,150));
  const layout = await win.webContents.executeJavaScript(`({width:innerWidth,scroll:document.documentElement.scrollWidth,preview:document.querySelector('.checkerboard').getBoundingClientRect().height,result:getComputedStyle(document.querySelector('.result-pane')).display,editor:getComputedStyle(document.querySelector('.editor-pane')).display})`);
  await win.webContents.executeJavaScript(`document.querySelector('img')?.closest('button')?.click()`);
  await new Promise(r=>setTimeout(r,150));
  assert.ok(layout.scroll <= layout.width + 1,'mobile overflow'); assert.ok(layout.preview > 300,'mobile preview'); assert.equal(layout.editor,'none');
  results.mobile = layout;
  await capture('studio-mobile.png');
  results.pass = true;
  fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(results,null,2));
  console.log('[STUDIO_VERIFY]',JSON.stringify(results));
  app.quit();
})().catch(error=>{ console.error(error); app.exit(1); });
