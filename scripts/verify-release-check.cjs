// 新版查询和英文安装包兼容：仅合成 GitHub 响应和安装器，不打开外部网页或执行安装。
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const evidence = path.resolve(process.env.NAI_VERIFY_EVIDENCE || '.tavernweave/evidence/release-check');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(evidence, 'profile-')));
// 脚本启动的运行器版本与产品版本不同，按待验证源码模拟产品元信息。
app.getVersion = () => JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
const updates = require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/updates.cjs') : '../electron/updates.cjs');
const url = 'https://github.com/gothamkismet-cyber/nai-image-studio';
const fixture = { tag_name: 'v0.2.13', html_url: url + '/releases/tag/v0.2.13', draft: false, prerelease: false,
  published_at: '2026-10-09T01:00:00Z', body: 'Synthetic release notes <script>not executed</script>',
  assets: [{ name: 'NAI-Image-Studio-Setup-0.2.13.exe' }, { name: 'NAI-Image-Studio-Setup-0.2.13.exe.sha256' }] };
const pageFixture = `<html><head><meta content="/gothamkismet-cyber/nai-image-studio/releases/tag/v0.2.13" property="og:url"></head></html>`;
let calls = [], opened = [], responseStatus = 200, hold = false, release, pageFallback = false;
const fetchRelease = async (input, options) => {
  calls.push({ url: input, headers: options.headers, redirect: options.redirect, credentials: options.credentials, body: options.body });
  if (hold) await new Promise(r => release = r);
  if (pageFallback && input === url + '/releases/latest') return new Response(pageFixture);
  return Response.json(fixture, { status: responseStatus });
};
const originalRegister = updates.registerUpdates;
updates.registerUpdates = electron => originalRegister(electron, { fetchRelease, openExternal: async u => { opened.push(u); } });
const ready = new Promise(resolve => app.once('browser-window-created', (_e, win) => {
  win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
  win.webContents.once('did-finish-load', () => resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR ? path.join(path.resolve(process.env.NAI_VERIFY_ASAR), 'electron/main.cjs') : '../electron/main.cjs');
const report = { externalNetwork: false, actualInstallerExecuted: false, userDataRead: false, checks: {} };
async function unitChecks() {
  const success = await updates.checkLatestRelease('0.2.12', fetchRelease);
  assert.equal(success.newer, true); assert.equal(success.installerAvailable, true);
  assert.equal((await updates.checkLatestRelease('0.2.13', fetchRelease)).newer, false);
  assert.equal((await updates.checkLatestRelease('0.2.14', fetchRelease)).newer, false);
  for (const [data, message] of [[{ ...fixture, html_url: 'https://other.example/download' }, /发布规则/],
    [{ ...fixture, tag_name: 'main' }, /发布规则/], [{ ...fixture, draft: true }, /发布规则/],
    [{ ...fixture, prerelease: true }, /发布规则/]]) {
    await assert.rejects(() => updates.checkLatestRelease('0.2.12', async () => Response.json(data)), message);
  }
  for (const status of [404, 403, 429, 500]) await assert.rejects(() => updates.checkLatestRelease('0.2.12', async () => new Response('', { status })), /GitHub|检查新版/);
  await assert.rejects(() => updates.checkLatestRelease('0.2.12', async () => new Response('bad-json')), /无法读取/);
  await assert.rejects(() => updates.checkLatestRelease('0.2.12', async () => new Response('x'.repeat(256 * 1024 + 1))), /过大/);
  const fallbackCalls = [];
  const fromPage = await updates.checkLatestRelease('0.2.12', async (input, options) => {
    fallbackCalls.push({ input, options });
    return input === url + '/releases/latest' ? new Response(pageFixture) : new Response('', { status: 403 });
  });
  assert.equal(fromPage.latestVersion, '0.2.13'); assert.equal(fromPage.source, 'page');
  assert.equal(fromPage.installerAvailable, null); assert.equal(fromPage.newer, true);
  assert.equal(fallbackCalls.length, 2); assert.equal(fallbackCalls[1].input, url + '/releases/latest');
  for (const { options } of fallbackCalls) { assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined); }
  for (const html of [pageFixture.replace('/gothamkismet-cyber/nai-image-studio', 'https://other.example'),
    pageFixture.replace('v0.2.13', 'v0.2.13-beta.1'), '<html>no canonical</html>', 'x'.repeat(512 * 1024 + 1)]) {
    await assert.rejects(() => updates.checkLatestRelease('0.2.12', async input => input === url + '/releases/latest'
      ? new Response(html) : new Response('', { status: 429 })), /GitHub/);
  }
  const exe = path.join(evidence, 'NAI-Image-Studio-Setup-0.2.12.exe'), bytes = Buffer.alloc(2048); bytes.write('MZ');
  fs.writeFileSync(exe, bytes); const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(exe + '.sha256', digest + '  ' + path.basename(exe));
  const readVersion = async () => ({ name: 'NAI生图台', version: '0.2.12' });
  assert.equal((await updates.inspectInstaller(exe, readVersion)).version, '0.2.12');
  fs.writeFileSync(exe + '.sha256', digest + '  wrong.exe');
  await assert.rejects(() => updates.inspectInstaller(exe, readVersion), /文件名/);
  fs.writeFileSync(exe + '.sha256', '0'.repeat(64) + '  ' + path.basename(exe));
  await assert.rejects(() => updates.inspectInstaller(exe, readVersion), /校验失败/);
  report.unit = { versionComparison: true, stableReleaseOnly: true, fixedOrigin: true, boundedResponse: true,
    rateLimitsAndFailures: true, validatedPublicPageFallback: true, asciiInstallerAndHash: true };
}
(async () => {
  await unitChecks(); calls = []; const win = await ready, run = code => win.webContents.executeJavaScript(code);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (code, label) => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await sleep(80); } throw Error('Timeout: ' + label); };
  const check = (name, value) => { assert.equal(value, true, name); report.checks[name] = true; };
  await run(`window.latestTest={button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t)};latestTest.button('软件更新').focus();latestTest.button('软件更新').click();void 0;`);
  await wait(`!latestTest.button('检查新版').disabled`, 'update info');
  hold = true; await run(`latestTest.button('检查新版').click()`); await wait(`!!latestTest.button('正在检查新版…')`, 'checking');
  check('pendingDisablesOtherActions', await run(`latestTest.button('打开下载页').disabled&&document.querySelector('[aria-label="关闭软件更新"]').disabled`));
  hold = false; release(); await wait(`document.querySelector('.update-release')?.textContent.includes('发现新版 v0.2.13')`, 'new release');
  check('notesRenderAsText', await run(`document.querySelector('.update-release pre').textContent.includes('<script>')&&!document.querySelector('.update-release script')`));
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.Authorization, undefined); assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].url, 'https://api.github.com/repos/gothamkismet-cyber/nai-image-studio/releases/latest');
  assert.equal(calls[0].credentials, 'omit'); report.checks.publicRequestContainsNoCredentials = true;
  await run(`latestTest.button('打开下载页').click()`); await sleep(100);
  assert.deepEqual(opened, [url + '/releases/latest']); report.checks.fixedDownloadPage = true;
  fs.writeFileSync(path.join(evidence, 'updates-desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  responseStatus = 403; await run(`latestTest.button('检查新版').click()`); await wait(`document.querySelector('.update-dialog [role="alert"]')?.textContent.includes('次数')`, 'rate limit');
  check('failureClearsStaleReleaseAndAllowsRetry', await run(`!document.querySelector('.update-release')&&!latestTest.button('检查新版').disabled`));
  pageFallback = true; await run(`latestTest.button('检查新版').click()`);
  await wait(`document.querySelector('.update-release')?.textContent.includes('已从 GitHub 下载页读取版本')`, 'fallback retry');
  check('pageFallbackDoesNotClaimAssetsOrNotes', await run(`!document.querySelector('.update-release pre')&&!document.querySelector('.update-release').textContent.includes('提供安装包和校验文件')`));
  win.setMinimumSize(320, 480); win.setSize(390, 844); await sleep(200);
  check('narrowDialogFits', await run(`document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.update-dialog').scrollWidth<=document.querySelector('.update-dialog').clientWidth+1`));
  fs.writeFileSync(path.join(evidence, 'updates-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  await run(`document.querySelector('[aria-label="关闭软件更新"]').click()`); await sleep(100);
  check('focusReturnsToTrigger', await run(`document.activeElement.textContent.trim()==='软件更新'`));
  report.pass = true; fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
  console.log('[RELEASE_CHECK_VERIFY]', JSON.stringify(report)); app.quit();
})().catch(error => { console.error(error); app.exit(1); });
