// 独立测试数据，屏蔽外部网络；不读取用户 Token，不调用生成，不写系统剪贴板。
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const evidence=path.resolve(process.env.NAI_VERIFY_EVIDENCE||'.tavernweave/evidence/personal-prompts/final');
fs.mkdirSync(evidence,{recursive:true});
const profile=process.env.NAI_VERIFY_RESTART_PROFILE||fs.mkdtempSync(path.join(evidence,'test-profile-'));
app.setPath('userData',path.resolve(profile));delete process.env.NAI_SELFTEST;delete process.env.VITE_DEV_SERVER_URL;
const ready=new Promise(resolve=>app.once('browser-window-created',(_e,win)=>{
  win.hide();win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR?path.join(path.resolve(process.env.NAI_VERIFY_ASAR),'electron/main.cjs'):'../electron/main.cjs');
function unitChecks(){
  const module={exports:{}};
  const code=stripTypeScriptTypes(fs.readFileSync('src/lib/personal-prompts.ts','utf8'),{mode:'transform'}).replace(/^export /gm,'')+'\nmodule.exports={loadPersonalPrompts,savePersonalPrompts,PERSONAL_PROMPTS_KEY};';
  vm.runInNewContext(code,{module,Error});
  const {loadPersonalPrompts:load,savePersonalPrompts:save,PERSONAL_PROMPTS_KEY:key}=module.exports;
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  assert.equal(load(storage).items.length,0);
  const item={id:'test',name:'柔和光线',prompt:'  {{soft lighting}}, 1.3::warm colors::\nartist:test  '};
  const raw=save([item],null,storage);assert.equal(map.get(key),raw);assert.equal(load(storage).items[0].prompt,item.prompt);
  for(const invalid of ['bad json','null',JSON.stringify({version:2,items:[]}),JSON.stringify({version:1,items:[null]}),JSON.stringify({version:1,items:[{...item,name:' '}]}),JSON.stringify({version:1,items:[{...item,prompt:2}]}),JSON.stringify({version:1,items:[item,item]})]){
    map.set(key,invalid);assert.ok(load(storage).error);assert.equal(map.get(key),invalid);
    assert.throws(()=>save([item],null,storage),/其他窗口/);assert.equal(map.get(key),invalid);
  }
  map.set(key,raw);
  const failing={getItem:storage.getItem,setItem:()=>{throw Error('quota');}};
  assert.throws(()=>save([],raw,failing),/没有保存成功/);assert.equal(map.get(key),raw);
  assert.ok(load({getItem:()=>{throw Error('denied');},setItem:storage.setItem}).error);
  assert.throws(()=>save([{...item,name:'n'.repeat(81)}],raw,storage),/80/);
  assert.throws(()=>save([{...item,prompt:' '.repeat(10)}],raw,storage),/50,000/);
  assert.throws(()=>save([{...item,prompt:'x'.repeat(50001)}],raw,storage),/50,000/);
  assert.throws(()=>save(Array.from({length:2001},(_,i)=>({...item,id:String(i)})),raw,storage),/数量/);
  return {rawTextRoundTrip:true,invalidAndFutureStorageRetained:true,quotaAndPermission:true,conflictPreventsOverwrite:true,limits:true};
}
(async()=>{
  const out={profile,unit:unitChecks()},win=await ready;
  const run=s=>win.webContents.executeJavaScript(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(s,label)=>{for(let i=0;i<80;i++){if(await run(s))return;await sleep(100);}throw Error('Timeout: '+label);};
  const capture=async name=>{for(let i=0;i<3;i++){try{fs.writeFileSync(path.join(evidence,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return;}catch(e){if(i===2)throw e;await sleep(200);}}};
  const helpers=`window.personalTest={button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),field:t=>document.querySelector('[aria-label="'+t+'"]'),fill:(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},stored:()=>JSON.parse(localStorage.getItem('nai_personal_prompts_v1')),params:()=>JSON.parse(localStorage.getItem('nai_params_v1')),action:(prefix,name)=>document.querySelector('[aria-label="'+prefix+'提示词：'+name+'"]')};window.confirmations=[];window.allowConfirm=true;window.confirm=s=>{confirmations.push(s);return allowConfirm;};void 0;`;
  await run(helpers);await run(`personalTest.button('我的提示词').click()`);await sleep(150);
  if(process.env.NAI_VERIFY_RESTART_PROFILE){
    assert.equal(await run(`personalTest.stored().items[0].name==='重启测试收藏'&&!!personalTest.action('插入','重启测试收藏')`),true);
    await run(`personalTest.action('插入','重启测试收藏').click()`);await sleep(100);
    assert.ok(await run(`personalTest.params().prompt.includes('restart retained')`));
    fs.writeFileSync(path.join(evidence,'restart-verification.json'),JSON.stringify({profile,appRestartReadAndInsert:true,pass:true},null,2));
    console.log('[PERSONAL_RESTART] pass');app.quit();return;
  }
  assert.equal(await run(`document.querySelector('.personal-empty h4').textContent`),'把好用的提示词留下来');
  await run(`personalTest.button('＋ 新增提示词').click()`);await sleep(100);
  assert.equal(await run(`document.activeElement.id`),'personal-prompt-name');
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'   ');personalTest.fill(document.querySelector('#personal-prompt-content'),'   ');personalTest.button('保存提示词').click()`);await sleep(80);
  assert.ok(await run(`document.querySelector('.personal-message').textContent.includes('不能只填空格')`));
  const prompt='  {{soft lighting}}, 1.3::warm colors::\nartist:test  ';
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'  柔和光线  ');personalTest.fill(document.querySelector('#personal-prompt-content'),${JSON.stringify(prompt)});personalTest.button('保存提示词').click()`);await sleep(100);
  assert.equal(await run(`personalTest.stored().items[0].prompt`),prompt);assert.equal(await run(`personalTest.stored().items[0].name`),'柔和光线');
  assert.equal(await run(`personalTest.params()?.prompt||''`),'');
  await run(`personalTest.action('插入','柔和光线').click()`);await sleep(100);
  assert.equal(await run(`personalTest.params().prompt`),prompt.trim());
  assert.ok(!(await run(`personalTest.params().prompt.includes('柔和光线')`)));
  await run(`personalTest.action('插入','柔和光线').click()`);await sleep(100);
  assert.equal(await run(`personalTest.params().prompt`),prompt.trim()+', '+prompt.trim());
  out.ui={createAndNamedInsert:true,rawSaveAndExistingAppend:true};
  await run(`personalTest.action('修改','柔和光线').click()`);await sleep(80);
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'月光方案');personalTest.fill(document.querySelector('#personal-prompt-content'),'moonlight, cool colors');personalTest.button('本地词库').click()`);await sleep(80);
  await run(`personalTest.button('我的提示词').click()`);await sleep(80);
  assert.equal(await run(`document.querySelector('#personal-prompt-name').value`),'月光方案');
  await run(`allowConfirm=false;personalTest.button('＋ 新增提示词').click()`);await sleep(80);
  assert.equal(await run(`document.querySelector('#personal-prompt-name').value`),'月光方案');
  await run(`personalTest.button('保存提示词').click()`);await sleep(100);
  assert.equal(await run(`personalTest.stored().items.length`),1);assert.equal(await run(`personalTest.stored().items[0].name`),'月光方案');
  await run(`personalTest.fill(personalTest.field('搜索我的提示词'),'cool')`);await sleep(80);assert.equal(await run(`document.querySelectorAll('.personal-prompt-card').length`),1);
  await run(`personalTest.fill(personalTest.field('搜索我的提示词'),'no match')`);await sleep(80);assert.equal(await run(`document.querySelectorAll('.personal-prompt-card').length`),0);
  await run(`personalTest.fill(personalTest.field('搜索我的提示词'),'');personalTest.action('替换','月光方案').click()`);await sleep(80);
  assert.ok(await run(`personalTest.params().prompt.includes('soft lighting')`));
  await run(`allowConfirm=true;personalTest.action('替换','月光方案').click()`);await sleep(80);assert.equal(await run(`personalTest.params().prompt`),'moonlight, cool colors');
  out.ui.renameContentSearchAndReplace=true;out.ui.unsavedDraftSurvivesSourceSwitch=true;
  await run(`personalTest.fill(personalTest.field('词库插入目标'),JSON.stringify({kind:'negative'}))`);await sleep(80);
  await run(`personalTest.action('插入','月光方案').click()`);await sleep(80);assert.ok(await run(`personalTest.params().negativePrompt.endsWith('moonlight, cool colors')`));
  await run(`personalTest.button('保存当前框').click()`);await sleep(80);
  assert.equal(await run(`document.querySelector('#personal-prompt-content').value`),await run(`personalTest.params().negativePrompt`));
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'我的负面词');personalTest.button('保存提示词').click()`);await sleep(80);
  await run(`personalTest.button('＋ 角色').click()`);await sleep(80);
  await run(`personalTest.fill(personalTest.field('角色 1 名称'),'小蓝');personalTest.field('角色 1 加入生成').click()`);await sleep(80);
  const charId=await run(`personalTest.params().characters[0].id`);
  for(const negative of [false,true]){
    await run(`personalTest.fill(personalTest.field('词库插入目标'),JSON.stringify({kind:'char',id:${JSON.stringify(charId)},...( ${negative} ? {negative:true}:{} )}))`);await sleep(80);
    await run(`personalTest.action('插入','月光方案').click()`);await sleep(80);
  }
  assert.equal(await run(`personalTest.params().characters[0].caption`),'moonlight, cool colors');assert.equal(await run(`personalTest.params().characters[0].negative`),'moonlight, cool colors');
  assert.equal(await run(`personalTest.params().characters[0].enabled`),false);
  await run(`personalTest.button('删除').click()`);await sleep(80);assert.equal(await run(`personalTest.field('词库插入目标').value`),JSON.stringify({kind:'main'}));
  out.ui.allDestinationsAndDeletedCharacterFallback=true;out.ui.captureSelectedFrame=true;
  // 注入配额/权限错误：不得更新卡片或丢草稿。
  await run(`personalTest.action('修改','月光方案').click()`);await sleep(80);
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'失败后重试');window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='nai_personal_prompts_v1')throw new DOMException('Quota','QuotaExceededError');return savedSetItem.call(this,k,v);};personalTest.button('保存提示词').click()`);await sleep(80);
  assert.equal(await run(`personalTest.stored().items[1].name`),'月光方案');assert.equal(await run(`document.querySelector('#personal-prompt-name').value`),'失败后重试');assert.ok(await run(`document.querySelector('.personal-message').textContent.includes('没有保存成功')`));
  await run(`personalTest.action('删除','我的负面词').click()`);await sleep(80);assert.equal(await run(`personalTest.stored().items.length`),2);
  await run(`Storage.prototype.setItem=savedSetItem;personalTest.button('保存提示词').click()`);await sleep(80);assert.ok(await run(`!!personalTest.action('插入','失败后重试')`));
  await run(`allowConfirm=false;personalTest.action('删除','我的负面词').click()`);await sleep(80);assert.equal(await run(`personalTest.stored().items.length`),2);
  await run(`allowConfirm=true;personalTest.action('删除','我的负面词').click()`);await sleep(80);assert.equal(await run(`personalTest.stored().items.length`),1);
  out.ui.failedSaveAndDeleteRetained=true;out.ui.confirmDeleteAndRetry=true;
  // 外部更新/坏收藏不静默覆盖；重新读取保留编辑草稿。
  await run(`personalTest.action('修改','失败后重试').click()`);await sleep(80);
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'重试后的名称');const d=personalTest.stored();d.items.push({id:'other',name:'另一窗口',prompt:'keep me'});localStorage.setItem('nai_personal_prompts_v1',JSON.stringify(d));personalTest.button('保存提示词').click()`);await sleep(80);
  assert.ok(await run(`document.querySelector('.personal-message').textContent.includes('其他窗口')`));assert.equal(await run(`personalTest.stored().items.length`),2);
  await run(`personalTest.button('重新读取收藏').click()`);await sleep(80);assert.equal(await run(`document.querySelector('#personal-prompt-name').value`),'重试后的名称');
  await run(`personalTest.button('保存提示词').click()`);await sleep(80);assert.equal(await run(`personalTest.stored().items.length`),2);
  await run(`window.goodCollection=localStorage.getItem('nai_personal_prompts_v1');localStorage.setItem('nai_personal_prompts_v1','corrupt');personalTest.button('重新读取收藏').click()`);await sleep(80);
  assert.equal(await run(`personalTest.button('＋ 新增提示词').disabled`),true);assert.equal(await run(`localStorage.getItem('nai_personal_prompts_v1')`),'corrupt');
  await run(`localStorage.setItem('nai_personal_prompts_v1',goodCollection);personalTest.button('重新读取收藏').click()`);await sleep(80);
  out.ui.conflictAndCorruptCollectionRecovery=true;
  // 纯文本卡片不执行内容，长名称及分页可用。
  await run(`personalTest.button('＋ 新增提示词').click()`);await sleep(80);
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'<img src=x onerror=alert(1)>');personalTest.fill(document.querySelector('#personal-prompt-content'),'<script>window.executed=true</script>');personalTest.button('保存提示词').click()`);await sleep(80);
  assert.equal(await run(`document.querySelector('.personal-results img,.personal-results script')===null&&!window.executed`),true);
  await run(`const items=personalTest.stored().items;for(let i=0;i<62;i++)items.push({id:'page-'+i,name:'收藏 '+i,prompt:'plain text '+i});localStorage.setItem('nai_personal_prompts_v1',JSON.stringify({version:1,items}));personalTest.button('重新读取收藏').click()`);await sleep(80);
  assert.equal(await run(`document.querySelectorAll('.personal-prompt-card').length`),60);
  await run(`personalTest.button('再显示 60 条收藏').click()`);await sleep(80);assert.equal(await run(`document.querySelectorAll('.personal-prompt-card').length`),65);
  out.ui.literalTextAndPagination=true;
  // 持久化与截图场景使用少量合成收藏。
  await run(`localStorage.setItem('nai_personal_prompts_v1',JSON.stringify({version:1,items:[{id:'restart',name:'重启测试收藏',prompt:'restart retained'},{id:'lighting',name:'柔和光线',prompt:'{{soft lighting}}, warm colors, detailed background'},{id:'artist',name:'我的风格组合',prompt:'1.3::artist:test::, watercolor, blue palette'}]}));personalTest.button('重新读取收藏').click()`);await sleep(80);
  const reloaded=new Promise(r=>win.webContents.once('did-finish-load',r));win.reload();await reloaded;await sleep(200);await run(helpers);
  await run(`personalTest.button('我的提示词').click()`);await sleep(80);assert.equal(await run(`document.querySelectorAll('.personal-prompt-card').length`),3);out.ui.pageReloadPersisted=true;
  await capture('personal-desktop.png');
  await run(`personalTest.button('＋ 新增提示词').click()`);await sleep(80);
  await run(`personalTest.fill(document.querySelector('#personal-prompt-name'),'我的雨天场景');personalTest.fill(document.querySelector('#personal-prompt-content'),'rainy street, soft reflections, evening light')`);await sleep(80);
  await capture('personal-form-desktop.png');
  win.setMinimumSize(320,480);win.setSize(390,844);await sleep(150);
  await run(`document.querySelectorAll('.workspace-tabs button')[1].click()`);await sleep(150);
  const layout=()=>run(`(()=>{const area=document.querySelector('.personal-results'),footer=document.querySelector('.insert-destination').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,areaHeight:area.clientHeight,areaScroll:area.scrollHeight,footerBottom:footer.bottom,height:innerHeight};})()`);
  out.mobile=await layout();assert.ok(out.mobile.scroll<=out.mobile.width+1);assert.ok(out.mobile.areaHeight>100);assert.ok(out.mobile.footerBottom<=out.mobile.height+1);
  await capture('personal-mobile.png');
  await run(`document.querySelector('.personal-form-actions button').scrollIntoView({block:'center'})`);await sleep(80);
  assert.ok(await run(`document.querySelector('.personal-form-actions button').getBoundingClientRect().bottom<=document.querySelector('.personal-results').getBoundingClientRect().bottom+1`));
  win.setSize(1440,900);win.webContents.setZoomFactor(2);await sleep(200);out.zoom=await layout();
  fs.writeFileSync(path.join(evidence,'layout-observation.json'),JSON.stringify({mobile:out.mobile,zoom:out.zoom},null,2));
  fs.writeFileSync(path.join(evidence,'layout-dom.json'),JSON.stringify(await run(`['.studio-header','.workspace-tabs','.library-pane','.library-panel','.pane-heading','.prompt-collection-switch','.personal-prompts','.personal-tools','.personal-results','.personal-entries','.insert-destination'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e),r=e.getBoundingClientRect();return {s,top:r.top,height:r.height,flex:c.flex,shrink:c.flexShrink,display:c.display,overflow:c.overflow,minHeight:c.minHeight};})`),null,2));
  assert.ok(out.zoom.scroll<=out.zoom.width+1);assert.ok(out.zoom.areaHeight>70);assert.ok(out.zoom.footerBottom<=out.zoom.height+1);
  await run(`document.querySelector('.personal-form-actions button').scrollIntoView({block:'center'})`);await sleep(80);
  assert.ok(await run(`(()=>{const b=document.querySelector('.personal-form-actions button').getBoundingClientRect(),a=document.querySelector('.personal-results').getBoundingClientRect();return b.top>=a.top&&b.bottom<=a.bottom;})()`));
  await capture('personal-zoom200.png');
  // 取消未保存的合成草稿，下一进程只读取已落盘收藏。
  await run(`personalTest.button('取消编辑').click()`);await sleep(80);
  out.pass=true;fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(out,null,2));console.log('[PERSONAL_VERIFY]',JSON.stringify(out));app.quit();
})().catch(e=>{console.error(e);app.exit(1);});
