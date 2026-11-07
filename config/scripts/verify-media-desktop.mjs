import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = process.cwd()
const output = join(root, '.mam-local', 'media-desktop-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
const packagePath = join(root, '.mam-local', 'component-packages', 'creative-image')
const manifest = JSON.parse(await readFile(join(packagePath, 'manifest.json'), 'utf8'))
const speechPath = join(root, '.mam-local', 'component-packages', 'creative-speech')
const speechManifest = JSON.parse(await readFile(join(speechPath, 'manifest.json'), 'utf8'))
const outputPath = join(run, 'exported.png')
const reportPath = join(run, 'result.json')
const script = `
const {app,BrowserWindow,dialog,nativeTheme,nativeImage}=require('electron');
const fs=require('node:fs');const http=require('node:http');
app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});
const requests=[],messages=[];let step='startup';
const bitmap=Buffer.alloc(8*8*4);for(let i=0;i<bitmap.length;i+=4){bitmap[i]=20;bitmap[i+1]=80;bitmap[i+2]=200;bitmap[i+3]=255;}
let png;let selectedPackage=${JSON.stringify(packagePath)};
const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{const body=Buffer.concat(chunks);requests.push({url:req.url,method:req.method,authorized:req.headers.authorization==='Bearer native-fixture-key',type:req.headers['content-type'],body:body.toString()});setTimeout(()=>{if(req.url.endsWith('/audio/speech')){res.setHeader('content-type','audio/wav');res.end(wav);return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));},150);});});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selectedPackage]});
dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(outputPath)}});
app.on('browser-window-created',(_event,w)=>{w.show=()=>{};w.webContents.on('console-message',(_e,_l,m)=>messages.push(m));});
const timeout=setTimeout(()=>finish({passed:false,error:'timeout'}),60000);
function finish(result){clearTimeout(timeout);server.close();fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify({...result,step,messages},null,2));app.exit(result.passed?0:1);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function renderer(main,code){return main.webContents.executeJavaScript(code);}
async function test(){
 png=nativeImage.createFromBitmap(bitmap,{width:8,height:8}).toPNG();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let main;for(let i=0;i<100;i++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));if(main&&await renderer(main,'Boolean(window.mamCreative&&window.mam)').catch(()=>false))break;await wait(100)}
 if(!main)throw Error('Main renderer missing');
 step='configure model';
 await renderer(main,'window.mam.saveModelConnection('+JSON.stringify({displayName:'Native fixture image',protocol:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'native-fixture-key',remoteModelId:'gpt-image-2'})+')');
 step='install image';await renderer(main,'window.mamCreative.install()');await renderer(main,'window.mamCreative.enable("creative.image",'+JSON.stringify(${JSON.stringify(manifest.version)})+')');await renderer(main,'window.mamCreative.open("creative.image")');
 let component=BrowserWindow.getAllWindows().find(w=>w!==main);if(!component)throw Error('No image window');
 const call=code=>renderer(component,code);
 step='safe model catalog';const models=await call('window.componentHost.request({action:"listModels"})');
 if(models.length!==1||JSON.stringify(models).includes('native-fixture-key'))throw Error('Wrong or unsafe model catalog');
 const input={action:'submit',operation:'image.generate',idempotencyKey:'native-generation-1',params:{modelProfileId:models[0].id,prompt:'A blue cube',count:1},inputAssets:[]};
 step='submit generation';const jobId=await call('window.componentHost.request('+JSON.stringify(input)+')');
 component.destroy();await wait(300);await renderer(main,'window.mamCreative.open("creative.image")');component=BrowserWindow.getAllWindows().find(w=>w!==main);
 step='background completion';let job;for(let i=0;i<100;i++){job=(await call('window.componentHost.request({action:"listJobs"})')).find(j=>j.id===jobId);if(['succeeded','failed'].includes(job?.state))break;await wait(100)}
 if(job?.state!=='succeeded')throw Error('Generation failed '+JSON.stringify(job));
 const asset=job.events.find(e=>e.type==='asset')?.data;if(!asset)throw Error('No asset');
 const replay=await call('window.componentHost.request('+JSON.stringify(input)+')');if(replay!==jobId||requests.length!==1)throw Error('Idempotency failed');
 step='preview';const url=await call('window.componentHost.request('+JSON.stringify({action:'previewAsset',ref:asset})+')');
 const preview=await call('(async()=>{const i=new Image();i.src='+JSON.stringify(url)+';await i.decode();return {width:i.naturalWidth,height:i.naturalHeight}})()');
 if(preview.width!==8||preview.height!==8)throw Error('Preview invalid');
 step='export';await call('window.componentHost.request('+JSON.stringify({action:'exportAsset',ref:asset})+')');if(!fs.readFileSync(${JSON.stringify(outputPath)}).equals(png))throw Error('Export bytes changed');
 step='edit';const edit={action:'submit',operation:'image.edit',idempotencyKey:'native-edit-1',params:{modelProfileId:models[0].id,prompt:'A green cube'},inputAssets:[asset]};const editId=await call('window.componentHost.request('+JSON.stringify(edit)+')');
 for(let i=0;i<100;i++){job=(await call('window.componentHost.request({action:"listJobs"})')).find(j=>j.id===editId);if(['succeeded','failed'].includes(job?.state))break;await wait(100)}
 if(job?.state!=='succeeded'||requests.length!==2||!requests[1].url.endsWith('/images/edits')||!requests[1].type.includes('multipart/form-data'))throw Error('Edit failed '+JSON.stringify(job));
 step='ui';await wait(3500);const ui=await call('({modelCount:document.querySelector("#model")?.options.length,history:document.querySelector("#history")?.children.length,body:document.body.innerText})');if(!ui.modelCount||ui.history<2)throw Error('Workbench did not load models/history');
 for(const mode of ['light','dark']){nativeTheme.themeSource=mode;await wait(150);fs.writeFileSync(${JSON.stringify(output)}+'/'+mode+'.png',(await component.webContents.capturePage()).toPNG());}
 component.destroy();
 step='speech configure';await renderer(main,'window.mam.saveModelConnection('+JSON.stringify({displayName:'Native fixture speech',protocol:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'native-fixture-key',remoteModelId:'tts-1'})+')');
 selectedPackage=${JSON.stringify(speechPath)};await renderer(main,'window.mamCreative.install()');await renderer(main,'window.mamCreative.enable("creative.speech",'+JSON.stringify(${JSON.stringify(speechManifest.version)})+')');await renderer(main,'window.mamCreative.open("creative.speech")');component=BrowserWindow.getAllWindows().find(w=>w!==main);
 const voiceModels=await call('window.componentHost.request({action:"listModels"})');const voiceModel=voiceModels.find(m=>m.kind==='speech');if(!voiceModel)throw Error('No speech route');
 step='speech generation';const speechJob=await call('window.componentHost.request('+JSON.stringify({action:'submit',operation:'speech.generate',idempotencyKey:'native-speech-1',params:{modelProfileId:voiceModel.id,prompt:'Hello from MAM',voice:'alloy',outputFormat:'wav'},inputAssets:[]})+')');
 for(let i=0;i<100;i++){job=(await call('window.componentHost.request({action:"listJobs"})')).find(j=>j.id===speechJob);if(['succeeded','failed'].includes(job?.state))break;await wait(100)}
 if(job?.state!=='succeeded')throw Error('Speech generation failed '+JSON.stringify(job));const audio=job.events.find(e=>e.type==='asset')?.data;
 const audioUrl=await call('window.componentHost.request('+JSON.stringify({action:'previewAsset',ref:audio})+')');
 const duration=await call('(async()=>{const a=new Audio('+JSON.stringify(audioUrl)+');await new Promise((ok,fail)=>{a.onloadedmetadata=ok;a.onerror=fail;});return a.duration})()');if(Math.abs(duration-1)>0.01)throw Error('Speech playback invalid');
 await call('window.componentHost.request('+JSON.stringify({action:'exportAsset',ref:audio})+')');if(!fs.readFileSync(${JSON.stringify(outputPath)}).equals(wav))throw Error('Speech export bytes changed');
 const noForeignJobs=(await call('window.componentHost.request({action:"listJobs"})')).every(j=>j.request.componentId==='creative.speech');if(!noForeignJobs)throw Error('Cross component job leak');
 finish({passed:true,generation:true,referenceEdit:true,speech:true,speechDuration:duration,backgroundCompletion:true,idempotency:true,secretNotExposed:true,requests:requests.map(({body,...safe})=>safe),preview,byteExactExport:true,uiHistory:ui.history,componentVersion:${JSON.stringify(manifest.version)},scope:'local HTTP fixture; no live provider call'});
}
import(${JSON.stringify(pathToFileURL(join(root, 'out/main/index.js')).href)}).then(()=>app.whenReady()).then(test).catch(e=>finish({passed:false,error:String(e),stack:e.stack}));
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
const result = await readFile(reportPath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ passed: false, diagnostics }))
await writeFile(join(output, 'latest.json'), JSON.stringify({ ...result, code }, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!result.passed || code !== 0) process.exitCode = 1
