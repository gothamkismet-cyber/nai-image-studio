// 同一份数据分别走浏览器与真实桌面隔离读取，再核对全部条目和插入行为。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.versions.electron) {
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(path.join(root,'node_modules/electron/dist/electron.exe'), [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { cwd:root, stdio:'inherit', windowsHide:true });
    child.on('error',reject); child.on('exit',resolve);
  });
  process.exit(exit ?? 1);
}
async function verify() {
const { app } = require('electron');
const evidence = path.resolve(process.env.NAI_VERIFY_EVIDENCE || path.join(root,'.tavernweave/evidence/quality-ui/library'));
await fs.mkdir(evidence,{recursive:true});
app.setPath('userData', await fs.mkdtemp(path.join(evidence,'test-profile-')));
delete process.env.NAI_SELFTEST; delete process.env.VITE_DEV_SERVER_URL;
const ready = new Promise(resolve => app.once('browser-window-created',(_e,win)=>{
  win.hide(); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
require('../electron/main.cjs');
const dir = process.argv[2] || 'D:/nai提示词';
const names = (await fs.readdir(dir)).filter(n => /^data.*\.js$/i.test(n));
const files = Object.fromEntries(await Promise.all([...names,'index.html'].map(async name=>[name,await fs.readFile(path.join(dir,name),'utf8')])));
const source = stripTypeScriptTypes(await fs.readFile(path.join(root,'src/lib/promptlib.ts'),'utf8'),{mode:'transform'}).replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const types = stripTypeScriptTypes(await fs.readFile(path.join(root,'src/types.ts'),'utf8'),{mode:'transform'}).replace(/^export /gm,'');
const chips = stripTypeScriptTypes(await fs.readFile(path.join(root,'src/lib/prompt-chips.ts'),'utf8'),{mode:'transform'}).replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const mod={exports:{}};
vm.runInNewContext(types+'\n'+chips+'\n'+source+'\nmodule.exports={DEFAULT_PARAMS,searchEntries,insertPrompt,targetText}',{module:mod});
const {DEFAULT_PARAMS,searchEntries,insertPrompt,targetText}=mod.exports;
const { libraryFrameHtml,runLibrarySandbox }=await import('../electron/library-runtime.mjs');
try {
const win=await ready;
const code='(async()=>{const runLibrarySandbox='+runLibrarySandbox.toString()+'; const libraryFrameHtml='+JSON.stringify(libraryFrameHtml)+'; const files='+JSON.stringify(files)+'; '+source+'; const handle={name:"fixture",async *[Symbol.asyncIterator](){for(const name of Object.keys(files))yield [name,{kind:"file"}]},async getFileHandle(name){return {async getFile(){return {async text(){return files[name]}}}}}}; return loadLibraryFrom(handle);})()';
const browser=await win.webContents.executeJavaScript(code);
await fs.writeFile(path.join(app.getPath('userData'),'config.json'),JSON.stringify({promptLibDir:dir}));
const loaded=await win.webContents.executeJavaScript('window.desktop.loadPromptLib()');
assert.equal(loaded.state,'ready');const desktop=loaded.data;
assert.deepEqual(JSON.parse(JSON.stringify(desktop.entries)), browser.entries);
assert.equal(browser.failedFiles.length, 0);
assert.equal(browser.entries.filter(e => e.kind === 'tag').length, 16156);
assert.equal(browser.entries.filter(e => e.kind === 'recipe').length, 6800);
assert.equal(browser.cats.length, 137);
assert.ok(browser.entries.some(e => e.catId === 'shoesock'));
const ids = new Set(browser.cats.map(c => c.id));
assert.ok(browser.entries.every(e => ids.has(e.catId)), '所有条目应能从分类中找到');
assert.ok(searchEntries(browser.entries, '', 'template', 10).results.every(e => e.catId === 'template'));
assert.ok(searchEntries(browser.entries, '银发', null).total > 0);
assert.equal(searchEntries(browser.entries, '', null, 120).results.length, 120);
assert.ok(browser.entries.some(e => e.adult));
const a = { id: 'a', caption: 'first', negative: '', positionMode: 'ai', x: .5, y: .5 };
const b = { ...a, id: 'b', caption: 'second' };
const p = { ...DEFAULT_PARAMS, prompt: 'scene,', characters: [a, b] };
assert.equal(insertPrompt(p, { kind: 'main' }, 'rain', 'append').prompt, 'scene, rain');
assert.equal(insertPrompt(p, { kind: 'negative' }, 'lowres', 'append').negativePrompt, 'lowres');
const afterDelete = { ...p, characters: [b] };
assert.equal(insertPrompt(afterDelete, { kind: 'char', id: 'b' }, 'silver hair', 'append').characters[0].caption, 'second, silver hair');
assert.strictEqual(insertPrompt(afterDelete, { kind: 'char', id: 'a' }, 'wrong', 'append'), afterDelete);
assert.equal(targetText(afterDelete, { kind: 'char', id: 'a' }), null);
assert.equal(insertPrompt(p, { kind: 'char', id: 'b', negative: true }, 'bad hands', 'replace').characters[1].negative, 'bad hands');
console.log(JSON.stringify({ pass: true, entries: browser.entries.length, categories: browser.cats.length, checks: ['desktop-browser-parity', 'imported-data', 'recipe-category', 'search-pagination', 'stable-character-target', 'negative-insertion'] }, null, 2));

await fs.writeFile(path.join(evidence,'verification.json'),JSON.stringify({pass:true,entries:browser.entries.length,categories:browser.cats.length,desktopBrowserParity:true}));
app.quit();
} catch(error) { console.error(error); app.exit(1); }

}
verify().catch(error=>{console.error(error);require("electron").app.exit(1);});
