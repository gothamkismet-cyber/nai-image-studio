// 原生选择/确认使用合成结果，最终进程启动被拦截；不执行安装器、不读取用户数据。
const {app,dialog}=require('electron');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const evidence=path.resolve(process.env.NAI_VERIFY_EVIDENCE||'.tavernweave/evidence/updates/final');
fs.mkdirSync(evidence,{recursive:true});const profile=fs.mkdtempSync(path.join(evidence,'test-profile-'));app.setPath('userData',profile);
const temp=path.join(profile,'update-temp');fs.mkdirSync(temp);app.setPath('temp',temp);
Object.defineProperty(app,'isPackaged',{get:()=>true});delete process.env.NAI_SELFTEST;delete process.env.VITE_DEV_SERVER_URL;delete process.env.PORTABLE_EXECUTABLE_DIR;
// Electron 以脚本启动时 app.getVersion 是运行器版本，明确模拟成品包元信息。
app.getVersion=()=> '0.2.8';
const modulePath=process.env.NAI_VERIFY_ASAR?path.join(path.resolve(process.env.NAI_VERIFY_ASAR),'electron/updates.cjs'):path.resolve('electron/updates.cjs');
const updates=require(modulePath);
const fixtureDir=path.join(evidence,'synthetic-installers');fs.mkdirSync(fixtureDir,{recursive:true});
function fixture(version,checksum=true){
  const file=path.join(fixtureDir,`NAI生图台-Setup-${version}.exe`),data=Buffer.alloc(2048,42);data.write('MZ');fs.writeFileSync(file,data);
  if(checksum)fs.writeFileSync(file+'.sha256',crypto.createHash('sha256').update(data).digest('hex')+'  '+path.basename(file)+'\n');
  return file;
}
const next=fixture('0.2.9'),same=fixture('0.2.8'),older=fixture('0.2.7'),missing=fixture('0.3.0',false),invalid=path.join(fixtureDir,'other.exe');fs.writeFileSync(invalid,'not an installer');
const inspect=file=>updates.inspectInstaller(file,async filename=>({name:'NAI生图台',version:/Setup-(.+)\.exe/.exec(filename)[1]}));
let selectedFile=next,confirmResponse=1,launchFail=false,launches=[],quitCalls=0,holdChoice=false,releaseChoice;
dialog.showOpenDialog=async()=>{if(holdChoice)await new Promise(r=>releaseChoice=r);return selectedFile?{canceled:false,filePaths:[selectedFile]}:{canceled:true,filePaths:[]};};
dialog.showMessageBox=async()=>({response:confirmResponse});
const originalRegister=updates.registerUpdates;
updates.registerUpdates=electron=>originalRegister(electron,{inspectInstaller:inspect,launchInstaller:async file=>{if(launchFail)throw Error('Synthetic launcher failure');launches.push({file,sha256:await updates.hashFile(file)});},scheduleQuit:()=>{quitCalls++;}});
const ready=new Promise(resolve=>app.once('browser-window-created',(_e,win)=>{
  win.hide();win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',(...args)=>{const strings=args.filter(a=>typeof a==='string');if(strings.length)console.log('[RENDERER]',...strings);else if(args[0]?.message)console.log('[RENDERER]',args[0].message);});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  win.webContents.once('did-finish-load',()=>resolve(win));
}));
require(process.env.NAI_VERIFY_ASAR?path.join(path.resolve(process.env.NAI_VERIFY_ASAR),'electron/main.cjs'):'../electron/main.cjs');
async function unitChecks(){
  const config=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.equal(config.build.nsis.guid,updates.APP_GUID);assert.equal(config.build.nsis.allowToChangeInstallationDirectory,false);assert.equal(config.build.nsis.deleteAppDataOnUninstall,false);
  assert.equal(updates.compareVersions('0.2.10','0.2.9'),1);assert.equal(updates.compareVersions('0.2.8','0.2.8'),0);assert.throws(()=>updates.compareVersions('beta','0.2.8'));
  const real=await updates.inspectInstaller('D:/nai-release/0.2.7/NAI生图台-Setup-0.2.7.exe');assert.equal(real.version,'0.2.7');
  await assert.rejects(()=>inspect(invalid),/请选择/);await assert.rejects(()=>inspect(missing),/校验文件/);
  await assert.rejects(()=>updates.inspectInstaller(next,async()=>({name:'Other app',version:'0.2.9'})),/产品名称/);
  await assert.rejects(()=>updates.inspectInstaller(next,async()=>({name:'NAI生图台',version:'1.0.0'})),/版本/);
  const damaged=fixture('0.4.0');fs.appendFileSync(damaged,'tamper');await assert.rejects(()=>inspect(damaged),/校验失败/);
  const malformed=fixture('0.4.1');fs.writeFileSync(malformed+'.sha256','0'.repeat(64)+'  wrong.exe');await assert.rejects(()=>inspect(malformed),/格式或对应文件名/);
  const handlers={},sender=new EventEmitter();sender.id=999;sender.mainFrame={};const event={sender,senderFrame:sender.mainFrame};
  const fakeApp={isPackaged:true,getVersion:()=> '0.2.8',getPath:key=>key==='temp'?temp:'C:/fake/NAI生图台.exe'};
  const fakeWindow={isDestroyed:()=>false};let chosen=next,confirmed=1,unitLaunches=0,unitQuits=0;
  originalRegister({app:fakeApp,ipcMain:{handle:(name,fn)=>handlers[name]=fn},BrowserWindow:{fromWebContents:s=>s===sender?fakeWindow:null},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[chosen]}),showMessageBox:async()=>({response:confirmed})}},
    {inspectInstaller:inspect,launchInstaller:async()=>unitLaunches++,scheduleQuit:()=>unitQuits++});
  assert.equal((await handlers['updates:choose']({...event,senderFrame:{}})).state,'error');
  assert.equal((await handlers['updates:install'](event,'C:/arbitrary.exe')).state,'error');assert.equal(unitLaunches,0);
  chosen=older;assert.ok((await handlers['updates:choose'](event)).message.includes('旧'));
  chosen=same;let pending=await handlers['updates:choose'](event);assert.equal(pending.sameVersion,true);
  assert.equal((await handlers['updates:install'](event,pending.id)).state,'canceled');assert.equal(unitQuits,0);
  chosen=next;pending=await handlers['updates:choose'](event);
  const savedNow=Date.now;try{Date.now=()=>savedNow()+16*60*1000;assert.equal((await handlers['updates:install'](event,pending.id)).state,'error');}finally{Date.now=savedNow;}
  pending=await handlers['updates:choose'](event);confirmed=0;fs.appendFileSync(next,'changed after choice');
  assert.ok((await handlers['updates:install'](event,pending.id)).message.includes('发生了变化'));assert.equal(unitLaunches,0);assert.equal(unitQuits,0);fixture('0.2.9');
  pending=await handlers['updates:choose'](event);assert.equal((await handlers['updates:install'](event,pending.id)).state,'launching');assert.equal(unitLaunches,1);assert.equal(unitQuits,1);
  assert.equal((await handlers['updates:install'](event,pending.id)).state,'error');assert.equal(unitLaunches,1);
  fakeApp.isPackaged=false;assert.equal((await handlers['updates:choose'](event)).state,'error');
  return {stableInstallerIdentityAndDataRetention:true,realInstallerMetadataAndHash:true,versionOrdering:true,wrongAppAndMetadata:true,missingMalformedAndDamagedChecksum:true,frameAndArbitraryPathRejected:true,downgradeAndSameVersion:true,cancelNoQuit:true,expiredSelection:true,changedFileNoLaunch:true,oneHandoffOnly:true,sourceModeBlocked:true};
}
(async()=>{
  const out={unit:await unitChecks()},win=await ready;
  const run=s=>win.webContents.executeJavaScript(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(s,label)=>{for(let i=0;i<100;i++){if(await run(s))return;await sleep(100);}throw Error('Timeout: '+label);};
  const capture=async name=>{for(let i=0;i<3;i++){try{fs.writeFileSync(path.join(evidence,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return;}catch(e){if(i===2)throw e;await sleep(200);}}};
  await run(`window.updateTest={button:t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t),fill:(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}};window.confirm=()=>true;void 0;`);
  await run(`updateTest.button('软件更新').focus();updateTest.button('软件更新').click()`);await wait(`document.querySelector('.update-current b')?.textContent==='v0.2.8'`,'version info');
  assert.equal(await run(`document.querySelector('.update-dialog').open`),true);assert.ok(await run(`document.activeElement.closest('.update-dialog')!==null`));
  assert.equal(await run(`updateTest.button('开始覆盖更新').disabled`),true);
  selectedFile=null;await run(`updateTest.button('选择新版安装包').click()`);await wait(`document.querySelector('.update-notice').textContent.includes('取消选择')`,'canceled pick');
  selectedFile=missing;await run(`updateTest.button('选择新版安装包').click()`);await wait(`document.querySelector('.update-dialog [role="alert"]')?.textContent.includes('校验文件')`,'missing checksum');
  selectedFile=older;await run(`updateTest.button('选择新版安装包').click()`);await wait(`document.querySelector('.update-dialog [role="alert"]')?.textContent.includes('旧')`,'downgrade');
  selectedFile=same;await run(`updateTest.button('选择新版安装包').click()`);await wait(`!!updateTest.button('覆盖重新安装')&&!updateTest.button('覆盖重新安装').disabled`,'same version reinstall');
  selectedFile=next;holdChoice=true;await run(`updateTest.button('选择新版安装包').click()`);await wait(`!!updateTest.button('正在检查安装包…')`,'checking');
  assert.equal(await run(`document.querySelector('[aria-label="关闭软件更新"]').disabled`),true);holdChoice=false;releaseChoice();await wait(`document.querySelector('.update-selection h3')?.textContent.includes('0.2.9')`,'chosen newer');
  await run(`updateTest.button('开始覆盖更新').click()`);await wait(`document.querySelector('.update-notice').textContent.includes('已取消更新')`,'native cancel');assert.equal(launches.length,0);assert.equal(quitCalls,0);
  confirmResponse=0;launchFail=true;await run(`updateTest.button('开始覆盖更新').click()`);await wait(`document.querySelector('.update-dialog [role="alert"]')?.textContent.includes('launcher failure')`,'launch failure');assert.equal(quitCalls,0);
  launchFail=false;
  await capture('update-desktop.png');
  await run(`document.querySelector('[aria-label="关闭软件更新"]').click()`);await sleep(80);assert.equal(await run(`document.activeElement.textContent.trim()`),'软件更新');
  // 个人草稿未保存时，更新不能关闭软件。
  await run(`updateTest.button('我的提示词').click()`);await sleep(80);await run(`updateTest.button('＋ 新增提示词').click()`);await sleep(80);
  await run(`updateTest.fill(document.querySelector('#personal-prompt-name'),'尚未保存');updateTest.fill(document.querySelector('#personal-prompt-content'),'keep my draft')`);await sleep(80);
  await run(`updateTest.button('软件更新').click()`);await sleep(80);await run(`updateTest.button('选择新版安装包').click()`);await wait(`document.querySelector('.update-selection')`,'draft with chosen installer');
  assert.equal(await run(`updateTest.button('开始覆盖更新').disabled`),true);assert.ok(await run(`document.querySelector('.update-dialog .warning').textContent.includes('未保存')`));
  await run(`document.querySelector('[aria-label="关闭软件更新"]').click()`);await sleep(80);assert.equal(await run(`document.querySelector('#personal-prompt-content').value`),'keep my draft');
  await run(`updateTest.button('保存提示词').click()`);await sleep(80);await run(`updateTest.button('软件更新').click()`);await sleep(80);await run(`updateTest.button('选择新版安装包').click()`);await wait(`!!document.querySelector('.update-selection')&&!updateTest.button('开始覆盖更新').disabled`,'saved draft permits update');
  await capture('update-ready-desktop.png');
  win.setMinimumSize(320,480);win.setSize(390,844);await sleep(160);
  const layout=()=>run(`(()=>{const d=document.querySelector('.update-dialog'),f=d.querySelector('.api-settings-footer').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,dialogWidth:d.clientWidth,dialogScroll:d.scrollWidth,footerBottom:f.bottom,height:innerHeight};})()`);
  out.mobile=await layout();assert.ok(out.mobile.scroll<=out.mobile.width+1);assert.ok(out.mobile.dialogScroll<=out.mobile.dialogWidth+1);assert.ok(out.mobile.footerBottom<=out.mobile.height+1);await capture('update-mobile.png');
  win.setSize(1440,900);win.webContents.setZoomFactor(2);await sleep(180);out.zoom=await layout();assert.ok(out.zoom.scroll<=out.zoom.width+1);assert.ok(out.zoom.footerBottom<=out.zoom.height+1);await capture('update-zoom200.png');
  await run(`updateTest.button('开始覆盖更新').click()`);await wait(`document.querySelector('.update-notice').textContent.includes('安装程序已打开')`,'handoff');
  assert.equal(launches.length,1);assert.equal(quitCalls,1);assert.notEqual(launches[0].file,next);assert.ok(launches[0].file.startsWith(temp));assert.equal(launches[0].sha256,await updates.hashFile(next));
  out.ui={versionAndFocus:true,emptyCannotInstall:true,cancelPick:true,invalidAndOlderBlocked:true,sameVersion:true,checkingLocks:true,nativeCancelNoQuit:true,launchFailureNoQuit:true,focusReturn:true,unsavedDraftBlocked:true,savedDraftPermits:true,stagedAndCheckedHandoff:true};
  out.installerExecuted=false;out.userDataRead=false;out.externalNetwork=false;out.pass=true;
  fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(out,null,2));console.log('[UPDATES_VERIFY]',JSON.stringify(out));app.quit();
})().catch(e=>{console.error(e);app.exit(1);});
