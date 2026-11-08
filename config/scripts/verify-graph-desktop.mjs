import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const require = createRequire(import.meta.url),
  root = process.cwd()
const output = join(root, '.mam-local/graph-desktop-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-')),
  source = join(run, 'files')
await mkdir(source)
await writeFile(join(source, 'input.txt'), 'ORIGINAL FILE COBALT')
const corePath = join(run, 'core.cjs')
await build({
  entryPoints: [join(root, 'vendor/levelup/baseline-6542241/src/lib/constellation.ts')],
  outfile: corePath,
  platform: 'node',
  format: 'cjs',
  bundle: true
})
const core = require(corePath),
  graph = core.createDefaultConstellationGraph()
const original = graph.nodes.find((node) => node.data.kind === 'image')
const input = core.createConstellationNode('input', graph.nodes[0].position)
input.id = graph.nodes[0].id
input.data.inputMode = 'file'
graph.nodes[0] = input
const writing = core.createConstellationNode('writing', original.position)
writing.id = original.id
writing.data.prompt = 'Summarize the file'
graph.nodes = graph.nodes.map((node) => (node.id === original.id ? writing : node))
graph.edges[0].sourceHandle = 'text'
graph.edges[0].targetHandle = 'context'
graph.edges[1].sourceHandle = 'text'
const toolGraph = core.createDefaultConstellationGraph(),
  tool = core.createConstellationNode('localTool', original.position)
tool.data.legacyToolName = 'read_file'
tool.data.toolArguments = JSON.stringify({ path: 'input.txt' })
const out = toolGraph.nodes.find((node) => node.data.kind === 'output')
toolGraph.nodes = [tool, out]
toolGraph.edges = [
  { id: 'tool-out', source: tool.id, sourceHandle: 'text', target: out.id, targetHandle: 'media' }
]
const conversationGraph = structuredClone(toolGraph),
  conversation = core.createConstellationNode('conversation', original.position)
conversation.data.sessionCommand = 'Remember cobalt'
conversationGraph.nodes[0] = conversation
conversationGraph.edges[0].source = conversation.id
const packagePath = join(root, '.mam-local/component-packages/creative-constellation')
const manifest = JSON.parse(await readFile(join(packagePath, 'manifest.json'), 'utf8'))
const report = join(run, 'result.json')
const script = `
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),http=require('node:http');
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(run, 'user-data'))});let stage='startup',requests=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push(JSON.parse(body));res.setHeader('content-type','text/event-stream');const nl=String.fromCharCode(10,10);setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:'COBALT OUTPUT'},finish_reason:'stop'}]})+nl+'data: [DONE]'+nl),150)});});
dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async(...args)=>({canceled:false,filePaths:[String(args.at(-1)?.title||'').includes('tool workspace')?${JSON.stringify(source)}:stage==='import-file'?${JSON.stringify(join(source, 'input.txt'))}:${JSON.stringify(packagePath)}]});
app.on('browser-window-created',(_e,w)=>{w.show=()=>{}});const wait=ms=>new Promise(r=>setTimeout(r,ms));const timer=setTimeout(()=>finish({passed:false,error:'timeout'}),60000);
function finish(result){clearTimeout(timer);server.close();fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({...result,stage}));app.exit(result.passed?0:1)}
async function test(){await new Promise(r=>server.listen(0,'127.0.0.1',r));let main;for(let i=0;i<100;i++){main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));if(main&&await main.webContents.executeJavaScript('Boolean(window.mamCreative&&window.mam)').catch(()=>false))break;await wait(100)}const m=s=>main.webContents.executeJavaScript(s);await m('window.mam.saveModelConnection('+JSON.stringify({displayName:'Graph fixture',protocol:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',apiKey:'graph-fixture',remoteModelId:'gpt-graph-fixture'})+')');await m('window.mamCreative.install()');await m('window.mamCreative.enable("creative.constellation",'+JSON.stringify(${JSON.stringify(manifest.version)})+')');await m('window.mamCreative.open("creative.constellation")');let component=BrowserWindow.getAllWindows().find(w=>w!==main);const c=s=>component.webContents.executeJavaScript(s,true);await wait(500);const host=input=>c('window.componentHost.request('+JSON.stringify(input)+')');
stage='import-file';const ref=await host({action:'importAsset',kind:'file'});const graph=${JSON.stringify(graph)};graph.nodes[0].data.inputAttachments=[{id:ref.id,assetRef:ref,name:ref.filename,mimeType:ref.mime,size:ref.bytes,kind:'file'}];graph.nodes[0].data.inputPath=ref.id;
const execute=async(graph,key,refs=[])=>{const jobId=await host({action:'submit',operation:'constellation.graph.execute',idempotencyKey:key,params:{graph},inputAssets:refs});for(let i=0;i<150;i++){const job=(await host({action:'listJobs'})).find(x=>x.id===jobId);if(['succeeded','failed','reconciliation-required'].includes(job?.state)){if(job.state!=='succeeded')throw Error('Graph job failed '+JSON.stringify(job.events.at(-1)));const result=job.events.findLast(e=>e.type==='succeeded').data;if(result.partial)throw Error('Partial graph '+JSON.stringify(result.graph.nodes.map(n=>({kind:n.data.kind,error:n.data.error}))));return result}await wait(100)}throw Error('Graph timeout')};
stage='file-graph';await execute(graph,'file-graph',[ref]);if(!JSON.stringify(requests[0]).includes('ORIGINAL FILE COBALT'))throw Error('File bytes not forwarded '+JSON.stringify(requests).slice(0,3000));
stage='authorized-tool';const toolResult=await execute(${JSON.stringify(toolGraph)},'tool-graph');if(!JSON.stringify(toolResult.outputs).includes('ORIGINAL FILE COBALT'))throw Error('Local tool did not execute');
stage='conversation';const conv=${JSON.stringify(conversationGraph)},first=await execute(conv,'conversation-one');const existing=first.graph.nodes.find(n=>n.data.kind==='conversation');if(!existing.data.conversationThreadId)throw Error('Conversation has no real job identity');existing.data.sessionCommand='Recall earlier color';existing.data.status='stale';await execute(first.graph,'conversation-two');if(!JSON.stringify(requests.at(-1)).includes('Remember cobalt')||!JSON.stringify(requests.at(-1)).includes('COBALT OUTPUT'))throw Error('Conversation history not included');
finish({passed:true,originalGraphRuntime:true,authorizedFileBytes:true,authorizedLocalTool:true,persistentConversation:true,requestCount:requests.length,scope:'real Electron+package processes with local HTTP; no paid inference'});
}
import(${JSON.stringify(pathToFileURL(join(root, 'out/main/index.js')).href)}).then(()=>app.whenReady()).then(test).catch(e=>finish({passed:false,error:String(e),stack:e.stack}));
`
await writeFile(join(run, 'main.cjs'), script)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.MAM_PROJECT_DIRECTORY
const child = spawn(require('electron'), [join(run, 'main.cjs')], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
})
let diagnostic = ''
child.stderr.on('data', (chunk) => {
  diagnostic = (diagnostic + chunk).slice(-3000)
})
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
const result = await readFile(report, 'utf8')
  .then(JSON.parse)
  .catch(() => ({ passed: false, diagnostic }))
await writeFile(join(output, 'latest.json'), JSON.stringify({ ...result, code }, null, 2))
console.log(JSON.stringify(result, null, 2))
if (!result.passed || code !== 0) process.exitCode = 1
