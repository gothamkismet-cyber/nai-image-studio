// 合成图片/密钥，独立数据目录，所有外网请求被禁止。
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const evidence = process.env.NAI_VERIFY_EVIDENCE ? path.resolve(process.env.NAI_VERIFY_EVIDENCE) : path.resolve(__dirname,'../.tavernweave/evidence/vision');
fs.mkdirSync(evidence,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(evidence,'test-profile-')));
delete process.env.NAI_SELFTEST;delete process.env.VITE_DEV_SERVER_URL;
const ready=new Promise(resolve=>app.once('browser-window-created',(_event,win)=>{
  win.hide();win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,callback)=>callback({cancel:true}));
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR?path.join(path.resolve(process.env.NAI_VERIFY_ASAR),'electron/main.cjs'):'../electron/main.cjs');

async function clientChecks(){
  const compiled=stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname,'../src/lib/vision.ts'),'utf8'),{mode:'transform'}).replace(/^export /gm,'')+'\nmodule.exports={requestVision,visionEndpoint,visionConfigError,loadVisionConfig,saveVisionConfig,prepareVisionImage};';
  const mod={exports:{}};let responder,requests=0,seen;const store=new Map();let storageFail=false;
  const sandbox={module:mod,exports:mod.exports,URL,Error,TypeError,AbortSignal:{timeout:()=>AbortSignal.timeout(30),any:s=>AbortSignal.any(s)},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(storageFail)throw new Error('full');store.set(k,v);},removeItem:k=>{if(storageFail)throw new Error('full');store.delete(k);}},fetch:async(url,options)=>{requests++;seen={url,...options};return responder(options);},createImageBitmap:async()=>{throw new Error('bad image');}};
  vm.runInNewContext(compiled,sandbox);const m=mod.exports,c={baseUrl:'https://vision.example.invalid/v1/',apiKey:' Bearer synthetic-vision ',model:' multimodal-test '},image='data:image/png;base64,AAAA';
  assert.equal(m.visionEndpoint(c.baseUrl),'https://vision.example.invalid/v1/chat/completions');assert.equal(m.visionEndpoint('https://vision.example.invalid/v1/chat/completions/'),'https://vision.example.invalid/v1/chat/completions');
  for(const url of ['file:///etc/test','https://u:p@host/v1','https://host/v1?k=x','javascript:alert(1)'])assert.throws(()=>m.visionEndpoint(url));
  assert.ok(m.visionConfigError({...c,apiKey:'bad key'}));assert.ok(m.visionConfigError({...c,model:''}));
  responder=()=>Response.json({choices:[{message:{content:' red hair, white dress '}}]});assert.equal(await m.requestVision(c,image,'describe'),'red hair, white dress');
  const body=JSON.parse(seen.body);assert.equal(seen.url,'https://vision.example.invalid/v1/chat/completions');assert.equal(seen.headers.Authorization,'Bearer synthetic-vision');assert.equal(seen.redirect,'error');assert.equal(seen.credentials,'omit');assert.equal(body.model,'multimodal-test');assert.equal(body.messages[0].content[1].image_url.url,image);assert.equal(body.stream,false);
  const n=requests;await assert.rejects(m.requestVision(c,'https://remote/image.png','describe'),/图片数据无效/);assert.equal(requests,n);
  for(const status of [400,401,403,404,413,429,500]){responder=()=>new Response('private details must not be echoed',{status});await assert.rejects(m.requestVision(c,image,'describe'),e=>e.message.includes('HTTP '+status)&&!e.message.includes('private details'));}
  for(const data of [{},null,{choices:[{message:{content:''}}]},{choices:[{finish_reason:'length',message:{content:'partial'}}]}]){responder=()=>Response.json(data);await assert.rejects(m.requestVision(c,image,'describe'));}
  responder=()=>Response.json({choices:[{message:{content:[{type:'text',text:'hello'},{type:'text',text:'world'}]}}]});assert.equal(await m.requestVision(c,image,'describe'),'hello\nworld');
  responder=()=>new Response('html');await assert.rejects(m.requestVision(c,image,'describe'),/无法读取/);
  responder=()=>{throw new TypeError('offline');};await assert.rejects(m.requestVision(c,image,'describe'),/连接失败/);
  responder=({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));const ac=new AbortController();const pending=m.requestVision(c,image,'describe',ac.signal);ac.abort();await assert.rejects(pending,/已取消/);await assert.rejects(m.requestVision(c,image,'describe'),/超时/);
  assert.equal(m.saveVisionConfig(c),null);assert.equal(m.loadVisionConfig().apiKey,'synthetic-vision');storageFail=true;assert.match(m.saveVisionConfig({...c,model:'other'}),/未保存/);assert.match(m.saveVisionConfig(null),/未保存/);storageFail=false;assert.equal(m.loadVisionConfig().model,'multimodal-test');store.set('nai_vision_config_v1','{"apiKey":42}');assert.equal(m.loadVisionConfig().apiKey,'');
  await assert.rejects(m.prepareVisionImage({type:'image/svg+xml',size:1}),/PNG/);await assert.rejects(m.prepareVisionImage({type:'image/png',size:21*1024*1024}),/20 MB/);await assert.rejects(m.prepareVisionImage({type:'image/png',size:1}),/无法读取/);
  return {endpoint:true,payload:true,noKeyLeak:true,validation:true,response:true,errors:true,cancel:true,timeout:true,storage:true,imageValidation:true};
}
async function uiChecks(){
  const win=await ready;
  const out=await win.webContents.executeJavaScript('('+ (async function(){
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await sleep(60);}throw new Error('Timeout: '+label);};
    const b=t=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===t),i=id=>document.getElementById(id),text=()=>document.querySelector('dialog')?.textContent||'';
    const fill=async(el,value)=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await sleep(40);};
    const open=async()=>{b('图片转提示词').focus();b('图片转提示词').click();await sleep(60);};const close=async()=>{document.querySelector('[aria-label="关闭图片转提示词"]').click();await sleep(60);};
    await wait(()=>document.body.textContent.includes('22,956'),'library');const out={};let mode='success',pending=[],calls=[];
    window.fetch=async(url,options)=>{calls.push({url,options});if(mode==='pending')return new Promise(resolve=>pending.push(resolve));if(mode==='bad')return new Response('{}',{status:400});return Response.json({choices:[{message:{content:mode==='test'?'左红右蓝':'red hair, white dress, soft lighting'}}]});};
    localStorage.setItem('nai_token','synthetic-novelai-separate');
    await open();out.modal=document.querySelector('dialog').open&&document.activeElement===document.querySelector('.vision-nav button');out.note=text().includes('需要多模态 AI 模型')&&text().includes('纯文本模型无法识图');
    b('配置识图 API').click();await sleep(50);await fill(i('vision-url'),'https://vision.example.invalid/v1/');await fill(i('vision-key'),' Bearer synthetic-vision ');await fill(i('vision-model'),'multimodal-test');
    mode='test';b('测试识图能力').click();await wait(()=>text().includes('图片请求已返回'),'test');const test=JSON.parse(calls.at(-1).options.body);out.testImage=test.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,')&&text().includes('左红右蓝')&&text().includes('API 费用');
    b('保存识图配置').click();await sleep(50);out.saved=JSON.parse(localStorage.getItem('nai_vision_config_v1')).apiKey==='synthetic-vision'&&text().includes('已保存');
    const setter=Storage.prototype.setItem;await fill(i('vision-model'),'unsaved-model');Storage.prototype.setItem=function(k,v){if(k==='nai_vision_config_v1')throw new DOMException('full','QuotaExceededError');return setter.call(this,k,v);};b('保存识图配置').click();await sleep(50);out.saveFailure=text().includes('未保存')&&JSON.parse(localStorage.getItem('nai_vision_config_v1')).model==='multimodal-test';Storage.prototype.setItem=setter;await fill(i('vision-model'),'multimodal-test');
    mode='pending';b('测试识图能力').click();await sleep(40);await fill(i('vision-model'),'multimodal-new');pending.shift()(Response.json({choices:[{message:{content:'late obsolete'}}]}));await sleep(60);out.testRace=!text().includes('late obsolete')&&calls.at(-1).options.signal.aborted;await fill(i('vision-model'),'multimodal-test');
    b('图片识别').click();await sleep(50);
    const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1000;const ctx=canvas.getContext('2d');ctx.fillStyle='#7b4cc0';ctx.fillRect(0,0,2000,1000);ctx.fillStyle='#decfff';ctx.beginPath();ctx.arc(1000,500,230,0,Math.PI*2);ctx.fill();const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
    const upload=async(name='reference.png')=>{const dt=new DataTransfer();dt.items.add(new File([blob],name,{type:'image/png'}));document.querySelector('[aria-label="选择识图图片"]').files=dt.files;document.querySelector('[aria-label="选择识图图片"]').dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>document.querySelector('.vision-upload img'),'image prepared');};
    const before=calls.length;await upload();out.localOnly=calls.length===before;out.resize=text().includes('1600 × 800')&&document.querySelector('.vision-upload img').src.startsWith('data:image/jpeg;base64,');
    mode='success';b('识别图片').click();await wait(()=>i('vision-result').value.includes('white dress'),'recognition');const request=calls.at(-1),body=JSON.parse(request.options.body);out.request=request.url==='https://vision.example.invalid/v1/chat/completions'&&request.options.headers.Authorization==='Bearer synthetic-vision'&&body.messages[0].content[1].image_url.url===document.querySelector('.vision-upload img').src&&!request.options.body.includes('reference.png')&&!request.options.body.includes('synthetic-novelai');
    let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async v=>{copied=v;}}});b('复制提示词').click();await sleep(50);out.copy=copied===i('vision-result').value&&text().includes('已复制');
    mode='pending';b('识别图片').click();await sleep(40);b('取消识别').click();pending.shift()(Response.json({choices:[{message:{content:'late canceled'}}]}));await sleep(60);out.cancel=i('vision-result').value===''&&calls.at(-1).options.signal.aborted;
    b('识别图片').click();await sleep(40);await upload('new-reference.png');pending.shift()(Response.json({choices:[{message:{content:'late old image'}}]}));await sleep(60);out.imageRace=i('vision-result').value===''&&text().includes('new-reference.png')&&!text().includes('late old image');
    mode='bad';b('识别图片').click();await wait(()=>text().includes('HTTP 400'),'error');out.modelError=text().includes('支持图片输入');
    mode='success';await fill(i('vision-style'),'description');await fill(i('vision-extra'),'只描述构图');b('识别图片').click();await wait(()=>i('vision-result').value,'description');out.style=JSON.parse(calls.at(-1).options.body).messages[0].content[0].text.includes('中文自然语言')&&JSON.parse(calls.at(-1).options.body).messages[0].content[0].text.includes('只描述构图');
    await fill(i('vision-result'),'edited prompt');const main=document.querySelector('[aria-label="提示词（想画什么）"]');await fill(main,'kept prompt');window.confirm=()=>false;b('替换主提示词').click();await sleep(50);out.replaceCancel=!!document.querySelector('dialog')&&main.value==='kept prompt';b('追加到主提示词').click();await sleep(70);out.append=!document.querySelector('dialog')&&main.value==='kept prompt, edited prompt';
    await open();b('识图 API 设置').click();await sleep(50);out.reopen=i('vision-model').value==='multimodal-test'&&i('vision-key').type==='password';
    const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(k){if(k==='nai_vision_config_v1')throw new DOMException('denied','SecurityError');return remove.call(this,k);};b('清除识图配置').click();await sleep(50);out.clearFailure=text().includes('未保存')&&!!localStorage.getItem('nai_vision_config_v1');Storage.prototype.removeItem=remove;
    mode='pending';b('测试识图能力').click();await sleep(40);await close();await open();pending.shift()(Response.json({choices:[{message:{content:'late closed'}}]}));await sleep(60);out.closeRace=!text().includes('late closed');
    document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await sleep(60);out.escape=!document.querySelector('dialog')&&document.activeElement===b('图片转提示词');
    return out;
  }).toString()+')()');
  for(const[key,value]of Object.entries(out))assert.equal(value,true,key);
  const reloaded=new Promise(r=>win.webContents.once('did-finish-load',r));win.reload();await reloaded;await new Promise(r=>setTimeout(r,400));
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="图片转提示词").click()');await new Promise(r=>setTimeout(r,100));
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="识图 API 设置").click()');await new Promise(r=>setTimeout(r,100));
  out.persisted=await win.webContents.executeJavaScript('document.querySelector("#vision-model").value==="multimodal-test"&&document.querySelector("#vision-key").value==="synthetic-vision"');assert.equal(out.persisted,true);
  await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(evidence,'vision-config-desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="清除识图配置").click()');await new Promise(r=>setTimeout(r,100));
  out.independent=await win.webContents.executeJavaScript('localStorage.getItem("nai_token")==="synthetic-novelai-separate"&&!localStorage.getItem("nai_vision_config_v1")');assert.equal(out.independent,true);
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="图片识别").click()');await new Promise(r=>setTimeout(r,150));
  fs.writeFileSync(path.join(evidence,'vision-desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  win.setMinimumSize(320,480);win.setSize(390,844);await new Promise(r=>setTimeout(r,200));
  await win.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="识图 API 设置").click()');await new Promise(r=>setTimeout(r,150));
  const layout=await win.webContents.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth,dialogWidth:document.querySelector("dialog").clientWidth,dialogScroll:document.querySelector("dialog").scrollWidth,footerBottom:document.querySelector(".api-settings-footer").getBoundingClientRect().bottom,height:innerHeight})');assert.ok(layout.width+1>=layout.scroll);assert.ok(layout.dialogWidth+1>=layout.dialogScroll);assert.ok(layout.footerBottom<=layout.height);out.mobile=layout;
  fs.writeFileSync(path.join(evidence,'vision-config-mobile.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return out;
}
(async()=>{const client=await clientChecks();const ui=await uiChecks();const receipt={client,ui,pass:true,externalNetwork:false,realCredentials:false};fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(receipt,null,2));console.log('[VISION_VERIFY]',JSON.stringify(receipt));app.quit();})().catch(e=>{console.error(e);app.exit(1);});
