import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url),
  root = process.cwd(),
  output = join(root, '.mam-local/native-workbenches-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-'))
const packages = []
for (const id of ['music', 'model3d', 'constellation', 'video']) {
  const directory = join(root, '.mam-local/component-packages', 'creative-' + id)
  packages.push({
    id: 'creative.' + id,
    directory,
    manifest: JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  })
}
const report = join(run, 'result.json'),
  script = `
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});
const packages=${JSON.stringify(packages)},messages=[],results=[];let current,step='start';
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[current.directory]});dialog.showMessageBox=async()=>({response:1});
app.on('browser-window-created',(_e,w)=>{const label=current?.id??'main';w.show=()=>{};w.webContents.on('console-message',(_e,_l,m)=>messages.push(label+': '+m))});
const timer=setTimeout(()=>finish({passed:false,error:'timeout'}),90000),wait=ms=>new Promise(r=>setTimeout(r,ms));function finish(result){clearTimeout(timer);fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({...result,step,results,messages},null,2));app.exit(result.passed?0:1)}
async function test(){let main;for(let i=0;i<100;i++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));if(main&&await main.webContents.executeJavaScript('Boolean(window.mamCreative)').catch(()=>false))break;await wait(100)}if(!main)throw Error('No main');const m=s=>main.webContents.executeJavaScript(s);
for(current of packages){step=current.id;await m('window.mamCreative.install()');await m('window.mamCreative.enable('+JSON.stringify(current.id)+','+JSON.stringify(current.manifest.version)+')');await m('window.mamCreative.open('+JSON.stringify(current.id)+')');const view=BrowserWindow.getAllWindows().find(w=>w!==main);if(!view)throw Error('No view '+current.id);const c=s=>view.webContents.executeJavaScript(s,true);await wait(1000);const initial=await c('document.body.innerText');if(initial.length<30)throw Error('Empty workbench '+current.id);
if(['creative.music','creative.model3d'].includes(current.id)){const operation=current.id==='creative.music'?'music.status':'model3d.status';const id=await c('window.componentHost.request('+JSON.stringify({action:'submit',operation,idempotencyKey:current.id+'-native-status',params:{},inputAssets:[]})+')');let job;for(let i=0;i<150;i++){job=(await c('window.componentHost.request({action:"listJobs"})')).find(x=>x.id===id);if(['succeeded','failed'].includes(job?.state))break;await wait(100)}if(job?.state!=='succeeded')throw Error('Native status failed '+JSON.stringify(job));const status=job.events.at(-1).data;if(current.id==='creative.music'&&(!status.memory||!Array.isArray(status.jobs)||status.ready))throw Error('Music unavailable state invalid');if(current.id==='creative.model3d'&&(!status.system||!Array.isArray(status.projects)))throw Error('3D status invalid');results.push({component:current.id,status:true,resourcesInstalled:false});}
else results.push({component:current.id,rendered:true});await wait(500);await fs.promises.writeFile(${JSON.stringify(output)}+'/'+current.id+'.png',(await view.webContents.capturePage()).toPNG());view.close();for(let i=0;i<300&&!view.isDestroyed();i++)await wait(100);if(!view.isDestroyed())throw Error('Workbench save veto '+current.id);await wait(100)}
if(messages.some(m=>/Uncaught|TypeError:|ReferenceError:/.test(m)))throw Error('Renderer error '+messages.join(';'));finish({passed:true,scope:'real host component rendering and no-resource statuses; no GPU inference'});}
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
