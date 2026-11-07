import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import ts from 'typescript'

// This probe reads committed blobs only. Every generated file stays in MAM.
const require = createRequire(import.meta.url)
const root = process.cwd()
const source = resolve(process.argv[2] ?? '../LevelUpAgent')
const requestedRef = process.argv[3] ?? '6542241'
const sha = execFileSync(
  'git',
  ['-C', source, 'rev-parse', '--verify', `${requestedRef}^{commit}`],
  { encoding: 'utf8' }
).trim()
const cache = join(root, '.mam-local', 'creative-offscreen')
await mkdir(cache, { recursive: true })
const directory = await mkdtemp(join(cache, 'probe-'))
const sources = {}
for (const name of ['spineRenderer', 'spineMatting', 'spine']) {
  const path = `src/lib/${name}.ts`
  const bytes = execFileSync('git', ['-C', source, 'show', `${sha}:${path}`], {
    maxBuffer: 4 * 1024 * 1024
  })
  sources[path] = createHash('sha256').update(bytes).digest('hex')
  const code = ts.transpileModule(bytes.toString('utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText
  await writeFile(join(directory, `${name}.mjs`), code)
}
await writeFile(
  join(directory, 'probe.html'),
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; img-src data:; connect-src 'none'"><script type="module" src="probe.mjs"></script>`
)
await writeFile(
  join(directory, 'probe.mjs'),
  `
import { SpineRenderer } from './spineRenderer.mjs';
import { matteSpineSolidBackground } from './spineMatting.mjs';
import { sampleSpineKeys } from './spine.mjs';
globalThis.probe = async () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const source = document.createElement('canvas'); source.width = source.height = 8;
  const ctx = source.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,8,8);
  const image = new Image(); image.src = source.toDataURL('image/png'); await image.decode();
  const renderer = new SpineRenderer(canvas);
  renderer.begin(32,32,1,16,16,['part']);
  renderer.draw('part',image,[-8,-8,8,-8,8,8,-8,8],[0,0,1,0,1,1,0,1],[0,1,2,0,2,3]);
  const pixels = renderer.readPixels(32,32);
  const colored = Array.from({length:1024},(_,i)=>pixels[i*4+3]>0?1:0).reduce((a,b)=>a+b,0);
  renderer.dispose();
  const input = new Uint8ClampedArray(5*5*4).fill(255);
  input.set([200,0,0,255],12*4);
  const matte = matteSpineSolidBackground(input,5,5,10);
  const pose = sampleSpineKeys([{time:0,rotation:0,bend:0,x:0,y:0,curve:'linear'},{time:1,rotation:40,bend:10,x:8,y:4,curve:'linear'}],0.5);
  const mask = document.createElement('canvas'); mask.width=mask.height=5;
  mask.getContext('2d').putImageData(new ImageData(matte.pixels,5,5),0,0);
  return {colored,edgeAlpha:matte.pixels[3],centerAlpha:matte.pixels[12*4+3],sourceUnchanged:input[3]===255,pose,png:mask.toDataURL('image/png').startsWith('data:image/png;base64,'),nodeDisabled:typeof process==='undefined'};
};
`
)
const resultPath = join(directory, 'result.json')
await writeFile(
  join(directory, 'main.cjs'),
  `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(directory, 'user-data'))});
app.on('window-all-closed',()=>{});
const timer=setTimeout(()=>{fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({error:'timeout'}));app.exit(1)},30000);
app.whenReady().then(async()=>{
 let worker;
 try {
  const workbench=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  worker=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await worker.loadFile(${JSON.stringify(join(directory, 'probe.html'))});
  workbench.destroy();
  const result=await worker.webContents.executeJavaScript('globalThis.probe()');
  result.workbenchClosed=workbench.isDestroyed();
  fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result));
  clearTimeout(timer); worker.destroy(); app.exit(0);
 } catch(e) {fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({error:String(e)}));clearTimeout(timer);worker?.destroy();app.exit(1)}
});
`
)
const executable = require('electron')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [join(directory, 'main.cjs')], {
  cwd: root,
  windowsHide: true,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe']
})
let diagnostic = ''
child.stderr.on('data', (chunk) => {
  diagnostic = (diagnostic + chunk).slice(-4000)
})
const code = await new Promise((accept, reject) => {
  child.once('error', reject)
  child.once('exit', accept)
})
const result = await readFile(resultPath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ error: 'Probe exited without a result', code, diagnostic }))
const passed =
  code === 0 &&
  result.colored > 0 &&
  result.edgeAlpha === 0 &&
  result.centerAlpha === 255 &&
  result.sourceUnchanged &&
  result.pose.rotation === 20 &&
  result.png &&
  result.nodeDisabled &&
  result.workbenchClosed
const report = {
  passed,
  sourceCommit: sha,
  sourceFiles: sources,
  electron: require('electron/package.json').version,
  result,
  ...(!passed ? { diagnostic } : {})
}
await writeFile(join(cache, 'latest.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!passed) process.exitCode = 1
