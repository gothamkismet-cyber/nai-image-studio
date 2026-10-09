// 合成参数、隔离资料和模拟响应；真实 Electron 界面，不消耗生图额度。
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const evidence = path.resolve(process.env.NAI_VERIFY_EVIDENCE || '.tavernweave/evidence/v5');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'profile-')));
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
const ready = new Promise(resolve => app.once('browser-window-created', (_e, win) => {
  win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
const report = { actualPaidGeneration: false, externalNetwork: false, checks: {} };
function unitChecks() {
  const compile = file => stripTypeScriptTypes(fs.readFileSync(path.join('src', file), 'utf8'), { mode: 'transform' }).replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const module = { exports: {} };
  vm.runInNewContext(['types.ts', 'lib/nai.ts'].map(compile).join('\n') + '\nmodule.exports={normalizeParams,buildPayload,effectiveGenerationParams,characterLimit};', { module });
  const m = module.exports, plain = p => JSON.parse(JSON.stringify(p));
  const char = { id: 'one', name: 'local-only', caption: 'girl', negative: 'hat', positionMode: 'custom', x: .237, y: .719 };
  const p = m.normalizeParams({ model: 'nai-diffusion-5-full-medium', prompt: '1girl, sign “你好”', negativePrompt: 'custom-negative',
    steps: 31, sampler: 'k_euler', noiseSchedule: 'exponential', cfgRescale: .4, characters: [char] });
  const before = JSON.stringify(p), body = m.buildPayload(p), q = body.parameters;
  assert.equal(body.model, 'nai-diffusion-5-full-medium'); assert.equal(q.steps, 14); assert.equal(q.sampler, 'k_euler_ancestral');
  assert.equal(q.noise_schedule, 'karras'); assert.equal(q.cfg_rescale, undefined); assert.equal(q.tag_hint_uc_preset, 2);
  assert.equal(q.characterPrompts[0].uc, ''); assert.ok(!q.negative_prompt.includes('custom-negative')); assert.ok(q.negative_prompt.includes('lowres'));
  assert.equal(q.v4_negative_prompt.caption.base_caption, q.negative_prompt); assert.equal(q.tag_hint_qt, 1);
  assert.equal(body.input, '1girl, sign “你好”, very aesthetic, masterpiece, no text, teXt: 你好');
  assert.equal(q.v4_prompt.caption.base_caption, body.input); assert.equal(JSON.stringify(p), before);
  assert.deepEqual(plain(q.characterPrompts[0].center), { x: .237, y: .719 });
  assert.ok(!JSON.stringify(body).includes('local-only'));
  const alpha = m.buildPayload({ ...p, qualityPreset: 'light', transparentBackground: true }).parameters;
  assert.equal(alpha.straight_alpha, true); assert.equal(alpha.tag_hint_transparent_background, true); assert.equal(alpha.tag_hint_qt, 3);
  const text = m.buildPayload({ ...p, prompt: 'Text: literal “keep me”', qualityToggle: false }).input;
  assert.equal(text, 'Text: literal “keep me”');
  assert.equal(m.buildPayload({ ...p, prompt: 'scene, Text: literal', qualityToggle: true }).input, 'scene, very aesthetic, masterpiece, no text, Text: literal');
  assert.ok(!m.buildPayload({ ...p, autoText: false }).input.includes('teXt:'));
  assert.ok(!m.buildPayload({ ...p, prompt: "girl's hat, don't add text" }).input.includes('teXt:'));
  for (const model of ['nai-diffusion-4-5-full', 'nai-diffusion-4-full', 'nai-diffusion-3']) {
    const old = m.buildPayload({ ...p, model, transparentBackground: true });
    assert.equal(old.input, p.prompt); assert.equal(old.parameters.steps, 31); assert.equal(old.parameters.cfg_rescale, .4);
    assert.equal(old.parameters.negative_prompt, 'custom-negative'); assert.equal(old.parameters.straight_alpha, undefined);
    assert.equal(old.parameters.tag_hint_qt, undefined); assert.equal(old.parameters.noise_schedule, 'exponential');
  }
  const many = Array.from({ length: 40 }, (_, i) => ({ ...char, id: String(i), caption: `person ${i}` }));
  assert.equal(m.normalizeParams({ characters: many }).characters.length, 32);
  assert.equal(m.buildPayload({ ...p, characters: many.slice(0, 32) }).parameters.characterPrompts.length, 32);
  assert.throws(() => m.buildPayload({ ...p, model: 'nai-diffusion-4-5-full', characters: many.slice(0, 7) }), /6/);
  assert.equal(m.buildPayload({ ...p, model: 'nai-diffusion-4-5-full', characters: many.map((c, i) => ({ ...c, enabled: i < 6 })) }).parameters.characterPrompts.length, 6);
  assert.equal(m.characterLimit('nai-diffusion-3'), 0);
  report.unit = { mediumContract: true, draftUnchanged: true, v5QualityAlphaText: true, oldModelsPreserved: true, characterLimits: true };
}
(async () => {
  unitChecks(); const win = await ready, run = code => win.webContents.executeJavaScript(code);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (code, label) => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await sleep(80); } throw Error('Timeout: ' + label); };
  const check = (name, value) => { assert.equal(value, true, name); report.checks[name] = true; };
  const helpers = `window.v5test={
    button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),
    field:t=>document.querySelector('[aria-label="'+t+'"]'),
    fill:(t,v)=>{const el=v5test.field(t),proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));},
    params:()=>JSON.parse(localStorage.getItem('nai_params_v1')),requests:[]};
    window.savedFetch=window.fetch;window.fetch=async(url,opts)=>{
      if(String(url).startsWith('data:'))return savedFetch(url,opts);
      if(url!=='https://image.novelai.net/ai/generate-image')throw Error('external request blocked');
      const body=JSON.parse(opts.body);v5test.requests.push(body);
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
      canvas.getContext('2d').fillRect(4,4,8,8);
      return Response.json({images:[{image:canvas.toDataURL('image/png').split(',')[1],seed:body.parameters.seed}]});
    };void 0;`;
  const reload = async () => { const loaded = new Promise(r => win.webContents.once('did-finish-load', r)); win.reload(); await loaded; await wait(`!!document.querySelector('[aria-label="生成模型"]')`, 'model'); await run(helpers); };
  await run(`localStorage.setItem('nai_token','synthetic-test-only');localStorage.setItem('nai_params_v1',JSON.stringify({model:'nai-diffusion-5-full',prompt:'sign “你好”',negativePrompt:'keep my negative',steps:31,sampler:'k_euler',cfgRescale:.4,seed:123,characters:Array.from({length:7},(_,i)=>({id:String(i),caption:'person '+i,negative:'keep char negative',positionMode:'ai',x:.5,y:.5}))}));`);
  await reload(); await run(`v5test.button('Medium · 省额度').click()`);
  await wait(`v5test.params().model==='nai-diffusion-5-full-medium'`, 'medium');
  check('mediumUIAndDraftRetention', await run(`v5test.field('生成步数').value==='14'&&v5test.field('生成步数').disabled&&v5test.field('采样器').disabled&&v5test.field('对比度修正').disabled&&v5test.field('负面提示词').disabled&&v5test.params().steps===31&&v5test.params().negativePrompt==='keep my negative'`));
  await run(`v5test.button('指定位置').click()`); await wait(`!!v5test.field('角色 1 自由定位')`, 'free coordinates');
  const point = await run(`(()=>{const b=v5test.field('角色 1 自由定位');b.scrollIntoView({block:'center'});const box=b.getBoundingClientRect();return{x:Math.round(box.left+box.width*.23),y:Math.round(box.top+box.height*.71)};})()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  await sleep(100);
  check('pointerPosition', await run(`Math.abs(v5test.params().characters[0].x-.23)<.01&&Math.abs(v5test.params().characters[0].y-.71)<.01`));
  await run(`v5test.field('角色 1 自由定位').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`); await sleep(100);
  check('keyboardPosition', await run(`Math.abs(v5test.params().characters[0].x-.24)<.01`));
  await run(`v5test.fill('V5 质量标签强度','light');document.querySelector('.feature-control input[type="checkbox"]').click()`); await sleep(100);
  await run(`v5test.button('生成').click()`); await wait(`v5test.requests.length===1&&!!v5test.button('生成')`, 'medium generation');
  const req = await run('v5test.requests[0]');
  assert.equal(req.model, 'nai-diffusion-5-full-medium'); assert.equal(req.parameters.steps, 14); assert.equal(req.parameters.characterPrompts.length, 7);
  assert.equal(req.parameters.tag_hint_transparent_background, true); assert.ok(req.input.includes('amazing quality'));
  assert.equal(req.parameters.cfg_rescale, undefined); check('mediumRequestMatchesUI', req.parameters.characterPrompts.every(c => c.uc === ''));
  const history = await run(`new Promise(resolve=>{const r=indexedDB.open('nai-image-studio',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('history'),q=tx.objectStore('history').getAll();tx.oncomplete=()=>{db.close();resolve(q.result.map(h=>h.params));};};})`);
  assert.equal(history[0].steps, 14); assert.equal(history[0].negativePrompt, ''); assert.equal(history[0].qualityPreset, 'light');
  report.checks.historyStoresEffectiveParameters = true;
  await run(`v5test.button('High · 常规').click()`); await sleep(100);
  check('highRestoresOriginalSettings', await run(`v5test.field('生成步数').value==='31'&&!v5test.field('负面提示词').disabled&&v5test.field('负面提示词').value==='keep my negative'`));
  await run(`v5test.fill('生成模型','nai-diffusion-4-5-full')`); await sleep(100); await run(`v5test.button('生成').click()`); await sleep(100);
  check('v4ExcessBlockedWithoutDataLoss', await run(`v5test.params().characters.length===7&&v5test.requests.length===1&&document.body.textContent.includes('最多同时使用 6 个角色')`));
  await run(`v5test.fill('生成模型','nai-diffusion-5-full')`); await sleep(100);
  await reload(); check('v5ReloadPreservesCoordinatesAndFeatures', await run(`v5test.params().characters.length===7&&v5test.params().qualityPreset==='light'&&v5test.params().transparentBackground&&Math.abs(v5test.params().characters[0].x-.24)<.01`));
  await run(`v5test.button('Medium · 省额度').click()`); await sleep(100);
  await run(`document.querySelector('.editor-fields').scrollTop=0;void 0;`);
  await sleep(600);
  fs.writeFileSync(path.join(evidence, 'v5-desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  win.setMinimumSize(320, 480); win.setSize(390, 844); await sleep(200);
  check('mobileNoHorizontalOverflow', await run(`document.documentElement.scrollWidth<=innerWidth+1`));
  fs.writeFileSync(path.join(evidence, 'v5-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  report.pass = true; fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
  console.log('[V5_VERIFY]', JSON.stringify(report)); app.quit();
})().catch(error => { console.error(error); app.exit(1); });
