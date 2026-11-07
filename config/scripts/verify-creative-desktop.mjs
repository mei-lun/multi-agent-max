import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = process.cwd()
const output = join(root, '.mam-local', 'creative-desktop-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
const pkg = resolve(root, '.mam-local/component-packages/creative-image')
const componentVersion = JSON.parse(await readFile(join(pkg, 'manifest.json'), 'utf8')).version
const entry = pathToFileURL(join(root, 'out/main/index.js')).href
const report = join(run, 'result.json')
const script = `
const {app,BrowserWindow,dialog,nativeTheme}=require('electron');
const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(pkg)}]});
dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
const messages=[];let step='startup';
app.on('browser-window-created',(_event,window)=>{window.show=()=>{};window.webContents.on('console-message',(_event,_level,message)=>messages.push(message));});
const timer=setTimeout(()=>finish({passed:false,error:'timeout'}),45000);
function finish(result){clearTimeout(timer);fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({...result,step,messages},null,2));app.exit(result.passed?0:1);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function test(){
 let main;
 for(let n=0;n<150;n++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));if(main && await main.webContents.executeJavaScript('Boolean(window.mamCreative && window.mam)').catch(()=>false)) break;await wait(100)}
 if(!main)throw Error('Main application missing');
 step='initial catalog';const before=await main.webContents.executeJavaScript('window.mamCreative.list()');
 if(before.length!==8 || before.some(c=>c.versions.length))throw Error('Initial catalog incorrect');
 step='install';await main.webContents.executeJavaScript('window.mamCreative.install()');
 step='enable';const installed=await main.webContents.executeJavaScript('window.mamCreative.enable("creative.image","${componentVersion}")');
 if(!installed.find(c=>c.id==='creative.image')?.versions[0]?.enabled)throw Error('Enable failed');
 step='open';await main.webContents.executeJavaScript('window.mamCreative.open("creative.image")');
 const component=BrowserWindow.getAllWindows().find(w=>w!==main);
 if(!component)throw Error('Component window missing');
 step='component context';const context=await component.webContents.executeJavaScript('window.componentHost.request({action:"context"})');
 const isolated=await component.webContents.executeJavaScript('typeof window.mam === "undefined" && typeof process === "undefined"');
 if(context.manifest.id!=='creative.image'||!isolated)throw Error('Context isolation failed');
 const denied=await component.webContents.executeJavaScript('window.componentHost.request({action:"submit",operation:"image.removeSolidBackground",idempotencyKey:"test",inputAssets:[],params:{},attempt:{id:"forged"}}).then(()=>false,()=>true)');
 if(!denied)throw Error('Forged authority accepted');
 const pinned=await main.webContents.executeJavaScript('window.mamCreative.remove("creative.image","${componentVersion}").then(()=>false,()=>true)');
 if(!pinned)throw Error('Open version was removed');
 await main.webContents.executeJavaScript('(()=>{const button=[...document.querySelectorAll("nav button")].find(b=>/创作组件|Creative components/.test(b.textContent));if(!button)throw Error("navigation missing");button.click()})()');
 for(let i=0;i<100;i++){if(await main.webContents.executeJavaScript('document.querySelectorAll("main article").length===8 && ![...document.querySelectorAll("main button")].some(b=>b.disabled)'))break;await wait(100)}
 const cards=await main.webContents.executeJavaScript('document.querySelectorAll("main article").length');
 if(cards!==8)throw Error('Catalog UI did not finish loading');
 for(const theme of ['light','dark']){nativeTheme.themeSource=theme;await wait(150);const image=await main.webContents.capturePage();fs.writeFileSync(${JSON.stringify(output)}+'/'+theme+'.png',image.toPNG());}
 component.destroy();await wait(100);
 const removed=await main.webContents.executeJavaScript('window.mamCreative.remove("creative.image","${componentVersion}")');
 if(removed.find(c=>c.id==='creative.image').versions.length)throw Error('Removal failed');
 const sourceHash=context.manifest.source.sha256;
 finish({passed:true,catalogEntries:before.length,installedEnabledOpened:true,mainFrameBridge:true,forgedAuthorityRejected:denied,openVersionProtected:pinned,uninstalled:true,sourceHash});
}
import(${JSON.stringify(entry)}).then(()=>app.whenReady()).then(test).catch(error=>finish({passed:false,error:String(error),stack:error.stack}));
`
await writeFile(join(run, 'main.cjs'), script)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.MAM_DESKTOP_SMOKE
delete env.MAM_PROJECT_DIRECTORY
const child = spawn(require('electron'), [join(run, 'main.cjs')], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
})
let diagnostics = ''
child.stderr.on('data', (chunk) => {
  diagnostics = (diagnostics + chunk).slice(-6000)
})
const code = await new Promise((accept, reject) => {
  child.once('error', reject)
  child.once('exit', accept)
})
const result = await readFile(report, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ passed: false, error: 'No result', diagnostics }))
await writeFile(
  join(output, 'latest.json'),
  JSON.stringify({ ...result, code, ...(!result.passed ? { diagnostics } : {}) }, null, 2) + '\n'
)
console.log(JSON.stringify(result, null, 2))
if (!result.passed || code !== 0) process.exitCode = 1
