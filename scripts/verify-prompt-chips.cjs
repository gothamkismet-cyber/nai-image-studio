// 隔离用户资料，使用合成收藏与模拟响应；阻断所有外部请求，不消耗生图额度。
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const evidence = path.resolve(process.env.NAI_VERIFY_EVIDENCE || '.tavernweave/evidence/prompt-chips/final');
fs.mkdirSync(evidence, { recursive: true });
const reduced = process.env.NAI_VERIFY_REDUCED_MOTION === '1';
if (reduced) app.commandLine.appendSwitch('force-prefers-reduced-motion');
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'test-profile-')));
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
const ready = new Promise(resolve => app.once('browser-window-created', (_e, win) => {
  win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
const out = { externalNetwork: false, actualPaidGeneration: false, checks: {} };
function unitChecks() {
  const compile = file => stripTypeScriptTypes(fs.readFileSync(path.resolve('src', file), 'utf8'), { mode: 'transform' }).replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const module = { exports: {} };
  vm.runInNewContext(['types.ts', 'lib/prompt-chips.ts', 'lib/promptlib.ts', 'lib/nai.ts'].map(compile).join('\n') + '\nmodule.exports={normalizeParams,normalizePromptChips,insertPrompt,removePromptChip,replacePromptRange,rebasePromptChips,buildPayload};', { module, crypto: require('node:crypto').webcrypto });
  const m = module.exports, plain = v => JSON.parse(JSON.stringify(v));
  let p = m.normalizeParams({ prompt: '  quiet lake,  ' });
  p = m.insertPrompt(p, { kind: 'main' }, '{{soft light}}, watercolor', 'append', '柔和光线');
  p = m.insertPrompt(p, { kind: 'main' }, '{{soft light}}, watercolor', 'append', '柔和光线');
  assert.equal(p.prompt, 'quiet lake, {{soft light}}, watercolor, {{soft light}}, watercolor');
  assert.equal(p.promptChips.length, 2); assert.notEqual(p.promptChips[0].id, p.promptChips[1].id);
  for (const index of [0, 1]) {
    const result = m.removePromptChip(p.prompt, p.promptChips, p.promptChips[index].id);
    assert.equal(result.value, 'quiet lake, {{soft light}}, watercolor');
    assert.equal(result.chips[0].id, p.promptChips[1 - index].id);
    assert.deepEqual(plain(m.normalizePromptChips(result.value, result.chips)), plain(result.chips));
  }
  let trio = m.normalizeParams({ prompt: '' });
  for (const text of ['one', 'two', 'three']) trio = m.insertPrompt(trio, { kind: 'main' }, text, 'append', '同名');
  for (let i = 0; i < 3; i++) assert.equal(m.removePromptChip(trio.prompt, trio.promptChips, trio.promptChips[i].id).value, ['one', 'two', 'three'].filter((_t, j) => j !== i).join(', '));
  const edit = m.replacePromptRange(trio.prompt, trio.promptChips, 3, 5, ', 手写😀, ');
  assert.equal(edit.value, 'one, 手写😀, two, three'); assert.equal(edit.chips.length, 3);
  const changed = 'ONE, two, three', rebased = m.rebasePromptChips(trio.prompt, changed, trio.promptChips);
  assert.equal(rebased.length, 2); assert.equal(rebased[0].name, '同名');
  const last = m.insertPrompt(m.normalizeParams({}), { kind: 'main' }, '单独😀', 'replace', '风景');
  assert.equal(m.removePromptChip(last.prompt, last.promptChips, last.promptChips[0].id).value, '');
  const broken = m.normalizeParams({ prompt: 'old, plain text', promptChips: [{ id: 'bad', name: '错误', start: 0, end: 3, text: 'not' }, null] });
  assert.equal(broken.prompt, 'old, plain text'); assert.equal(broken.promptChips, undefined);
  const old = m.normalizeParams({ prompt: 'old, plain text' }); assert.equal(old.prompt, broken.prompt);
  const roundTrip = m.normalizeParams(plain(trio)); assert.deepEqual(plain(roundTrip.promptChips), plain(trio.promptChips));
  const replaced = m.insertPrompt(trio, { kind: 'main' }, 'vision result', 'replace'); assert.equal(replaced.promptChips.length, 0);
  const empty = m.insertPrompt(trio, { kind: 'main' }, ' ', 'append', 'empty'); assert.equal(empty, trio);
  for (const text of ['lowres, artifacts,', ', lowres, artifacts, ', '  lowres,\nartifacts  ', ',, lowres,,']) {
    const sample = m.insertPrompt(m.normalizeParams({prompt:'original text'}), {kind:'main'}, text, 'append', '带标点');
    assert.equal(m.removePromptChip(sample.prompt,sample.promptChips,sample.promptChips[0].id).value, 'original text');
    const appended = m.insertPrompt(sample,{kind:'main'},'next','append','下一段');
    assert.equal(appended.promptChips.length,2); assert.equal(appended.promptChips[0].name,'带标点');
    assert.equal(m.removePromptChip(appended.prompt,appended.promptChips,appended.promptChips[0].id).value,'original text, next');
  }
  const payload = m.buildPayload(trio); assert.equal(payload.input, trio.prompt + ', very aesthetic, masterpiece, no text'); assert.ok(!JSON.stringify(payload).includes('同名')); assert.ok(!JSON.stringify(payload).includes('Chips'));
  // Unicode、换行、权重与标点在多次添加、逐个删除后仍保持各自快照。
  for (const text of ['😀, 日本語, 中文', '1.3::artist:sample::, [rain]', 'Text: "hello, world"\nnight', '<img src=x onerror=alert(1)>', ', trailing, ']) {
    let sample = m.insertPrompt(m.normalizeParams({ prompt: '' }), { kind: 'main' }, text, 'replace', '名称');
    sample = m.insertPrompt(sample, { kind: 'main' }, 'next', 'append', '下一段');
    const result = m.removePromptChip(sample.prompt, sample.promptChips, sample.promptChips[0].id);
    assert.equal(result.chips.length, 1); assert.equal(result.value.slice(result.chips[0].start, result.chips[0].end), 'next');
  }
  return { duplicateIdentity: true, firstMiddleLastRemoval: true, mixedTextAndUnicode: true, ownedPunctuationRemoved: true, damagedMetadataFallback: true, oldDataCompatible: true, payloadTextOnly: true };
}
(async () => {
  const win = await ready, run = async s => { try { return await win.webContents.executeJavaScript(s); } catch (e) { console.error('[FAILED_CHIP_STEP]', s.slice(0, 400)); throw e; } }, sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (s, label) => { for (let i = 0; i < 100; i++) { if (await run(s)) return; await sleep(80); } throw Error('Timeout: ' + label); };
  const check = (key, value) => { assert.equal(value, true, key); out.checks[key] = true; };
  const act = async code => { await run(code + ';void 0;'); await sleep(80); };
  const capture = async name => { for (let i = 0; i < 3; i++) { try { fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); return; } catch (e) { if (i === 2) throw e; await sleep(200); } } };
  await wait(`!!document.querySelector('#main-prompt')`, 'editor ready');
  out.motion = await run(`({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, header: getComputedStyle(document.querySelector('.studio-header')).animationName, workspace: getComputedStyle(document.querySelector('.studio-workspace')).animationName, duration: getComputedStyle(document.querySelector('.studio-workspace')).animationDuration, pointer: getComputedStyle(document.querySelector('.studio-workspace')).pointerEvents })`);
  if (reduced) {
    check('reducedMotionDisablesEntrance', out.motion.reduced && out.motion.header === 'none' && out.motion.workspace === 'none');
  } else {
    check('entranceIsBriefAndInteractive', out.motion.header === 'studio-enter' && out.motion.workspace === 'studio-enter' && parseFloat(out.motion.duration) <= .6 && out.motion.pointer !== 'none');
    // 直接检查动画中间帧和结束帧，避免隐藏窗口的帧节流影响判断。
    out.entranceFrames = await run(`(() => { const e = document.querySelector('.studio-workspace'), a = e.getAnimations()[0]; if (!a) return null; a.pause(); a.currentTime = 160; const mid = {opacity: Number(getComputedStyle(e).opacity), transform:getComputedStyle(e).transform}; a.finish(); return {mid, endOpacity: Number(getComputedStyle(e).opacity), endTransform:getComputedStyle(e).transform}; })()`);
    if (out.entranceFrames) check('animationInterpolatesAndFinishes', out.entranceFrames.mid.opacity > 0 && out.entranceFrames.mid.opacity < 1 && out.entranceFrames.endOpacity === 1 && out.entranceFrames.endTransform === 'none');
  }
  if (!reduced) {
    out.unit = unitChecks();
    const fixtures = [{ id: 'light', name: '柔和光线', prompt: '{{soft lighting}}, warm colors' }, { id: 'palette', name: '低饱和色调', prompt: 'muted palette, watercolor' }, { id: 'negative', name: '排除杂点', prompt: 'noise, artifacts' }];
    const helpers = `window.chipTest={
      button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),
      field:t=>document.querySelector('[aria-label="'+t+'"]'),
      fill:(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},
      params:()=>JSON.parse(localStorage.getItem('nai_params_v1')), main:()=>document.querySelector('[aria-label="提示词（想画什么）标签编辑器"]'),
      insert:name=>document.querySelector('[aria-label="插入提示词：'+name+'"]'),
      requests:[], history:()=>new Promise((resolve,reject)=>{const r=indexedDB.open('nai-image-studio',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('history'),req=tx.objectStore('history').getAll();tx.oncomplete=()=>{db.close();resolve(req.result.map(h=>h.params));};};})
    };window.confirm=()=>true;window.realFetch=window.fetch;
    window.fetch=async(url,options)=>{if(String(url).startsWith('data:'))return realFetch(url,options);if(url!=='https://image.novelai.net/ai/generate-image')throw Error('External request blocked');const request=JSON.parse(options.body);chipTest.requests.push(request);const c=document.createElement('canvas');c.width=16;c.height=16;c.getContext('2d').fillRect(0,0,16,16);return Response.json({images:[{image:c.toDataURL('image/png').split(',')[1],seed:request.parameters.seed}]});};void 0;`;
    const reload = async () => { const loaded = new Promise(r => win.webContents.once('did-finish-load', r)); win.reload(); await loaded; await wait(`!!document.querySelector('#main-prompt')`, 'reload'); await run(helpers); };
    await act(`localStorage.setItem('nai_params_v1',JSON.stringify({prompt:'quiet lake',negativePrompt:'',seed:null}));localStorage.setItem('nai_token','synthetic-test-only');localStorage.setItem('nai_personal_prompts_v1',${JSON.stringify(JSON.stringify({ version: 1, items: fixtures }))})`);
    await reload(); await act(`chipTest.button('我的提示词').click()`);
    for (const name of ['柔和光线', '低饱和色调', '柔和光线']) await act(`chipTest.insert(${JSON.stringify(name)}).click()`);
    const initial = await run('chipTest.params()');
    check('namedChipsHideFullText', await run(`chipTest.main().querySelectorAll('.prompt-chip').length===3&&[...chipTest.main().querySelectorAll('textarea')].every(e=>!e.value.includes('soft lighting'))&&chipTest.params().prompt==='quiet lake, {{soft lighting}}, warm colors, muted palette, watercolor, {{soft lighting}}, warm colors'`));
    await act(`chipTest.main().querySelectorAll('.prompt-chip-remove')[1].click()`);
    check('removeOnlySelectedAndKeepCollection', await run(`chipTest.params().promptChips.length===2&&!chipTest.params().prompt.includes('muted palette')&&JSON.parse(localStorage.getItem('nai_personal_prompts_v1')).items.length===3`));
    await act(`chipTest.field('撤销删除提示词（想画什么）标签').click()`);
    assert.deepEqual(await run('chipTest.params()'), initial); out.checks.undoRestoresExactTextAndIdentity = true;
    await act(`chipTest.main().querySelector('.prompt-chip-name').click()`);
    check('detailShowsInsertedSnapshot', await run(`chipTest.main().querySelector('.prompt-chip-details pre').textContent==='{{soft lighting}}, warm colors'`));
    await act(`chipTest.field('关闭标签内容：柔和光线').click();chipTest.fill(chipTest.field('提示词（想画什么）'),'calm reflections')`);
    check('typingAlongsideChipsPreservesThem', await run(`chipTest.params().prompt.endsWith(', calm reflections')&&chipTest.params().promptChips.length===3`));
    await act(`chipTest.fill(chipTest.field('提示词（想画什么）（标签前文字 1）'),'wide lake, ')`);
    check('prefixEditRebasesChips', await run(`chipTest.params().prompt.startsWith('wide lake, {{soft lighting}}')&&chipTest.params().promptChips.every(c=>chipTest.params().prompt.slice(c.start,c.end)===c.text)`));
    await act(`const i=chipTest.field('提示词（想画什么）');i.focus();i.setSelectionRange(i.value.length,i.value.length);i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
    check('nativeIMEStillAvailable', await run(`!chipTest.field('提示词（想画什么）').closest('.prompt-textarea').classList.contains('is-highlighted')`));
    await act(`chipTest.field('提示词（想画什么）').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}))`);
    const beforeTyping = await run('chipTest.params().prompt');
    // 先等上一轮删除标签的延后聚焦结束，再明确把原生输入送到末尾编辑框。
    await sleep(80);
    await act(`const input=chipTest.field('提示词（想画什么）');input.focus();input.setSelectionRange(input.value.length,input.value.length)`);
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'X' }); await sleep(100);
    assert.equal(await run('chipTest.params().prompt'), beforeTyping + 'X');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] }); await sleep(100);
    check('nativeTextUndoPreservesChips', await run(`chipTest.params().prompt===${JSON.stringify(beforeTyping)}&&chipTest.params().promptChips.length===3`));
    // 收藏修改和删除不能悄悄改变已经插入的内容。
    await act(`chipTest.field('修改提示词：柔和光线').click()`);
    await act(`chipTest.fill(document.querySelector('#personal-prompt-name'),'新的光线');chipTest.fill(document.querySelector('#personal-prompt-content'),'changed library text');chipTest.button('保存提示词').click()`);
    await act(`chipTest.field('删除提示词：新的光线').click()`);
    check('collectionChangesDoNotMutateInsertedContent', await run(`chipTest.params().prompt===${JSON.stringify(beforeTyping)}&&chipTest.params().promptChips[0].name==='柔和光线'`));
    await act(`chipTest.field('编辑提示词（想画什么）全文').click()`);
    await act(`chipTest.fill(chipTest.field('提示词（想画什么）'),chipTest.params().prompt.replace('muted palette','bright palette'))`);
    check('editingOneSnapshotUnfoldsOnlyIt', await run(`chipTest.params().promptChips.length===2&&chipTest.params().promptChips.every(c=>c.name==='柔和光线')`));
    await act(`chipTest.field('收起提示词（想画什么）全文').click()`);
    await act(`chipTest.main().querySelector('.prompt-chip-name').click()`);
    const beforeUnfold = await run('chipTest.params().prompt');
    await act(`chipTest.button('展开为文字').click()`);
    check('unfoldDoesNotChangeFullText', await run(`chipTest.params().prompt===${JSON.stringify(beforeUnfold)}&&chipTest.params().promptChips.length===1`));
    // 全部目标的生成请求使用完整内容，停用角色保留在本地。
    await act(`chipTest.fill(chipTest.field('词库插入目标'),JSON.stringify({kind:'negative'}))`); await act(`chipTest.insert('排除杂点').click()`);
    await act(`chipTest.button('＋ 角色').click()`);
    const charId = await run('chipTest.params().characters[0].id');
    for (const negative of [false, true]) { await act(`chipTest.fill(chipTest.field('词库插入目标'),${JSON.stringify(JSON.stringify({kind:'char',id:charId,...(negative ? {negative:true}: {})}))})`); await act(`chipTest.insert(${JSON.stringify(negative ? '排除杂点' : '低饱和色调')}).click()`); }
    const four = await run('chipTest.params()');
    check('fourTargetsHaveChips', four.promptChips.length === 1 && four.negativePromptChips.length === 1 && four.characters[0].captionChips.length === 1 && four.characters[0].negativeChips.length === 1);
    const generate = async () => { const n = await run('chipTest.requests.length'); await act(`chipTest.button('生成').click()`); await wait(`chipTest.requests.length===${n + 1}&&!!chipTest.button('生成')&&document.querySelectorAll('img[alt="历史图片"]').length===${n + 1}`, 'mock generation saved'); };
    await generate(); const req = await run('chipTest.requests[0]');
    assert.equal(req.input, four.prompt + ', very aesthetic, masterpiece, no text'); assert.equal(req.parameters.negative_prompt, four.negativePrompt); assert.equal(req.parameters.characterPrompts[0].prompt, four.characters[0].caption); assert.equal(req.parameters.characterPrompts[0].uc, four.characters[0].negative);
    check('requestHasFullTextNotNames', !JSON.stringify(req).includes('Chips') && !JSON.stringify(req).includes('柔和光线') && !JSON.stringify(req).includes('低饱和色调'));
    await act(`chipTest.field('角色 1 加入生成').click()`); await generate();
    check('disabledCharacterRetainsChipsButIsNotSent', await run(`chipTest.requests[1].parameters.characterPrompts.length===0&&chipTest.params().characters[0].captionChips.length===1&&chipTest.params().seed===null`));
    const saved = await run('chipTest.params()');
    await reload(); assert.deepEqual(await run('chipTest.params()'), saved);
    check('reloadPreservesAllChips', await run(`chipTest.main().querySelectorAll('.prompt-chip').length===1`));
    await act(`document.querySelector('button[aria-label^="查看历史图片"]').click()`);
    await act(`chipTest.main().querySelector('.prompt-chip-remove').click()`); assert.equal(await run('chipTest.params().promptChips.length'), 0);
    await act(`chipTest.button('载入参数').click()`);
    check('historyLoadRestoresChips', await run(`chipTest.params().promptChips.length===1&&chipTest.params().characters[0].captionChips.length===1&&chipTest.params().prompt===${JSON.stringify(saved.prompt)}`));
    // 最后一个标签删除可撤销；键盘可直接触发名称和删除按钮。
    await capture('before-keyboard.png');
    await sleep(100);
    await act(`chipTest.main().querySelector('.prompt-chip-remove').focus()`);
    assert.equal(await run(`document.activeElement.classList.contains('prompt-chip-remove')`), true, 'delete button focused');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); await sleep(120);
    check('keyboardRemoveLastChip', await run(`chipTest.params().promptChips.length===0&&!!chipTest.field('撤销删除提示词（想画什么）标签')`));
    await act(`chipTest.field('撤销删除提示词（想画什么）标签').click()`);
    // 长名称只折叠显示，不撑出边界；内容作为纯文本渲染。
    await act(`localStorage.setItem('nai_personal_prompts_v1',JSON.stringify({version:1,items:[{id:'long',name:'很长的提示词名称'.repeat(10),prompt:'<img src=x onerror="window.chipInjected=true">'},{id:'light',name:'柔和光线',prompt:'{{soft lighting}}, warm colors'}]}));chipTest.button('我的提示词').click()`);
    await act(`chipTest.button('重新读取收藏').click()`);
    await act(`chipTest.fill(chipTest.field('词库插入目标'),JSON.stringify({kind:'main'}))`);
    await act(`chipTest.insert('很长的提示词名称'.repeat(10)).click()`);
    await act(`chipTest.main().querySelectorAll('.prompt-chip-name')[1].click()`);
    check('literalDetailCannotExecuteMarkup', await run(`!window.chipInjected&&!chipTest.main().querySelector('.prompt-chip-details img')&&chipTest.main().querySelector('.prompt-chip-details pre').textContent.includes('<img')`));
    await act(`chipTest.field('关闭标签内容：'+'很长的提示词名称'.repeat(10)).click()`);
    // 留下简洁可审阅的合成场景，动画此时已结束。
    await act(`chipTest.field('替换提示词：柔和光线').click()`); await act(`chipTest.insert('很长的提示词名称'.repeat(10)).click()`);
    await act(`document.querySelector('.editor-fields').scrollTop=0`); await capture('chips-desktop.png');
    win.setMinimumSize(320, 480); win.setSize(390, 844); await act(`document.querySelector('.workspace-tabs button:first-child').click()`);
    await capture('chips-mobile.png'); await sleep(100);
    const layout = () => run(`(()=>{const root=chipTest.main(),s=root.querySelector('.prompt-editor-surface'),r=s.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,frameWidth:r.width,chipRight:Math.max(...[...root.querySelectorAll('.prompt-chip')].map(c=>c.getBoundingClientRect().right)),frameRight:r.right,minDelete:Math.min(...[...root.querySelectorAll('.prompt-chip-remove')].map(c=>c.getBoundingClientRect().width)),inputWidth:root.querySelector('textarea').clientWidth};})()`);
    out.mobile = await layout(); check('mobileChipsFitAndDeleteIsReachable', out.mobile.scroll <= out.mobile.width + 1 && out.mobile.chipRight <= out.mobile.frameRight && out.mobile.minDelete >= 36 && out.mobile.inputWidth > 180);
    win.setSize(1440, 900); win.webContents.setZoomFactor(2); await sleep(200); await capture('chips-zoom200.png'); out.zoom200 = await layout();
    check('zoom200ChipsFit', out.zoom200.scroll <= out.zoom200.width + 1 && out.zoom200.chipRight <= out.zoom200.frameRight && out.zoom200.inputWidth > 180);
  }
  out.pass = true; fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(out, null, 2)); console.log('[CHIPS_VERIFY]', JSON.stringify(out)); app.quit();
})().catch(e => { out.pass = false; out.error = e.stack; fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(out, null, 2)); console.error(e); app.exit(1); });
