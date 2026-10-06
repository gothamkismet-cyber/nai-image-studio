// 独立 Electron 数据目录、合成凭据和模拟服务；不读取用户 Token，不发起生成。
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const evidence = process.env.NAI_VERIFY_EVIDENCE ? path.resolve(process.env.NAI_VERIFY_EVIDENCE) : path.resolve(__dirname, '../.tavernweave/evidence/api-ui');
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

async function verifyClient() {
  const compiled = stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname, '../src/lib/nai.ts'),'utf8'), {mode:'transform'}).replace('import JSZip from "jszip";', 'const JSZip = require("jszip");').replace(/^export /gm, '') + '\nmodule.exports = {checkToken};';
  const mod = { exports: {} }; let responder; let requests = 0; let lastUrl; let lastHeader;
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require, DOMException, AbortSignal: { timeout: () => AbortSignal.timeout(30), any: signals => AbortSignal.any(signals) }, fetch: async (url, options) => { requests++; lastUrl=url; lastHeader=options.headers.Authorization; return responder(options); } });
  const { checkToken } = mod.exports;console.log('[API_STAGE] client');
  responder = () => Response.json({tier:3,active:true});
  assert.deepEqual(JSON.parse(JSON.stringify(await checkToken('  Bearer synthetic-api-a  '))), {tier:3,active:true});
  assert.equal(lastUrl,'https://image.novelai.net/user/subscription');
  assert.equal(lastHeader,'Bearer synthetic-api-a');
  const before=requests;
  await assert.rejects(checkToken('https://example.invalid'), /不要填写网址/);
  await assert.rejects(checkToken('bad token'), /空格或换行/);
  await assert.rejects(checkToken('   '), /请先粘贴/);
  assert.equal(requests,before,'invalid input must not send request');
  for (const status of [400,401,403,429,503]) {
    responder = () => new Response('do not echo raw server data', {status});
    await assert.rejects(checkToken('synthetic-api-a'), e => e.status===status && e.message.includes('连接测试失败') && !e.message.includes('raw server'));
  }
  for(const body of [{},null,{active:'true',tier:3},{active:true,tier:1.5}]) {
    responder=()=>Response.json(body); await assert.rejects(checkToken('synthetic-api-a'), /订阅信息不完整/);
  }
  responder=()=>new Response('not json'); await assert.rejects(checkToken('synthetic-api-a'), /无法读取/);
  responder=()=>{throw new TypeError('offline');}; await assert.rejects(checkToken('synthetic-api-a'), /网络错误/);
  responder=({signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  console.log('[API_STAGE] cancellation');const ac=new AbortController();const canceled=checkToken('synthetic-api-a',ac.signal);ac.abort();await assert.rejects(canceled,/已取消连接测试/);
  console.log('[API_STAGE] timeout');
  // 无外部请求，30ms 本地超时模拟。
  await assert.rejects(checkToken('synthetic-api-a'), /连接测试超时/);
  console.log('[API_STAGE] inactive');responder=()=>Response.json({tier:0,active:false});assert.equal((await checkToken('synthetic-api-a')).active,false);
  return {endpoint:true,normalize:true,inputValidation:true,httpErrors:true,responseValidation:true,network:true,cancel:true,timeout:true,inactive:true};
}

async function verifyUI() {
  const win=await windowReady;console.log('[API_STAGE] ui');
  const result=await win.webContents.executeJavaScript('('+ (async function(){
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await sleep(50);}throw new Error('Timeout: '+label);};
    const out={};
    const b=t=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===t);
    const text=()=>document.querySelector('dialog')?.textContent||'';
    const fill=async v=>{const el=document.querySelector('#api-token');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));await sleep(50);};
    const open=async()=>{const trigger=document.querySelector('[aria-label="API 配置"]');trigger.focus();trigger.click();await sleep(70);};
    const close=async()=>{document.querySelector('[aria-label="关闭 API 配置"]').click();await sleep(70);};
    await wait(()=>document.body.textContent.includes('22,956'),'library');
    let mode='success',pending=[];const requests=[];
    window.fetch=async(url,options)=>{
      requests.push({url,signal:options.signal});
      if(mode==='pending')return new Promise(resolve=>pending.push(resolve)); // 故意忽略取消，验证旧结果守卫。
      if(mode==='unauthorized')return new Response('{}',{status:401});
      return Response.json({active:mode!=='inactive',tier:3});
    };
    await open();out.focus=document.activeElement===document.querySelector('#api-token');
    out.emptyDisabled=b('保存配置').disabled&&b('测试连接').disabled;
    await fill('  Bearer synthetic-api-a  ');b('测试连接').click();await wait(()=>text().includes('连接成功'),'connected');
    out.endpoint=requests.at(-1).url==='https://image.novelai.net/user/subscription';
    out.unsaved=text().includes('有未保存修改')&&!localStorage.getItem('nai_token');
    b('保存配置').click();await sleep(60);out.saved=localStorage.getItem('nai_token')==='synthetic-api-a'&&text().includes('配置已保存')&&text().includes('已保存 · 本机');
    await close();await open();out.reopen=document.querySelector('#api-token').value==='synthetic-api-a'&&document.querySelector('#api-token').type==='password'&&!text().includes('连接成功');
    b('显示').click();await sleep(40);out.show=document.querySelector('#api-token').type==='text';b('隐藏').click();
    mode='pending';b('测试连接').click();await sleep(40);const stale=requests.at(-1).signal;
    await fill('synthetic-api-b');pending.shift()(Response.json({active:true,tier:3}));await sleep(60);
    out.editRace=stale.aborted&&!text().includes('连接成功')&&!!b('测试连接');
    b('测试连接').click();await sleep(40);await close();await open();pending.shift()(new Response('{}',{status:401}));await sleep(60);
    out.closeRace=!text().includes('HTTP 401')&&document.querySelector('#api-token').value==='synthetic-api-a';
    b('测试连接').click();await sleep(40);b('取消测试').click();pending.shift()(Response.json({active:true,tier:3}));await sleep(50);
    out.cancel=!text().includes('连接成功')&&requests.at(-1).signal.aborted;
    mode='unauthorized';b('测试连接').click();await wait(()=>text().includes('HTTP 401'),'unauthorized');out.authError=text().includes('Token 无效')&&!text().includes('生成失败');
    mode='inactive';b('测试连接').click();await wait(()=>text().includes('不活跃'),'inactive');out.inactive=!!document.querySelector('.api-message.warning');
    await fill('https://example.invalid');const count=requests.length;b('测试连接').click();await sleep(60);out.invalid=text().includes('不要填写网址')&&requests.length===count;
    await fill('synthetic-api-b');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='nai_token')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};
    b('保存配置').click();await sleep(60);out.saveFailure=text().includes('配置未保存')&&localStorage.getItem('nai_token')==='synthetic-api-a'&&document.querySelector('#api-token').value==='synthetic-api-b';Storage.prototype.setItem=original;
    const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(k){if(k==='nai_token')throw new DOMException('denied','SecurityError');return remove.call(this,k);};b('清除').click();await sleep(50);out.clearFailure=text().includes('配置未保存')&&localStorage.getItem('nai_token')==='synthetic-api-a'&&document.querySelector('#api-token').value==='synthetic-api-b';Storage.prototype.removeItem=remove;
    mode='pending';b('测试连接').click();await sleep(40);b('保存配置').click();await sleep(50);pending.shift()(Response.json({active:true,tier:3}));await sleep(50);
    out.saveRace=text().includes('配置已保存')&&!text().includes('连接成功')&&requests.at(-1).signal.aborted;
    await close();await open();mode='pending';b('测试连接').click();await sleep(40);b('清除').click();await sleep(50);pending.shift()(Response.json({active:true,tier:3}));await sleep(50);
    out.clearRace=!localStorage.getItem('nai_token')&&document.querySelector('#api-token').value===''&&text().includes('已清除')&&!text().includes('连接成功');
    await fill('synthetic-api-unsaved');await close();await open();out.discard=document.querySelector('#api-token').value==='';
    document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await sleep(60);out.escape=!document.querySelector('dialog')&&document.activeElement===document.querySelector('[aria-label="API 配置"]');
    await open();return out;
  }).toString()+')()');
  for(const [key,value]of Object.entries(result))assert.equal(value,true,key);
  // 页面重载后仍使用同一存储键，且不会冒充已通过连接测试。
  await win.webContents.executeJavaScript('document.querySelector(".api-close").click();localStorage.setItem("nai_token","synthetic-reload");');
  const reloaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.reload();await reloaded;await new Promise(r=>setTimeout(r,500));
  result.persisted=await win.webContents.executeJavaScript('document.querySelector(".config-caption").textContent==="已保存"');assert.equal(result.persisted,true);
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="API 配置"]').click()`);await new Promise(r=>setTimeout(r,100));
  result.persistedValue=await win.webContents.executeJavaScript('document.querySelector("#api-token").value==="synthetic-reload"&&!document.querySelector("dialog").textContent.includes("连接成功")');assert.equal(result.persistedValue,true);
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="清除").click()');await new Promise(r=>setTimeout(r,300));
  fs.writeFileSync(path.join(evidence,'api-desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript('document.querySelector(".api-close").click()');
  await new Promise(r=>setTimeout(r,300));
  fs.writeFileSync(path.join(evidence,'workbench-desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  win.setMinimumSize(320,480);win.setSize(390,844);await new Promise(r=>setTimeout(r,150));
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="API 配置"]').click()`);await new Promise(r=>setTimeout(r,150));
  const layout=await win.webContents.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth,dialogWidth:document.querySelector("dialog").clientWidth,dialogScroll:document.querySelector("dialog").scrollWidth,footerBottom:document.querySelector(".api-settings-footer").getBoundingClientRect().bottom,footerTop:document.querySelector(".api-settings-footer").getBoundingClientRect().top,height:innerHeight,inputTop:document.querySelector("#api-token").getBoundingClientRect().top})');
  assert.ok(layout.scroll<=layout.width+1);assert.ok(layout.dialogScroll<=layout.dialogWidth+1);assert.ok(layout.footerBottom<=layout.height);assert.ok(layout.inputTop<layout.footerTop);result.mobile=layout;
  fs.writeFileSync(path.join(evidence,'api-mobile.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  return result;
}
(async()=>{const client=await verifyClient();const ui=await verifyUI();const receipt={client,ui,pass:true,realCredentials:false,externalNetwork:false};fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(receipt,null,2));console.log('[API_VERIFY]',JSON.stringify(receipt));app.quit();})().catch(e=>{console.error(e);app.exit(1);});
