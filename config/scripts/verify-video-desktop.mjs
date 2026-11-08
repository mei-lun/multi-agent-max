import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url),
  root = process.cwd(),
  output = join(root, '.mam-local/video-desktop-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-')),
  packagePath = join(root, '.mam-local/component-packages/creative-video'),
  manifest = JSON.parse(await readFile(join(packagePath, 'manifest.json'), 'utf8')),
  report = join(run, 'result.json')
const script = `
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),http=require('node:http');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});const video=fs.readFileSync(${JSON.stringify(join(root, '.mam-local/native-video-fixture/fixture.mp4'))});let stage='start';const calls=[],messages=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{calls.push(req.method+' '+req.url);if(req.method==='POST'){res.end(JSON.stringify({id:'task-1'}));return;}if(req.url.endsWith('/content')){res.setHeader('content-type','video/mp4');res.end(video);return;}res.end(JSON.stringify({status:'completed'}));});});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(packagePath)}]});dialog.showMessageBox=async()=>({response:1});dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(join(run, 'export.mp4'))}});app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.webContents.on('console-message',(_e,_l,m)=>messages.push(m));});const timer=setTimeout(()=>finish({passed:false,error:'timeout'}),60000),wait=ms=>new Promise(r=>setTimeout(r,ms));function finish(result){clearTimeout(timer);server.close();fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({...result,stage,calls,messages},null,2));app.exit(result.passed?0:1)}
async function test(){await new Promise(r=>server.listen(0,'127.0.0.1',r));let main;for(let i=0;i<100;i++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));if(main&&await main.webContents.executeJavaScript('Boolean(window.mamCreative)').catch(()=>false))break;await wait(100)}const m=s=>main.webContents.executeJavaScript(s);
stage='configure';await m('window.mam.saveModelConnection('+JSON.stringify({displayName:'Video fixture',protocol:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'fixture',remoteModelId:'grok-imagine-video'})+')');await m('window.mamCreative.install()');await m('window.mamCreative.enable("creative.video",'+JSON.stringify(${JSON.stringify(manifest.version)})+')');await m('window.mamCreative.open("creative.video")');const w=BrowserWindow.getAllWindows().find(w=>w!==main),c=s=>w.webContents.executeJavaScript(s,true);const models=await c('window.componentHost.request({action:"listModels"})'),model=models.find(x=>x.kind==='video');if(!model)throw Error('No video model');
const submit=input=>c('window.componentHost.request('+JSON.stringify(input)+')');const settled=async id=>{for(let i=0;i<200;i++){const j=(await c('window.componentHost.request({action:"listJobs"})')).find(x=>x.id===id);if(['succeeded','failed','reconciliation-required'].includes(j?.state))return j;await wait(100)}throw Error('Job timeout')};
stage='generate';const id=await submit({action:'submit',operation:'video.generate',idempotencyKey:'video-1',params:{modelProfileId:model.id,prompt:'red then blue',mode:'text'},inputAssets:[]});const job=await settled(id);if(job.state!=='succeeded')throw Error(JSON.stringify(job));const receipt=job.events.find(e=>e.type==='log'&&e.data?.type==='remote_task');if(!receipt)throw Error('No durable receipt');const ref=job.events.find(e=>e.type==='asset').data;
stage='playback';const url=await submit({action:'previewAsset',ref});const playback=await c('(async()=>{const v=document.createElement("video");v.muted=true;v.src='+JSON.stringify(url)+';document.body.append(v);await new Promise((ok,fail)=>{v.onloadedmetadata=ok;v.onerror=()=>fail(Error("video decode"))});await v.play();await new Promise(r=>setTimeout(r,250));return {duration:v.duration,time:v.currentTime,width:v.videoWidth,height:v.videoHeight}})()');if(playback.width!==64||playback.height!==64||playback.time<=0)throw Error('Playback did not advance');
await submit({action:'exportAsset',ref});if(!fs.readFileSync(${JSON.stringify(join(run, 'export.mp4'))}).equals(video))throw Error('Export changed');stage='recovery';const refresh=await submit({action:'submit',operation:'video.refresh',idempotencyKey:'refresh-1',params:{sourceJobId:id},inputAssets:[]});if((await settled(refresh)).state!=='succeeded'||calls.filter(x=>x.startsWith('POST')).length!==1)throw Error('Refresh resubmitted');finish({passed:true,receiptPersisted:true,playback,byteExactExport:true,refreshWithoutResubmit:true,scope:'locally encoded real MP4 served by local HTTP fixture; no external generation'});}
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
  }),
  result = await readFile(report, 'utf8')
    .then(JSON.parse)
    .catch(() => ({ passed: false, diagnostic }))
await writeFile(join(output, 'latest.json'), JSON.stringify({ ...result, code }, null, 2))
console.log(JSON.stringify(result, null, 2))
if (!result.passed || code !== 0) process.exitCode = 1
