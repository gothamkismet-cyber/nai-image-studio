// 独立数据目录、合成角色与模拟服务；不读取真实 Token，不调用官方付费生成。
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const evidence=path.resolve(process.env.NAI_VERIFY_EVIDENCE||'.tavernweave/evidence/characters/final');
fs.mkdirSync(evidence,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(evidence,'test-profile-')));
delete process.env.NAI_SELFTEST;delete process.env.VITE_DEV_SERVER_URL;
const ready=new Promise(resolve=>app.once('browser-window-created',(_e,win)=>{
  win.hide();win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR?path.join(path.resolve(process.env.NAI_VERIFY_ASAR),'electron/main.cjs'):'../electron/main.cjs');
function loadModule(file,expose){
  const mod={exports:{}};
  const types=file.endsWith('nai.ts')?stripTypeScriptTypes(fs.readFileSync('src/types.ts','utf8'),{mode:'transform'}).replace(/^export /gm,'')+'\n':'';
  const code=types+stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'transform'}).replace('import JSZip from "jszip";','const JSZip=require("jszip");').replace(/^import .*;$/gm,'').replace(/^export /gm,'')+'\nmodule.exports={'+expose+'};';
  vm.runInNewContext(code,{module:mod,require,crypto:require('node:crypto').webcrypto});return mod.exports;
}
function checkPayload(body){
  const p=body.parameters;
  assert.equal(body.action,'generate');
  assert.equal(p.params_version,4);
  assert.ok(Array.isArray(p.characterPrompts));assert.equal(typeof p.use_coords,'boolean');
  for(const c of p.characterPrompts){
    assert.deepEqual(Object.keys(c).sort(),['center','enabled','prompt','uc']);
    assert.equal(c.enabled,true);assert.ok(c.prompt.trim().length);assert.equal(typeof c.uc,'string');
    for(const v of Object.values(c.center))assert.ok(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1);
  }
  {
    assert.ok(p.v4_prompt?.caption,'V5/V4 positive caption is required, including zero characters');
    assert.ok(p.v4_negative_prompt?.caption,'V5/V4 negative caption is required, including zero characters');
    assert.equal(p.v4_prompt.caption.char_captions.length,p.characterPrompts.length);
    assert.equal(p.v4_negative_prompt.caption.char_captions.length,p.characterPrompts.length);
    assert.equal(p.v4_prompt.caption.base_caption,body.input);
    assert.equal(p.v4_negative_prompt.caption.base_caption,p.negative_prompt);
    assert.equal(p.v4_prompt.use_coords,p.use_coords);
    assert.equal(p.v4_negative_prompt.legacy_uc,false);
    for(const [i,c]of p.characterPrompts.entries()){
      for(const [field,text]of [['v4_prompt',c.prompt],['v4_negative_prompt',c.uc]]){
        const item=p[field].caption.char_captions[i];assert.equal(item.char_caption,text);
        assert.equal(item.centers.length,1);assert.deepEqual(item.centers[0],c.center);
      }
    }
  }
}
function unitChecks(){
  const {buildPayload}=loadModule(path.resolve('src/lib/nai.ts'),'buildPayload');
  const {DEFAULT_PARAMS,normalizeCharacters}=loadModule(path.resolve('src/types.ts'),'DEFAULT_PARAMS,normalizeCharacters');
  const char={id:'a',name:'本机名字',caption:'girl, blue coat',negative:'hat',positionMode:'ai',x:.1,y:.9};
  const before=loadModule(path.resolve('.tavernweave/backups/2026-10-02-character-api-fix/source/src/lib/nai.ts'),'buildPayload');
  const oldV5=before.buildPayload({...DEFAULT_PARAMS,characters:[char]});
  assert.equal(oldV5.parameters.characterPrompts.length,1);
  assert.equal(oldV5.parameters.v4_prompt,undefined);
  assert.equal(oldV5.parameters.v4_negative_prompt,undefined);
  assert.throws(()=>checkPayload(oldV5));
  assert.throws(()=>checkPayload(before.buildPayload({...DEFAULT_PARAMS,characters:[]})));
  const input={...DEFAULT_PARAMS,prompt:'2girls, outdoors',negativePrompt:'blurry',characters:[char,{...char,id:'b',name:'不发送',enabled:false,caption:'girl, red coat',positionMode:'custom'},{...char,id:'empty',caption:' \n ',positionMode:'custom'}]};
  const snapshot=JSON.stringify(input);
  for(const model of ['nai-diffusion-5-full','nai-diffusion-5-curated','nai-diffusion-4-full','nai-diffusion-4-5-full']){
    const body=JSON.parse(JSON.stringify(buildPayload({...input,model})));checkPayload(body);
    assert.equal(body.parameters.characterPrompts.length,1);assert.equal(body.parameters.use_coords,false);
    assert.deepEqual(body.parameters.characterPrompts[0].center,{x:.5,y:.5});
    assert.ok(!JSON.stringify(body).includes('本机名字'));assert.ok(!JSON.stringify(body).includes('red coat'));
    const mixed=JSON.parse(JSON.stringify(buildPayload({...input,model,characters:[char,{...char,id:'b',positionMode:'custom',x:.8,y:.2}]})));checkPayload(mixed);
    assert.equal(mixed.parameters.use_coords,true);assert.equal(mixed.parameters.characterPrompts.length,2);
    assert.deepEqual(mixed.parameters.characterPrompts[1].center,{x:.8,y:.2});
    const invalid=JSON.parse(JSON.stringify(buildPayload({...input,model,characters:[{...char,positionMode:'custom',x:NaN,y:2}]})));
    assert.deepEqual(invalid.parameters.characterPrompts[0].center,{x:.5,y:1});
    const empty=JSON.parse(JSON.stringify(buildPayload({...input,model,characters:input.characters.slice(1)})));checkPayload(empty);assert.equal(empty.parameters.characterPrompts.length,0);assert.equal(empty.parameters.use_coords,false);
  }
  assert.equal(JSON.stringify(input),snapshot);
  const old=normalizeCharacters([char,{...char,enabled:false,name:'备注'}]);assert.equal(old[0].enabled,true);assert.equal(old[1].enabled,false);assert.equal(old[1].name,'备注');
  const bad=normalizeCharacters([{name:3,enabled:'false',caption:2,x:NaN},null]);assert.equal(bad[0].name,'');assert.equal(bad[0].enabled,true);assert.equal(bad[0].caption,'');assert.equal(bad[0].x,.5);
  const v3=buildPayload({...input,model:'nai-diffusion-3'});assert.equal(v3.parameters.characterPrompts,undefined);assert.equal(v3.parameters.negative_prompt,'blurry');
  return {baselineMismatchReproduced:true,models:true,coordinates:true,filtering:true,namesLocalOnly:true,rawTextUnchanged:true,oldStorage:true,v3:true};
}
(async()=>{
  const out={unit:unitChecks()},win=await ready;
  const run=s=>win.webContents.executeJavaScript(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const capture=async name=>{for(let attempt=0;attempt<3;attempt++){try{fs.writeFileSync(path.join(evidence,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return;}catch(e){if(attempt===2)throw e;await sleep(200);}}};
  const wait=async(s,label)=>{for(let i=0;i<80;i++){if(await run(s))return;await sleep(100);}throw Error('Timeout: '+label);};
  const helpers=`window.charsTest={button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),field:t=>document.querySelector('[aria-label="'+t+'"]'),fill:(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},params:()=>JSON.parse(localStorage.getItem('nai_params_v1'))};`;
  await run(`localStorage.setItem('nai_token','synthetic-test-only');`);
  const reloaded=new Promise(r=>win.webContents.once('did-finish-load',r));win.reload();await reloaded;await sleep(200);await run(helpers+";void 0");
  await run(`charsTest.button('＋ 角色').click()`);await sleep(80);
  await run(`charsTest.fill(charsTest.field('角色 1 名称'),'小蓝');charsTest.fill(charsTest.field('角色 1 提示词'),'girl, blue coat');charsTest.fill(charsTest.field('角色 1 负面词'),'hat');charsTest.fill(charsTest.field('提示词（想画什么）'),'2girls, outdoors');charsTest.fill(document.querySelector('.editor-pane select'),'nai-diffusion-5-full');`);await sleep(100);
  await run(`charsTest.button('＋ 角色').click()`);await sleep(60);
  await run(`charsTest.fill(charsTest.field('角色 2 名称'),'小红');charsTest.fill(charsTest.field('角色 2 提示词'),'girl, red coat');charsTest.field('角色 2 加入生成').click();charsTest.button('＋ 角色').click();`);await sleep(100);
  out.ui={togglePreservesText:await run(`charsTest.field('角色 2 提示词').value==='girl, red coat'&&charsTest.field('角色 2 名称').value==='小红'&&!charsTest.field('角色 2 加入生成').checked`),libraryNames:await run(`charsTest.field('词库插入目标').textContent.includes('小红（停用）')&&charsTest.field('词库插入目标').textContent.includes('小蓝')`)};
  await run(`charsTest.field('角色 1 提示词').closest('.prompt-textarea').parentElement.querySelectorAll('button')[2].click()`);await sleep(80);
  await run(`const p=charsTest.field('角色 1 自由定位');p.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true}));p.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true}));`);await sleep(80);
  const installMock=`window.captured=[];window.originalFetch=window.fetch;window.holdGeneration=false;window.failGeneration=false;window.fetch=async(url,opt)=>{if(String(url).startsWith('data:'))return originalFetch(url,opt);if(url!=='https://image.novelai.net/ai/generate-image')throw Error('External request blocked');const body=JSON.parse(opt.body);captured.push(body);if(holdGeneration)await new Promise(r=>window.releaseGeneration=r);if(failGeneration||!Array.isArray(body.parameters.characterPrompts)||!body.parameters.v4_prompt?.caption||!body.parameters.v4_negative_prompt?.caption)return Response.json({statusCode:500,message:'Synthetic server failure'},{status:500});const c=document.createElement('canvas');c.width=8;c.height=12;const ctx=c.getContext('2d');ctx.fillStyle='#579';ctx.fillRect(0,0,8,12);return Response.json({images:[{image:c.toDataURL('image/png').split(',')[1],seed:body.parameters.seed}]});};`;
  await run(installMock+";void 0");
  await run(`window.holdGeneration=true;charsTest.button('生成').click()`);await wait('captured.length===1','request');
  out.ui.busyLocks=await run(`charsTest.field('角色 1 名称').disabled&&charsTest.field('角色 1 加入生成').disabled&&charsTest.field('角色 1 自由定位').disabled`);
  checkPayload(await run('captured[0]'));out.ui.v5Request=true;
  const body=await run('captured[0]');assert.equal(body.model,'nai-diffusion-5-full');assert.equal(body.parameters.characterPrompts.length,1);assert.equal(body.parameters.characterPrompts[0].prompt,'girl, blue coat');assert.equal(body.parameters.use_coords,true);assert.ok(!JSON.stringify(body).includes('小蓝'));
  await run(`releaseGeneration();window.holdGeneration=false;`);await wait(`charsTest.button('生成')&&!document.querySelector('[role="alert"]')&&document.querySelector('img[alt="历史图片"]')`,'generated preview/history');out.ui.generated=true;
  await run(`charsTest.field('角色 1 加入生成').click();charsTest.fill(charsTest.field('角色 1 名称'),'临时');`);await sleep(80);await run(`charsTest.button('载入参数').click()`);await sleep(100);
  out.ui.historyRestore=await run(`charsTest.field('角色 1 名称').value==='小蓝'&&charsTest.field('角色 1 加入生成').checked&&charsTest.field('角色 2 名称').value==='小红'&&!charsTest.field('角色 2 加入生成').checked`);
  await run(`charsTest.field('角色 2 加入生成').click();charsTest.fill(document.querySelector('.editor-pane select'),'nai-diffusion-4-5-full');`);await sleep(100);
  await run(`charsTest.button('生成').click()`);await wait('captured.length===2','v4 request');await wait(`!!charsTest.button('生成')`,'v4 generated');
  checkPayload(await run('captured[1]'));assert.equal(await run('captured[1].parameters.characterPrompts.length'),2);out.ui.v4Request=true;
  await run(`charsTest.field('角色 1 加入生成').click();charsTest.field('角色 2 加入生成').click();charsTest.fill(document.querySelector('.editor-pane select'),'nai-diffusion-5-full');`);await sleep(80);await run(`charsTest.button('生成').click()`);await wait('captured.length===3','all off request');await wait(`!!charsTest.button('生成')`,'all off generated');
  const off=await run('captured[2]');assert.equal(off.model,'nai-diffusion-5-full');checkPayload(off);assert.equal(off.parameters.characterPrompts.length,0);assert.equal(off.parameters.use_coords,false);out.ui.allOff=true;
  await run(`charsTest.field('角色 1 加入生成').click();charsTest.field('角色 1 名称').scrollIntoView({block:'center'});`);await sleep(150);
  await run(`window.failGeneration=true;charsTest.button('生成').click()`);await wait(`!!document.querySelector('[role="alert"]')&&!!charsTest.button('生成')`,'server error');
  out.ui.serverFailure=await run(`document.querySelector('[role="alert"]').textContent.includes('HTTP 500')&&captured.length===4&&!charsTest.field('角色 1 加入生成').disabled&&charsTest.field('角色 1 提示词').value==='girl, blue coat'&&document.querySelectorAll('img[alt="历史图片"]').length===3`);
  fs.writeFileSync(path.join(evidence,'synthetic-requests.json'),JSON.stringify(await run('captured'),null,2));
  await run(`window.failGeneration=false;charsTest.button('知道了').click();`);await sleep(150);
  out.ui.visibleMirrors=await run(`[document.querySelector('#main-prompt'),charsTest.field('角色 1 提示词')].every(i=>{const m=i.closest('.prompt-textarea').querySelector('.prompt-textarea-mirror');return m.textContent.includes(i.value)&&m.clientHeight>0&&Math.abs(m.getBoundingClientRect().width-i.clientWidth)<=1;})`);
  console.log('[CHARACTERS_STEPS]',JSON.stringify(out));await capture('characters-desktop.png');
  const reload=new Promise(r=>win.webContents.once('did-finish-load',r));win.reload();await reload;await sleep(200);await run(helpers+";void 0");
  out.ui.persisted=await run(`charsTest.field('角色 1 名称').value==='小蓝'&&charsTest.field('角色 1 加入生成').checked&&!charsTest.field('角色 2 加入生成').checked&&charsTest.field('角色 2 提示词').value==='girl, red coat'`);
  win.setMinimumSize(320,480);win.setSize(390,844);await sleep(180);await run(`charsTest.field('角色 1 名称').scrollIntoView({block:'center'});`);await sleep(80);
  out.ui.mobile=await run(`document.documentElement.scrollWidth<=innerWidth+1&&charsTest.field('角色 1 名称').getBoundingClientRect().width>60`);
  await capture('characters-mobile.png');
  win.setSize(1440,900);win.webContents.setZoomFactor(2);await sleep(180);
  out.ui.zoom200=await run(`document.documentElement.scrollWidth<=innerWidth+1&&charsTest.field('角色 1 名称').getBoundingClientRect().width>60`);
  for(const group of Object.values(out))for(const [key,value]of Object.entries(group))assert.equal(value,true,key);
  out.externalNetwork=false;out.actualPaidGeneration=false;out.pass=true;
  fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(out,null,2));console.log('[CHARACTERS_VERIFY]',JSON.stringify(out));app.quit();
})().catch(e=>{console.error(e);app.exit(1);});
