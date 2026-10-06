// 独立测试资料与合成凭据，阻断外网；通过真实 Electron 界面检查请求和持久化。
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const evidence = path.resolve(process.env.NAI_VERIFY_EVIDENCE || '.tavernweave/evidence/seed-random/final');
const legacy = process.env.NAI_VERIFY_EXPECT_LEGACY === '1';
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'test-profile-')));
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
  win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
const out = { legacy, actualPaidGeneration: false, externalNetwork: false, checks: {} };
(async () => {
  const win = await ready, run = code => win.webContents.executeJavaScript(code);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (code, label) => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await sleep(80); } throw Error('Timeout: ' + label); };
  const helpers = `window.seedTest = {
    button: text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text),
    field: () => document.querySelector('[aria-label="Seed（留空随机）"]'),
    fill: value => { const el = seedTest.field(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); },
    params: () => JSON.parse(localStorage.getItem('nai_params_v1')),
    history: () => new Promise((resolve, reject) => { const open = indexedDB.open('nai-image-studio', 1); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result, tx = db.transaction('history'), req = tx.objectStore('history').getAll(); tx.oncomplete = () => { db.close(); resolve(req.result.map(h => ({ seed: h.params.seed, prompt: h.params.prompt, demo: !!h.demo }))); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; }),
    requests: [], images: [], hold: false, fail: false, returnedSeed: null
  };
  window.realFetch = window.fetch;
  let randomCalls = 0; Math.random = () => (++randomCalls % 997 + 1) / 1000;
  window.fetch = async (url, options) => {
    if (String(url).startsWith('data:')) return realFetch(url, options);
    if (url !== 'https://image.novelai.net/ai/generate-image') throw Error('External request blocked');
    const body = JSON.parse(options.body); seedTest.requests.push(body);
    if (seedTest.hold) await new Promise((resolve, reject) => { seedTest.release = resolve; options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
    if (seedTest.fail) return Response.json({ message: 'Synthetic failure' }, { status: 500 });
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const ctx = c.getContext('2d'), seed = seedTest.returnedSeed ?? body.parameters.seed;
    ctx.fillStyle = '#' + (seed % 0xffffff).toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 16, 16);
    const image = c.toDataURL('image/png').split(',')[1]; seedTest.images.push(image);
    return Response.json({ images: [{ image, seed }] });
  }; void 0;`;
  const reload = async () => { const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve)); win.reload(); await loaded; await wait(`!!document.querySelector('[aria-label="Seed（留空随机）"]')`, 'seed editor'); await run(helpers); };
  const check = (name, value) => { assert.equal(value, true, name); out.checks[name] = true; };
  const setSeed = async value => { await run(`seedTest.fill(${JSON.stringify(value)})`); await wait(`seedTest.field().value === ${JSON.stringify(value)}`, 'edit seed'); await sleep(50); };
  const randomMode = async () => { await run(`seedTest.button('每次随机').click()`); await wait(`seedTest.params().seed === null && seedTest.field().value === ''`, 'random mode'); };
  const state = () => run(`({ editor: seedTest.field().value, stored: seedTest.params().seed })`);
  const generate = async () => { const before = await run('seedTest.requests.length'); await run(`seedTest.button('生成').click()`); await wait(`seedTest.requests.length === ${before + 1} && !!seedTest.button('生成')`, 'generate complete'); };
  const capture = async name => { for (let i = 0; i < 3; i++) { try { fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); return; } catch (error) { if (i === 2) throw error; await sleep(200); } } };

  await run(`localStorage.setItem('nai_token', 'synthetic-test-only'); localStorage.setItem('nai_params_v1', JSON.stringify({prompt: '1girl, silver hair, outdoors', seed: null}));`);
  await reload(); await generate(); await generate();
  const requests = await run('seedTest.requests');
  out.consecutive = { seeds: requests.map(r => r.parameters.seed), ...(await state()), sameMockImage: await run('seedTest.images[0] === seedTest.images[1]') };
  if (legacy) {
    check('oldVersionPinsRandomSeed', out.consecutive.editor !== '' && out.consecutive.seeds[0] === out.consecutive.seeds[1] && out.consecutive.sameMockImage);
  } else {
    check('eachRequestRandom', out.consecutive.seeds[0] !== out.consecutive.seeds[1] && !out.consecutive.sameMockImage);
    check('randomStaysEmpty', out.consecutive.editor === '' && out.consecutive.stored === null);
    const withoutSeed = request => { const clone = structuredClone(request); delete clone.parameters.seed; return clone; };
    assert.deepEqual(withoutSeed(requests[0]), withoutSeed(requests[1])); out.checks.samePromptAndOtherParameters = true;
    assert.deepEqual((await run('seedTest.history()')).map(h => h.seed).sort(), [...out.consecutive.seeds].sort()); out.checks.historyStoresActualSeeds = true;
    await reload(); check('randomSurvivesReload', (await state()).stored === null && (await state()).editor === '');

    // 旧版留下的数值不能与用户手动固定的数值区分，保持数值并提供显式恢复入口。
    await setSeed('314159'); await reload();
    check('existingFixedSeedPreserved', (await state()).stored === 314159 && await run(`document.querySelector('#seed-help').textContent.includes('固定')`));
    await randomMode(); check('recoverRandomMode', await run(`seedTest.button('每次随机').getAttribute('aria-pressed') === 'true'`));
    await generate(); check('recoveredRandomStaysEmpty', (await state()).stored === null);

    for (const fixed of [0, 4294967295]) {
      await setSeed(String(fixed)); await generate(); await generate();
      const pair = await run('seedTest.requests.slice(-2).map(r => r.parameters.seed)');
      check('fixedSeed' + fixed, pair.every(seed => seed === fixed) && (await state()).stored === fixed);
    }
    await setSeed('42'); await run('seedTest.returnedSeed = 8675309;'); await generate();
    check('serverSeedSavedWithoutChangingEditor', (await state()).stored === 42 && (await run('seedTest.history()')).some(h => h.seed === 8675309));
    await run(`seedTest.button('载入参数').click()`); await wait(`seedTest.params().seed === 8675309`, 'history restore');
    check('historyRestoreExplicitlyFixesSeed', (await state()).editor === '8675309');
    await randomMode(); await run('seedTest.returnedSeed = 1234567;'); await generate();
    check('serverSeedKeepsRandomMode', (await state()).stored === null && (await run('seedTest.history()')).some(h => h.seed === 1234567));

    await run('seedTest.returnedSeed = null; seedTest.hold = true;');
    let count = await run('seedTest.requests.length'); await run(`seedTest.button('生成').click()`); await wait(`seedTest.requests.length === ${count + 1}`, 'held request');
    await setSeed('73'); await run('seedTest.release(); seedTest.hold = false;'); await wait(`!!seedTest.button('生成')`, 'held result');
    check('newSeedDuringRequestPreserved', (await state()).stored === 73);
    await run('seedTest.hold = true;'); count = await run('seedTest.requests.length');
    await run(`seedTest.button('生成').click()`); await wait(`seedTest.requests.length === ${count + 1}`, 'held fixed request');
    await randomMode(); await run('seedTest.release(); seedTest.hold = false;'); await wait(`!!seedTest.button('生成')`, 'held fixed result');
    check('randomSwitchDuringRequestPreserved', (await state()).stored === null);

    const historyCount = (await run('seedTest.history()')).length;
    await run('seedTest.fail = true;'); await generate();
    check('failedRequestKeepsRandom', (await state()).stored === null && await run(`document.querySelector('[role="alert"]').textContent.includes('HTTP 500')`));
    await run('seedTest.fail = false; seedTest.hold = true;'); count = await run('seedTest.requests.length');
    await run(`seedTest.button('生成').click()`); await wait(`seedTest.requests.length === ${count + 1}`, 'cancel request');
    await run(`seedTest.button('取消生成').click()`); await wait(`!!seedTest.button('生成')`, 'cancel complete');
    check('cancelKeepsRandom', (await state()).stored === null && await run(`document.querySelector('[role="alert"]').textContent.includes('已取消')`));
    check('failedAndCancelledNotSaved', (await run('seedTest.history()')).length === historyCount);
    await run('seedTest.hold = false;'); await generate(); check('retryStillRandom', (await state()).stored === null);

    await run(`document.querySelector('[aria-label="换一个固定 Seed"]').click()`); await sleep(80);
    const rolled = (await state()).stored; await generate();
    check('diceExplicitlyFixesSeed', Number.isInteger(rolled) && (await state()).stored === rolled && await run('seedTest.requests.at(-1).parameters.seed') === rolled);
    await randomMode(); await reload(); check('randomAndHistorySurviveReload', (await state()).stored === null && (await run('seedTest.history()')).length === historyCount + 2);
    await run(`[...document.querySelectorAll('input[type="checkbox"]')].find(el => el.closest('label')?.textContent.includes('演示模式')).click()`); await sleep(80);
    for (let i = 0; i < 2; i++) { const before = (await run('seedTest.history()')).length; await run(`seedTest.button('生成').click()`); await wait(`!!seedTest.button('生成') && document.querySelectorAll('img[alt="历史图片"]').length === ${before + 1}`, 'demo generate'); }
    const demos = (await run('seedTest.history()')).filter(h => h.demo);
    check('demoAlsoStaysRandom', demos.length === 2 && demos[0].seed !== demos[1].seed && (await state()).stored === null);

    // 隐藏窗口的合成帧可能停在动画首帧；截图禁用动效，检查完整静态布局。
    await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
    out.screenshotAnimationsDisabled = true;
    await run(`seedTest.field().scrollIntoView({ block: 'center' })`); await sleep(200); await capture('seed-desktop.png');
    win.setMinimumSize(320, 480); win.setSize(390, 844); await sleep(200);
    await run(`document.querySelector('.workspace-tabs button:first-child').click()`);
    await wait(`getComputedStyle(document.querySelector('.editor-pane')).display !== 'none'`, 'mobile editor tab');
    await run(`seedTest.field().scrollIntoView({ block: 'center' })`); await sleep(160);
    const layout = () => run(`(() => { const f = seedTest.field().getBoundingClientRect(), b = seedTest.button('每次随机').getBoundingClientRect(), pane = document.querySelector('.editor-fields').getBoundingClientRect(), help = document.querySelector('#seed-help').getBoundingClientRect(); return { width: innerWidth, scroll: document.documentElement.scrollWidth, fieldWidth: f.width, controlRight: b.right, controlHeight: b.height, help: help.height, visible: f.top >= pane.top && b.bottom <= pane.bottom && help.bottom <= pane.bottom }; })()`);
    out.mobile = await layout(); check('mobileControlsUsable', out.mobile.scroll <= out.mobile.width + 1 && out.mobile.fieldWidth >= 80 && out.mobile.controlRight < out.mobile.width && out.mobile.controlHeight >= 36 && out.mobile.help > 0 && out.mobile.visible);
    await capture('seed-mobile.png');
    win.setSize(1440, 900); win.webContents.setZoomFactor(2); await sleep(200);
    await run(`seedTest.field().scrollIntoView({ block: 'center' })`); out.zoom200 = await layout();
    check('zoom200ControlsUsable', out.zoom200.scroll <= out.zoom200.width + 1 && out.zoom200.fieldWidth >= 80 && out.zoom200.controlRight < out.zoom200.width && out.zoom200.visible);
    await capture('seed-zoom200.png');
  }
  out.pass = true;
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(out, null, 2));
  console.log('[SEED_VERIFY]', JSON.stringify(out)); app.quit();
})().catch(error => { out.pass = false; out.error = error.stack; fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(out, null, 2)); console.error(error); app.exit(1); });
