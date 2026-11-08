import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url),
  root = process.cwd()
const output = join(root, '.mam-local', 'spine-desktop-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-')),
  packagePath = join(root, '.mam-local/component-packages/creative-spine')
const manifest = JSON.parse(await readFile(join(packagePath, 'manifest.json'), 'utf8')),
  report = join(run, 'result.json')
const script = `
const {app,BrowserWindow,dialog,nativeImage}=require('electron'),fs=require('node:fs'),http=require('node:http');
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});
const calls=[],messages=[];let stage='start';const nl=String.fromCharCode(10,10);
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{if(req.url==='/object_info'){res.setHeader('content-type','application/json');res.end(JSON.stringify({LevelUpSpineExport:{}}));return;}calls.push({body:JSON.parse(body),auth:req.headers.authorization});res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'视觉参考已收到。'},finish_reason:'stop'}]})+nl+'data: [DONE]'+nl);});});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(packagePath)}]});dialog.showMessageBox=async()=>({response:1});
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.webContents.on('console-message',(_e,_l,m)=>messages.push(m));});
const timer=setTimeout(()=>finish({passed:false,error:'timeout'}),60000),wait=ms=>new Promise(r=>setTimeout(r,ms));
function finish(result){clearTimeout(timer);server.close();fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({...result,stage,messages},null,2));app.exit(result.passed?0:1);}
async function test(){await new Promise(r=>server.listen(0,'127.0.0.1',r));let main;for(let i=0;i<100;i++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));if(main&&await main.webContents.executeJavaScript('Boolean(window.mamCreative&&window.mam)').catch(()=>false))break;await wait(100)}
const m=s=>main.webContents.executeJavaScript(s);stage='install';await m('window.mam.saveModelConnection('+JSON.stringify({displayName:'Vision fixture',protocol:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'vision-fixture',remoteModelId:'vision-fixture',supportsImageInput:true})+')');await m('window.mamCreative.install()');await m('window.mamCreative.enable("creative.spine",'+JSON.stringify(${JSON.stringify(manifest.version)})+')');await m('window.mamCreative.open("creative.spine")');
let component=BrowserWindow.getAllWindows().find(w=>w!==main);const c=s=>component.webContents.executeJavaScript(s,true);await wait(600);
stage='robot';await c('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("体验机器人示例")).click()');await wait(500);await c('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存").click()');await wait(500);component.destroy();await wait(200);await m('window.mamCreative.open("creative.spine")');component=BrowserWindow.getAllWindows().find(w=>w!==main);await wait(500);
if(!await c('document.querySelectorAll("canvas").length>0'))throw Error('Robot lost on reopen');
stage='export';const download=new Promise((ok,fail)=>component.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(${JSON.stringify(join(run, 'robot.zip'))});item.once('done',(_e,state)=>state==='completed'?ok():fail(Error(state)))}));await c('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("导出 Spine")).click()');await download;const archive=fs.readFileSync(${JSON.stringify(join(run, 'robot.zip'))});if(archive.readUInt32LE(0)!==0x04034b50||!archive.includes(Buffer.from('.png')))throw Error('Invalid archive');
stage='vision';const rgba=Buffer.alloc(4*4*4,255),png=nativeImage.createFromBitmap(rgba,{width:4,height:4}).toPNG();const asset=await c('window.componentHost.request('+JSON.stringify({action:'storeImage',filename:'evidence.png',bytes:[...png]})+')');const models=await c('window.componentHost.request({action:"listModels"})');const model=models.find(x=>x.supportsVision);if(!model)throw Error('Vision capability missing');
const submit=async input=>c('window.componentHost.request('+JSON.stringify(input)+')');const jobId=await submit({action:'submit',operation:'vision.generate',idempotencyKey:'vision-1',params:{modelProfileId:model.id,prompt:'Inspect the pose'},inputAssets:[asset]});let job;for(let i=0;i<100;i++){job=(await c('window.componentHost.request({action:"listJobs"})')).find(x=>x.id===jobId);if(['succeeded','failed'].includes(job?.state))break;await wait(100)}if(job?.state!=='succeeded')throw Error('Vision failed '+JSON.stringify(job));if(!calls[0].body.messages.some(x=>Array.isArray(x.content)&&x.content.some(p=>p.type==='image_url')))throw Error('Image not passed to model');
stage='comfy info';const localJob=await submit({action:'submit',operation:'spine.comfy.request',idempotencyKey:'comfy-info',params:{endpoint:'http://127.0.0.1:'+server.address().port,operation:'info',payload:{}},inputAssets:[]});for(let i=0;i<100;i++){job=(await c('window.componentHost.request({action:"listJobs"})')).find(x=>x.id===localJob);if(['succeeded','failed'].includes(job?.state))break;await wait(100)}if(job?.state!=='succeeded')throw Error('Comfy bridge failed');
stage='SDK archive';const project=await c('new Promise((resolve,reject)=>{const open=indexedDB.open("levelup-spine-studio",1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const q=open.result.transaction("projects").objectStore("projects").getAll();q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(q.result.find(project=>project.parts?.length))}})');if(!project)throw Error('Saved Spine project absent');const exportJob=await submit({action:'submit',operation:'spine.export',idempotencyKey:'spine-sdk-export',params:{project},inputAssets:[]});for(let i=0;i<150;i++){job=(await c('window.componentHost.request({action:"listJobs"})')).find(x=>x.id===exportJob);if(['succeeded','failed','reconciliation-required'].includes(job?.state))break;await wait(100)}if(job?.state!=='succeeded')throw Error('SDK archive failed '+JSON.stringify(job));const output=job.events.findLast(x=>x.type==='succeeded')?.data?.assets?.[0];if(!output||output.mime!=='application/zip')throw Error('SDK archive missing');const sdkUrl=await submit({action:'previewAsset',ref:output});const sdkBytes=await c('fetch('+JSON.stringify(sdkUrl)+').then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))');const sdkArchive=Buffer.from(sdkBytes);if(sdkArchive.readUInt32LE(0)!==0x04034b50||!sdkArchive.includes(Buffer.from('.atlas'))||!sdkArchive.includes(Buffer.from('.png')))throw Error('SDK archive has no atlas/textures');
finish({passed:true,sdkArchiveBytes:sdkArchive.length,sdkRenderer:true,originalSpine:true,robotCloseReopen:true,archiveBytes:archive.length,vision:true,comfyInfo:true,scope:'local HTTP/process fixtures; no paid model or GPU inference'});
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
let diagnostic = ''
child.stderr.on('data', (c) => {
  diagnostic = (diagnostic + c).slice(-5000)
})
const code = await new Promise((ok, fail) => {
  child.once('exit', ok)
  child.once('error', fail)
})
const result = await readFile(report, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ passed: false, diagnostic }))
await writeFile(join(output, 'latest.json'), JSON.stringify({ ...result, code }, null, 2))
console.log(JSON.stringify(result, null, 2))
if (!result.passed || code !== 0) process.exitCode = 1
