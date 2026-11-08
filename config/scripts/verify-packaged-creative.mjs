import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = process.cwd(),
  output = join(root, '.mam-local/packaged-creative-qa')
await mkdir(output, { recursive: true })
const run = await mkdtemp(join(output, 'run-')),
  userData = join(run, 'user-data'),
  storage = join(userData, 'mam/components')
const corePath = join(run, 'writing-core.cjs')
await build({
  entryPoints: [join(root, 'vendor/levelup/baseline-6542241/src/lib/writing.ts')],
  outfile: corePath,
  platform: 'node',
  format: 'cjs',
  bundle: true
})
const project = createRequire(import.meta.url)(corePath).createWritingProject()
project.documents[0].content = 'PACKAGED BACKEND EXPORT'
const release = join(
    root,
    'release/creative-components',
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
  ),
  catalog = JSON.parse(await readFile(join(release, 'catalog.json'), 'utf8'))
const records = [],
  active = {}
const entries = Array.isArray(catalog)
  ? catalog
  : (catalog.components ?? catalog.entries ?? catalog.packages)
if (!Array.isArray(entries)) throw Error('Catalog entries missing')
for (const entry of entries) {
  const id = entry.id ?? entry.componentId,
    directory = join(release, entry.path),
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  await cp(directory, join(storage, 'packages', id, manifest.version), { recursive: true })
  records.push({ manifest, verification: 'trusted-local-import' })
  active[id] = manifest.version
}
await writeFile(
  join(storage, 'registry.json'),
  JSON.stringify({ schemaVersion: 1, installed: records, active })
)
const environment = { ...process.env, MAM_CREATIVE_PREVIEW_DATA: userData }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.MAM_PROJECT_DIRECTORY
delete environment.MAM_DESKTOP_SMOKE
const child = spawn(
  join(root, 'release/win-unpacked/Multi-Agent Max.exe'),
  ['--remote-debugging-port=0'],
  { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
)
let logs = ''
child.stderr.on('data', (c) => {
  logs = (logs + c).slice(-10000)
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let ws,
  id = 0
const awaiting = new Map()
try {
  let port
  for (let n = 0; n < 200; n++) {
    try {
      port = Number((await readFile(join(userData, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
      break
    } catch {}
    await wait(100)
  }
  if (!port) throw Error('Packaged debugger unavailable ' + logs)
  let target
  for (let n = 0; n < 100; n++) {
    target = (await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json())).find(
      (t) => t.type === 'page' && t.url.startsWith('file:')
    )
    if (target) break
    await wait(100)
  }
  if (!target) throw Error('Packaged renderer missing')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', fail, { once: true })
  })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id) {
      const p = awaiting.get(m.id)
      awaiting.delete(m.id)
      if (m.error) p?.reject(Error(JSON.stringify(m.error)))
      else p?.resolve(m.result)
    }
  })
  const command = (method, params) =>
    new Promise((resolve, reject) => {
      const ticket = ++id
      awaiting.set(ticket, { resolve, reject })
      ws.send(JSON.stringify({ id: ticket, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  let list
  for (let n = 0; n < 100; n++) {
    try {
      list = await evaluate('window.mamCreative.list()')
      break
    } catch {
      await wait(100)
    }
  }
  if (list?.length !== 8 || list.some((c) => !c.versions.some((v) => v.enabled)))
    throw Error('Packaged catalog failed')
  await evaluate('window.mamCreative.open("creative.writing")')
  await wait(700)
  const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json())
  if (!pages.some((p) => p.url.startsWith('mam-component://')))
    throw Error('Packaged component failed to load')
  ws.close()
  const componentPage = pages.find((page) => page.url.startsWith('mam-component://'))
  ws = new WebSocket(componentPage.webSocketDebuggerUrl)
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', fail, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data),
      pending = awaiting.get(message.id)
    if (!pending) return
    awaiting.delete(message.id)
    if (message.error) pending.reject(Error(JSON.stringify(message.error)))
    else pending.resolve(message.result)
  })
  const submission = {
    action: 'submit',
    operation: 'writing.project.export',
    idempotencyKey: 'packaged-backend',
    params: { project, format: 'markdown' },
    inputAssets: []
  }
  const jobId = await evaluate(`window.componentHost.request(${JSON.stringify(submission)})`)
  let completed
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = await evaluate('window.componentHost.request({action:"listJobs"})')
    completed = jobs.find((job) => job.id === jobId)
    if (['succeeded', 'failed', 'reconciliation-required'].includes(completed?.state)) break
    await wait(100)
  }
  if (completed?.state !== 'succeeded')
    throw Error('Packaged backend failed: ' + JSON.stringify(completed?.events.at(-1)))
  const ref = completed.events.findLast((event) => event.type === 'succeeded').data.assets[0]
  const url = await evaluate(
    `window.componentHost.request(${JSON.stringify({ action: 'previewAsset', ref })})`
  )
  const exported = await evaluate(`fetch(${JSON.stringify(url)}).then(response=>response.text())`)
  if (!exported.includes('PACKAGED BACKEND EXPORT'))
    throw Error('Packaged backend returned incorrect artifact bytes')
  const result = {
    passed: true,
    executable: 'release/win-unpacked/Multi-Agent Max.exe',
    catalogEntries: list.length,
    allEnabled: true,
    componentOpened: true,
    packageBackendExecuted: true,
    artifactPreviewVerified: true,
    scope: 'packaged executable with isolated seeded data; no model calls'
  }
  await writeFile(join(output, 'latest.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const result = { passed: false, error: String(error), logs }
  await writeFile(join(output, 'latest.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = 1
} finally {
  ws?.close()
  child.kill()
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve()
    else {
      child.once('exit', resolve)
      setTimeout(resolve, 5000)
    }
  })
}
