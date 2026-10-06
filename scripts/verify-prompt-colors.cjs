// 独立目录、合成提示词、阻断外网；不使用真实 API 或系统剪贴板。
const { app } = require('electron');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const evidence=process.env.NAI_VERIFY_EVIDENCE?path.resolve(process.env.NAI_VERIFY_EVIDENCE):path.resolve(__dirname,'../.tavernweave/evidence/prompt-colors');
fs.mkdirSync(evidence,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(evidence,'test-profile-')));
delete process.env.NAI_SELFTEST;delete process.env.VITE_DEV_SERVER_URL;
const ready=new Promise(resolve=>app.once('browser-window-created',(_e,win)=>{
  win.hide();win.webContents.setBackgroundThrottling(false);win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR?path.join(path.resolve(process.env.NAI_VERIFY_ASAR),'electron/main.cjs'):'../electron/main.cjs');
function unitChecks(){
  const module={exports:{}};let preference=null,fail=false;
  const source=stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname,'../src/lib/promptHighlight.ts'),'utf8'),{mode:'transform'}).replace(/^export /gm,'')+'\nmodule.exports={highlightPrompt,normalizePromptTag,loadPromptColors};';
  vm.runInNewContext(source,{module,Set,localStorage:{getItem:()=>{if(fail)throw Error('blocked');return preference;}}});const m=module.exports;
  const classify=(text,name,artists=new Set(),model)=>m.highlightPrompt(text,artists,model).tokens.find(t=>t.text.includes(name));
  assert.equal(classify('{{rain}}','rain').emphasis,'strong');assert.equal(classify('[[rain]]','rain').emphasis,'weak');
  assert.equal(classify('{[rain]}','rain').emphasis,'normal');assert.equal(classify(']rain','rain').emphasis,'strong');assert.equal(classify('}rain','rain').emphasis,'weak');
  assert.equal(classify('1.5::rain, night::','night').emphasis,'strong');assert.equal(classify('0.5::rain::','rain').emphasis,'weak');
  assert.equal(classify('-1::rain::','rain').emphasis,'negative');assert.equal(classify('0::rain::','rain').emphasis,'zero');
  assert.equal(classify('1.5::rain::, snow','snow').emphasis,'normal');assert.equal(classify('{{rain::, snow','snow').emphasis,'normal');
  assert.equal(classify('1.5::artist:misaka_12003-gou::, snow','snow').emphasis,'normal');
  assert.equal(classify('1.5::artist:foo123::, snow','snow').emphasis,'normal');
  assert.equal(classify('context: background','context:').tone,'normal');
  assert.equal(classify('{{1.5::rain::, snow','snow').emphasis,'normal');assert.equal(classify('0.5::{rain}::','rain').emphasis,'weak');
  assert.equal(classify('artist:freng','freng').tone,'artist');const weighted=classify('1.5::artist:freng::','freng');assert.equal(weighted.tone,'artist');assert.equal(weighted.emphasis,'strong');
  assert.equal(classify('yoneyama_mai','mai',new Set(['yoneyama mai'])).tone,'artist');assert.equal(classify('someone_unknown','unknown').tone,'normal');
  for(const name of ['masterpiece','very_aesthetic','rating:general','meta:golden era','year 2024','high complexity','transparent background'])assert.equal(classify(name,name).tone,'function');
  assert.equal(classify('a masterpiece in natural prose','masterpiece').tone,'normal');
  const literal='1girl, Text: "{hello}, -1::artist:name::"\n中文';const t=m.highlightPrompt(literal).tokens.find(t=>t.tone==='text');assert.equal(t.text,'Text: "{hello}, -1::artist:name::"\n中文');assert.equal(t.emphasis,'normal');
  assert.equal(m.highlightPrompt('1.5::rain::',new Set(),'nai-diffusion-3').warnings.length,1);
  assert.equal(m.highlightPrompt('-1::rain::',new Set(),'nai-diffusion-4-full').warnings.length,1);
  assert.equal(m.highlightPrompt('-1::rain::',new Set(),'nai-diffusion-4-5-full').warnings.length,0);
  assert.equal(m.highlightPrompt('Text: hello',new Set(),'nai-diffusion-3').warnings.length,1);
  // 编辑到一半、嵌套符号、Unicode、HTML 形状、随机片段仍必须精确保留每个字符。
  let seed=37;const pieces=['{','}', '[',']','::','0.5::','-2::','Text:','artist:','😀','中文','\n','\t','<script>','"',',','1girl','||'];
  for(let i=0;i<300;i++){let s='';for(let j=0;j<40;j++){seed=(seed*1664525+1013904223)>>>0;s+=pieces[seed%pieces.length];}assert.equal(m.highlightPrompt(s).tokens.map(t=>t.text).join(''),s);}
  assert.equal(m.loadPromptColors(),true);preference='0';assert.equal(m.loadPromptColors(),false);preference='1';assert.equal(m.loadPromptColors(),true);fail=true;assert.equal(m.loadPromptColors(),true);
  return true;
}
(async()=>{
  const win=await ready,run=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(e){console.error('[FAILED_UI_STEP]',s.slice(0,240));throw e;}},results={unit:unitChecks()};
  const capture=async name=>{for(let attempt=0;attempt<3;attempt++){try{fs.writeFileSync(path.join(evidence,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return;}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,200));}}};
  await run(`window.colorsTest={
    sleep:ms=>new Promise(r=>setTimeout(r,ms)),
    wait:async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('colors timeout');},
    button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),
    field:t=>document.querySelector('[aria-label="'+t+'"]'),
    fill:(el,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));},
    root:()=>document.querySelector('#main-prompt').closest('.prompt-textarea'),
    mirror:()=>colorsTest.root().querySelector('.prompt-textarea-content'),
    text:()=>[...colorsTest.mirror().querySelectorAll('span:not(.prompt-mirror-tail)')].map(e=>e.textContent).join(''),
    toggle:()=>document.querySelector('.prompt-color-tools input'),
    sample:'1girl, {{artist:freng}}, [rain], 1.5::black dress::, 0.5::blue eyes::, -1::hat::, 0::logo::, masterpiece, year 2024, rating:general, Text: 你好，世界！'
  };true;`);
  await run(`(async()=>{await colorsTest.wait(()=>document.body.textContent.includes('22,956'));colorsTest.fill(colorsTest.field('提示词（想画什么）'),colorsTest.sample);await colorsTest.sleep(150);})()`);
  results.exactText=await run(`colorsTest.field('提示词（想画什么）').value===colorsTest.sample&&colorsTest.text()===colorsTest.sample`);
  results.weightedArtist=await run(`!!colorsTest.root().querySelector('.prompt-tone-artist.prompt-weight-strong')`);
  results.distinctColors=await run(`(()=>{const q=s=>getComputedStyle(colorsTest.root().querySelector(s));return new Set(['.prompt-tone-artist','.prompt-weight-strong.prompt-tone-normal','.prompt-weight-weak.prompt-tone-normal','.prompt-weight-negative.prompt-tone-normal','.prompt-tone-function','.prompt-tone-text'].map(s=>q(s).color)).size===6&&q('.prompt-tone-artist.prompt-weight-strong').backgroundColor!=='rgba(0, 0, 0, 0)';})()`);
  results.overlay=await run(`getComputedStyle(colorsTest.field('提示词（想画什么）')).webkitTextFillColor==='rgba(0, 0, 0, 0)'&&colorsTest.root().querySelector('.prompt-textarea-mirror').getAttribute('aria-hidden')==='true'`);
  await run(`colorsTest.field('提示词（想画什么）').setSelectionRange(8,35);colorsTest.toggle().click()`);await new Promise(r=>setTimeout(r,80));
  results.toggleSelection=await run(`(()=>{const i=colorsTest.field('提示词（想画什么）');return !colorsTest.root().classList.contains('is-highlighted')&&i.selectionStart===8&&i.selectionEnd===35&&i.value.slice(8,35)===colorsTest.sample.slice(8,35);})()`);
  await run(`colorsTest.toggle().click();colorsTest.field('提示词（想画什么）').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));`);await new Promise(r=>setTimeout(r,80));
  results.compositionFallback=await run(`!colorsTest.root().classList.contains('is-highlighted')&&getComputedStyle(colorsTest.field('提示词（想画什么）')).webkitTextFillColor!=='rgba(0, 0, 0, 0)'`);
  await run(`colorsTest.fill(colorsTest.field('提示词（想画什么）'),colorsTest.sample+' 中文输入');colorsTest.field('提示词（想画什么）').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文输入'}))`);await new Promise(r=>setTimeout(r,100));
  results.compositionEnd=await run(`colorsTest.root().classList.contains('is-highlighted')&&colorsTest.text().endsWith('中文输入')`);
  await run(`(()=>{const i=colorsTest.field('提示词（想画什么）');i.focus();i.setSelectionRange(i.value.length,i.value.length);})()`);
  const beforeType=await run(`colorsTest.field('提示词（想画什么）').value`);
  win.webContents.sendInputEvent({type:'char',keyCode:'X'});await new Promise(r=>setTimeout(r,80));
  assert.equal(await run(`colorsTest.field('提示词（想画什么）').value`),beforeType+'X');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Z',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Z',modifiers:['control']});await new Promise(r=>setTimeout(r,100));
  results.nativeUndo=await run(`colorsTest.field('提示词（想画什么）').value===${JSON.stringify(beforeType)}`);
  await run(`colorsTest.fill(colorsTest.field('提示词（想画什么）'),'<img src=x onerror="window.colorsInjected=true">, {{artist:freng}}')`);await new Promise(r=>setTimeout(r,100));
  results.safeText=await run(`!colorsTest.mirror().querySelector('img')&&!window.colorsInjected&&colorsTest.text()===colorsTest.field('提示词（想画什么）').value`);
  const multiline=Array.from({length:50},(_,i)=>'第 '+i+' 行：{{artist:freng}}, [long rainy scenery], 1.5::风景标签::, yoneyama_mai, \tend').join('\n')+'\n';
  await run(`colorsTest.fill(colorsTest.field('提示词（想画什么）'),${JSON.stringify(multiline)})`);await new Promise(r=>setTimeout(r,150));
  const aligned=await run(`(()=>{const i=colorsTest.field('提示词（想画什么）'),m=colorsTest.root().querySelector('.prompt-textarea-mirror'),cs=getComputedStyle(i),n=getComputedStyle(m),height=colorsTest.mirror().scrollHeight+parseFloat(n.paddingTop)+parseFloat(n.paddingBottom);return {inputHeight:i.scrollHeight,mirrorHeight:height,width:i.clientWidth,mirrorWidth:m.getBoundingClientRect().width,sameFont:cs.fontFamily===n.fontFamily&&cs.fontSize===n.fontSize&&cs.lineHeight===n.lineHeight};})()`);
  assert.ok(Math.abs(aligned.inputHeight-aligned.mirrorHeight)<=2,JSON.stringify(aligned));assert.ok(Math.abs(aligned.width-aligned.mirrorWidth)<=1);assert.equal(aligned.sameFont,true);results.wrapAlignment=true;
  await run(`(()=>{const i=colorsTest.field('提示词（想画什么）');i.scrollTop=350;i.dispatchEvent(new Event('scroll'));i.style.height='210px';})()`);await new Promise(r=>setTimeout(r,100));
  const scrolled=await run(`(()=>{const i=colorsTest.field('提示词（想画什么）'),m=colorsTest.root().querySelector('.prompt-textarea-mirror');return {scroll:i.scrollTop,transform:colorsTest.mirror().style.transform,inputHeight:i.clientHeight,mirrorHeight:m.getBoundingClientRect().height};})()`);
  console.log('[SCROLL_ALIGNMENT]',JSON.stringify(scrolled));
  const translateY=Number(scrolled.transform.match(/, (-?[\d.]+)px\)/)?.[1]);
  results.scrollResize=scrolled.scroll>0&&Math.abs(translateY+scrolled.scroll)<.01&&Math.abs(scrolled.mirrorHeight-scrolled.inputHeight)<1;
  await run(`colorsTest.fill(colorsTest.field('提示词（想画什么）'),'yoneyama_mai, unknown_plain_artist')`);await new Promise(r=>setTimeout(r,100));
  results.libraryArtist=await run(`colorsTest.root().querySelector('.prompt-tone-artist').textContent.includes('yoneyama_mai')&&!colorsTest.root().querySelector('.prompt-tone-artist').textContent.includes('unknown')`);
  await run(`colorsTest.button('＋ 角色').click()`);await new Promise(r=>setTimeout(r,80));
  await run(`colorsTest.fill(colorsTest.field('角色 1 提示词'),'{{artist:freng}}, 1girl');colorsTest.fill(colorsTest.field('负面提示词'),'[bad anatomy], 0.5::artist:freng::');colorsTest.field('角色 1 负面词').closest('details').open=true;colorsTest.fill(colorsTest.field('角色 1 负面词'),'-1::hat::');`);await new Promise(r=>setTimeout(r,100));
  results.allEditors=await run(`['角色 1 提示词','角色 1 负面词','负面提示词'].every(label=>colorsTest.field(label).closest('.prompt-textarea').classList.contains('is-highlighted'))`);
  results.characterMargin=await run(`(()=>{const i=colorsTest.field('角色 1 负面词'),m=i.closest('.prompt-textarea').querySelector('.prompt-textarea-mirror');return Math.abs(m.getBoundingClientRect().top-i.getBoundingClientRect().top-parseFloat(getComputedStyle(i).borderTopWidth))<1;})()`);
  await run(`colorsTest.fill(colorsTest.field('提示词（想画什么）'),'a'.repeat(50001))`);await new Promise(r=>setTimeout(r,100));
  results.longFallback=await run(`!colorsTest.root().classList.contains('is-highlighted')&&colorsTest.field('提示词（想画什么）').value.length===50001&&document.body.textContent.includes('已暂停着色')`);
  await run(`colorsTest.fill(colorsTest.field('提示词（想画什么）'),colorsTest.sample);colorsTest.field('提示词（想画什么）').style.height='200px';colorsTest.field('提示词（想画什么）').scrollTop=0;colorsTest.root().scrollIntoView({block:'center'});document.querySelector('.prompt-color-tools details').open=true;`);await new Promise(r=>setTimeout(r,150));
  await capture('colors-desktop.png');
  await run(`colorsTest.toggle().click()`);const reload=new Promise(r=>win.webContents.once('did-finish-load',r));win.reload();await reload;await new Promise(r=>setTimeout(r,250));
  results.persistedOff=await run(`!document.querySelector('.prompt-color-tools input').checked&&!document.querySelector('.is-highlighted')&&document.querySelector('#main-prompt').value.length>0`);
  await run(`document.querySelector('.prompt-color-tools input').click()`);await new Promise(r=>setTimeout(r,100));results.persistedReenable=await run(`!!document.querySelector('#main-prompt').closest('.is-highlighted')`);
  await run(`window.savedColorSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='nai_prompt_colors_v1')throw Error('blocked');return savedColorSet.call(this,k,v)};document.querySelector('.prompt-color-tools input').click();`);await new Promise(r=>setTimeout(r,100));
  results.preferenceFailure=await run(`document.body.textContent.includes('偏好保存失败')&&!document.querySelector('.prompt-color-tools input').checked&&localStorage.getItem('nai_prompt_colors_v1')==='1'`);
  await run(`Storage.prototype.setItem=savedColorSet;document.querySelector('.prompt-color-tools input').click();document.querySelector('#main-prompt').scrollIntoView({block:'center'});`);
  win.setMinimumSize(320,480);win.setSize(390,844);await new Promise(r=>setTimeout(r,200));
  // 隐藏窗口先绘制新尺寸，确保随后量到的是完成重排的页面。
  await capture('colors-mobile.png');
  await new Promise(r=>setTimeout(r,100));
  const mobile=await run(`(()=>{const i=document.querySelector('#main-prompt'),m=i.closest('.prompt-textarea').querySelector('.prompt-textarea-mirror');return {width:innerWidth,scroll:document.documentElement.scrollWidth,field:i.getBoundingClientRect().width,client:i.clientWidth,mirror:m.getBoundingClientRect().width};})()`);assert.ok(mobile.scroll<=mobile.width+1);assert.ok(Math.abs(mobile.mirror-mobile.client)<=1,JSON.stringify(mobile));results.mobile=mobile;
  await capture('colors-mobile.png');
  win.setSize(1440,900);win.webContents.setZoomFactor(2);await new Promise(r=>setTimeout(r,150));
  results.zoom200=await run(`document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#main-prompt').clientWidth>200`);
  await capture('colors-200-percent.png');
  for(const [k,v]of Object.entries(results))if(k!=='mobile')assert.equal(v,true,k);
  results.pass=true;fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(results,null,2));console.log('[PROMPT_COLORS_VERIFY]',JSON.stringify(results));app.quit();
})().catch(e=>{console.error(e);app.exit(1);});
