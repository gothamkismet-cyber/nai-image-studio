// 独立测试目录、演示图、禁止外网；拦截最终剪贴板写入，不改用户剪贴板。
const { app, clipboard, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const evidence = process.env.NAI_VERIFY_EVIDENCE ? path.resolve(process.env.NAI_VERIFY_EVIDENCE) : path.resolve(__dirname, '../.tavernweave/evidence/image-viewer');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'test-profile-')));
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
let captured, writes = 0, clipboardFail = false, pendingCopy;
clipboard.write = async items => {
  if (clipboardFail) throw Error('synthetic clipboard failure');
  if (pendingCopy) await new Promise(resolve => { pendingCopy = resolve; });
  assert.equal(items.length, 1); assert.deepEqual(items[0].types, ['image/png']);
  captured = Buffer.from(await (await items[0].getType('image/png')).arrayBuffer()); writes++;
};
const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
async function unitChecks() {
  const code = stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname, '../src/lib/imageView.ts'), 'utf8'), { mode: 'transform' }).replace(/^export /gm, '') + '\nmodule.exports={fitImage,boundImage,zoomImage,copyImage};';
  const mod = { exports: {} }; let browserItems, desktopBytes;
  const env = { module: mod, window: {}, navigator: { clipboard: { write: async items => { browserItems = items; } } }, Uint8Array, Error, ClipboardItem: class { constructor(data) { this.data = data; } } };
  vm.runInNewContext(code, env); const m = mod.exports, image = { width: 1000, height: 500 }, area = { width: 532, height: 532 };
  assert.equal(m.fitImage(image, area).scale, .5);
  const v = m.zoomImage({ scale: 1, x: 10, y: 5 }, 2, image, area, { x: 100, y: 50 });
  assert.equal((100 - v.x) / v.scale, 90); assert.equal((50 - v.y) / v.scale, 45);
  assert.equal(m.zoomImage(v, 100, image, area).scale, 8);
  assert.equal(m.zoomImage(v, .0001, image, area).scale, .01);
  const small = m.boundImage({ scale: .1, x: 9000, y: -9000 }, image, area);
  assert.equal(Math.abs(small.x), 0); assert.equal(Math.abs(small.y), 0);
  const bound = m.boundImage({ scale: 2, x: 9999, y: -9999 }, image, area);
  assert.equal(bound.x, 750); assert.equal(bound.y, -250);
  const blob = new Blob(['synthetic bytes'], { type: 'image/png' });
  await m.copyImage(blob); assert.equal(browserItems[0].data['image/png'], blob);
  env.navigator.clipboard.write = async () => { throw Error('denied'); };
  await assert.rejects(() => m.copyImage(blob), /剪贴板权限/);
  env.navigator.clipboard = undefined;
  await assert.rejects(() => m.copyImage(blob), /不支持复制图片/);
  env.window.desktop = { copyImage: async bytes => { desktopBytes = bytes; return { ok: true }; } };
  await m.copyImage(blob); assert.equal(Buffer.from(desktopBytes).toString(), 'synthetic bytes');
  env.window.desktop.copyImage = async () => ({ ok: false, message: 'synthetic rejection' });
  await assert.rejects(() => m.copyImage(blob), /synthetic rejection/);
  await assert.rejects(() => m.copyImage(new Blob(['x'], { type: 'image/jpeg' })), /无法复制/);
  await assert.rejects(() => m.copyImage(new Blob([], { type: 'image/png' })), /无法复制/);
  await assert.rejects(() => m.copyImage(new Blob([new Uint8Array(32 * 1024 * 1024 + 1)], { type: 'image/png' })), /超过/);
  return true;
}
(async () => {
  const win = await ready; const results = { unit: await unitChecks() };
  const run = source => win.webContents.executeJavaScript(source);
  await run(`window.viewerTest = {
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    button: text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text),
    wait: async fn => { for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('viewer timeout');},
    stage: () => document.querySelector('.image-view-stage'),
    image: () => document.querySelector('.image-view-picture'),
    scale: () => parseInt(document.querySelector('[aria-label="图片缩放比例"]').textContent),
    generate: async () => { const previous=viewerTest.image()?.src;viewerTest.button('生成').click();await viewerTest.wait(()=>viewerTest.image()?.naturalWidth && viewerTest.image().src!==previous && viewerTest.button('复制图片') && !viewerTest.button('取消生成'));await viewerTest.sleep(100); }
  }; true;`);
  await run(`(async()=>{ await viewerTest.wait(()=>!!document.querySelector('.count-badge'));[...document.querySelectorAll('input[type="checkbox"]')].find(e=>e.closest('label')?.textContent.includes('演示模式')).click();await viewerTest.sleep(50);await viewerTest.generate(); })()`);
  results.fit = await run(`(()=>{ const i=viewerTest.image().getBoundingClientRect(),s=viewerTest.stage().getBoundingClientRect();return i.width<=s.width&&i.height<=s.height&&viewerTest.scale()<100; })()`);
  const original = Buffer.from(await run(`(async()=>[...new Uint8Array(await(await fetch(viewerTest.image().src)).arrayBuffer())])()`));
  await run(`(async()=>{ viewerTest.button('原始尺寸').click();await viewerTest.sleep(50); })()`);
  assert.equal(await run('viewerTest.scale()'), 100);
  const at100 = await run(`(()=>{ const r=viewerTest.stage().getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at100 });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: at100.x + 55, y: at100.y + 35 });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: at100.x + 55, y: at100.y + 35 });
  await new Promise(r => setTimeout(r, 150));
  results.pointerDrag = await run(`viewerTest.image().style.transform.includes('55px') && viewerTest.image().style.transform.includes('35px')`);
  await run(`viewerTest.stage().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:${at100.x},clientY:${at100.y},deltaY:-200}));`);
  await new Promise(r => setTimeout(r, 80)); results.wheelZoom = await run('viewerTest.scale()>100');
  await run(`viewerTest.stage().dispatchEvent(new KeyboardEvent('keydown',{key:'+',bubbles:true,cancelable:true}));`);
  await new Promise(r => setTimeout(r, 50)); results.keyboardZoom = await run('viewerTest.scale()>149');
  await run(`viewerTest.stage().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));viewerTest.button('复制图片').click();`);
  for (let i=0;i<100&&!writes;i++) await new Promise(r=>setTimeout(r,50));
  assert.equal(writes, 1); assert.ok(captured.equals(original), 'copy original bytes at zoom and pan');
  assert.deepEqual(nativeImage.createFromBuffer(captured).getSize(), { width: 832, height: 1216 });
  results.copyOriginal = await run(`document.body.textContent.includes('完整图片已复制')`);
  clipboardFail = true; await run(`viewerTest.button('复制图片').click()`);
  await new Promise(r => setTimeout(r, 150)); results.copyFailure = await run(`document.body.textContent.includes('图片复制失败')`); clipboardFail = false;
  const before = writes;
  const rejected = await run(`(async()=>{let out=[];for(const data of [new Uint8Array(),new Uint8Array([1,2,3]),'C:/private.png',new Uint8Array(32*1024*1024+1)])out.push((await window.desktop.copyImage(data)).ok);return out;})()`);
  assert.deepEqual(rejected, [false,false,false,false]); assert.equal(writes,before);
  const malformed = Buffer.from(original); malformed.writeUInt32BE(999999,16);
  assert.equal(await run(`(async()=> (await window.desktop.copyImage(new Uint8Array(${JSON.stringify([...malformed])}))).ok)()`),false); assert.equal(writes,before);
  results.invalidCopyRejected = true;
  await run(`viewerTest.button('适应窗口').click()`); await new Promise(r=>setTimeout(r,50)); results.reset = await run(`viewerTest.scale()<100&&viewerTest.image().style.transform.includes('0px')`);
  await run(`viewerTest.stage().dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`); await new Promise(r=>setTimeout(r,50)); assert.equal(await run('viewerTest.scale()'),100);
  await run(`viewerTest.stage().dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`); await new Promise(r=>setTimeout(r,50)); results.doubleClickReset = await run('viewerTest.scale()<100');
  await run(`viewerTest.button('原始尺寸').click();viewerTest.button('复制图片').click()`); await new Promise(r=>setTimeout(r,100));
  fs.writeFileSync(path.join(evidence,'viewer-desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await run(`viewerTest.generate()`);
  results.newImageReset = await run('viewerTest.scale()<100');
  await run(`(async()=>{ viewerTest.button('原始尺寸').click();document.querySelectorAll('img[alt="历史图片"]')[1].closest('button').click();await viewerTest.sleep(150); })()`);
  results.historyReset = await run('viewerTest.scale()<100');
  pendingCopy = true; await run(`viewerTest.button('复制图片').click()`);
  for(let i=0;i<100&&typeof pendingCopy!=='function';i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(typeof pendingCopy,'function');
  await run(`document.querySelectorAll('img[alt="历史图片"]')[0].closest('button').click()`);
  pendingCopy(); pendingCopy = undefined; await new Promise(r=>setTimeout(r,100));
  results.copySwitchRace = await run(`!document.querySelector('.image-copy-notice') && !viewerTest.button('复制图片').disabled`);
  await run(`viewerTest.button('生成').click()`); await new Promise(r=>setTimeout(r,50));
  results.busy = await run(`viewerTest.button('复制图片').disabled && document.querySelector('[aria-label="放大图片"]').disabled && !!document.querySelector('.image-view-busy')`);
  await run(`viewerTest.button('取消生成').click()`); await new Promise(r=>setTimeout(r,100));await run(`viewerTest.button('知道了').click()`);
  win.setMinimumSize(320,480); win.setSize(390,844);
  await run(`document.querySelector('.workspace-tabs button:last-child').click()`); await new Promise(r=>setTimeout(r,200));
  const mobile = await run(`(()=>{const s=viewerTest.stage().getBoundingClientRect(),i=viewerTest.image().getBoundingClientRect(),a=document.querySelector('.image-view-actions').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,preview:s.height,fit:i.width<=s.width&&i.height<=s.height,actionsVisible:a.bottom<=innerHeight};})()`);
  console.log('[MOBILE_LAYOUT]',JSON.stringify(mobile));
  fs.writeFileSync(path.join(evidence,'viewer-mobile-fit.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  assert.ok(mobile.scroll<=mobile.width+1);assert.ok(mobile.preview>220);assert.equal(mobile.fit,true);assert.equal(mobile.actionsVisible,true); results.mobile=mobile;
  await run(`viewerTest.button('原始尺寸').click()`); await new Promise(r=>setTimeout(r,100));
  await run(`viewerTest.stage().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))`); await new Promise(r=>setTimeout(r,50));
  results.mobilePan = await run(`!viewerTest.image().style.transform.includes('+ 0px))')`);
  fs.writeFileSync(path.join(evidence,'viewer-mobile.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  win.setSize(1440,900); await new Promise(r=>setTimeout(r,100)); await run(`viewerTest.button('适应窗口').click()`); await new Promise(r=>setTimeout(r,100));
  fs.writeFileSync(path.join(evidence,'viewer-fit.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  win.webContents.setZoomFactor(2); await new Promise(r=>setTimeout(r,150));
  await run(`document.querySelector('.workspace-tabs button:last-child').click()`);await new Promise(r=>setTimeout(r,100));
  const enlarged = await run(`(()=>{const p=document.querySelector('.result-pane'),s=viewerTest.stage().getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,preview:s.height,scrollable:getComputedStyle(p).overflowY==='auto'&&p.scrollHeight>p.clientHeight};})()`);
  assert.ok(enlarged.scroll<=enlarged.width+1);assert.ok(enlarged.preview>=240);assert.equal(enlarged.scrollable,true);results.zoom200=enlarged;
  fs.writeFileSync(path.join(evidence,'viewer-200-percent.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await run(`document.querySelector('.image-view-actions').scrollIntoView({block:'center'})`);
  results.zoom200Actions = await run(`(()=>{const a=document.querySelector('.image-view-actions').getBoundingClientRect(),p=document.querySelector('.result-pane').getBoundingClientRect();return a.top>=p.top&&a.bottom<=p.bottom;})()`);
  for(const [key,value] of Object.entries(results))if(!['mobile','zoom200'].includes(key))assert.equal(value,true,key);
  results.pass=true;fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(results,null,2));console.log('[IMAGE_VIEWER_VERIFY]',JSON.stringify(results));app.quit();
})().catch(e=>{console.error(e);app.exit(1);});
