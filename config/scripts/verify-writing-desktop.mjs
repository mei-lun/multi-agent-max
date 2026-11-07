import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url),
  root = process.cwd()
const output = join(root, '.mam-local', 'writing-desktop-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
const packagePath = join(root, '.mam-local/component-packages/creative-writing')
const manifest = JSON.parse(await readFile(join(packagePath, 'manifest.json'), 'utf8'))
const reportPath = join(run, 'result.json')
const script = `
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),http=require('node:http');
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});
const messages=[],requests=[];let step='startup';
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push({url:req.url,authorized:req.headers.authorization==='Bearer writing-fixture',body:JSON.parse(body)});const end=String.fromCharCode(10,10);res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'这是通过 MAM '}}]})+end);setTimeout(()=>{res.write('data: '+JSON.stringify({choices:[{delta:{content:'流式生成的正文。'},finish_reason:'stop'}]})+end);res.end('data: [DONE]'+end);},100);});});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(packagePath)}]});dialog.showMessageBox=async()=>({response:1});
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.webContents.on('console-message',(_e,_l,m)=>messages.push(m));});
const timer=setTimeout(()=>finish({passed:false,error:'timeout'}),60000),wait=ms=>new Promise(r=>setTimeout(r,ms));
function finish(result){clearTimeout(timer);server.close();fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({...result,step,messages},null,2));app.exit(result.passed?0:1);}
async function test(){await new Promise(r=>server.listen(0,'127.0.0.1',r));let main;
 for(let i=0;i<100;i++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));if(main&&await main.webContents.executeJavaScript('Boolean(window.mamCreative&&window.mam)').catch(()=>false))break;await wait(100)}
 if(!main)throw Error('No main window');
 const runMain=s=>main.webContents.executeJavaScript(s);
 step='model configuration';await runMain('window.mam.saveModelConnection('+JSON.stringify({displayName:'Writing fixture',protocol:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'writing-fixture',remoteModelId:'gpt-writing-fixture'})+')');
 await runMain('window.mamCreative.install()');await runMain('window.mamCreative.enable("creative.writing",'+JSON.stringify(${JSON.stringify(manifest.version)})+')');await runMain('window.mamCreative.open("creative.writing")');
 let component=BrowserWindow.getAllWindows().find(w=>w!==main);const runView=s=>component.webContents.executeJavaScript(s,true);
 const editor='[...document.querySelectorAll("textarea")].find(t=>t.placeholder==="从这里开始写作…")';
 const accept='[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="接受建议") || document.querySelector(".completion-card.ready .accept")';
 const ready=async()=>{for(let i=0;i<100;i++){if(await runView('Boolean('+editor+')'))return;await wait(100)}throw Error('Editor did not load')};await ready();
 step='actual editor request';await runView('(()=>{const t='+editor+';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(t,"开篇。");t.dispatchEvent(new Event("input",{bubbles:true}))})()');await wait(100);
 await runView('[...document.querySelectorAll(".writing-ai-toolbar button")].find(b=>b.textContent.trim()==="续写").click()');
 for(let i=0;i<100;i++){if(await runView('Boolean('+accept+')'))break;await wait(100)}
 const suggestion=await runView('document.body.innerText');if(!suggestion.includes('流式生成的正文'))throw Error('No streamed suggestion '+suggestion.slice(-1000));
 await runView('('+accept+').click()');await wait(200);
 await runView('[...document.querySelectorAll("button")].find(b=>b.title==="立即保存").click()');await wait(600);
 const content=await runView('('+editor+').value');if(!content.includes('流式生成的正文'))throw Error('Accept did not edit document');
 step='close and reopen persistence';component.destroy();await wait(150);await runMain('window.mamCreative.open("creative.writing")');component=BrowserWindow.getAllWindows().find(w=>w!==main);await ready();const restored=await runView('('+editor+').value');if(restored!==content)throw Error('Document lost after reopen');
 if(!requests.length||requests.some(r=>!r.authorized||r.body.tools))throw Error('Request contract invalid');
 fs.writeFileSync(${JSON.stringify(join(output, 'workbench.png'))},(await component.webContents.capturePage()).toPNG());
 finish({passed:true,originalEditor:true,streamedSuggestion:true,acceptedText:true,saveCloseReopen:true,requestCount:requests.length,noTools:true,componentVersion:${JSON.stringify(manifest.version)},scope:'local HTTP fixture; no live model call'});
}
import(${JSON.stringify(pathToFileURL(join(root, 'out/main/index.js')).href)}).then(()=>app.whenReady()).then(test).catch(e=>finish({passed:false,error:String(e),stack:e.stack}));
`
await writeFile(join(run, 'main.cjs'), script)
execFileSync(process.execPath, ['--check', join(run, 'main.cjs')])
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
  diagnostics = (diagnostics + chunk).slice(-5000)
})
const code = await new Promise((accept, reject) => {
  child.once('error', reject)
  child.once('exit', accept)
})
const result = await readFile(reportPath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ passed: false, diagnostics }))
await writeFile(join(output, 'latest.json'), JSON.stringify({ ...result, code }, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!result.passed || code !== 0) process.exitCode = 1
