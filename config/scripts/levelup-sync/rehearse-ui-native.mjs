import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import ts from 'typescript'
const repo = process.argv[2] ?? 'D:/Github-Poj/LevelUpAgent'
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024 }).toString()
const newer = git('rev-parse', '88c84da^{commit}').trim(),
  older = git('rev-parse', `${newer}^`).trim()
const output = join(process.cwd(), '.mam-local', 'upstream-ui-native', String(Date.now()))
mkdirSync(output, { recursive: true })
const paths = [
  'src/components/MusicWorkbench.tsx',
  'src-tauri/src/music_workbench.rs',
  'modules/music_workbench/bridge.py',
  'modules/music_workbench/song-resources.json',
  'packaging/music-workbench/README.md'
]
const sha = (text) => createHash('sha256').update(text).digest('hex')
const inventory = []
for (const path of paths) {
  const before = git('show', `${older}:${path}`),
    after = git('show', `${newer}:${path}`)
  const entry = { path, before: sha(before), after: sha(after), review: 'manual-review-required' }
  if (path.endsWith('.tsx')) {
    const anchor = 'import { open, save } from "@tauri-apps/plugin-dialog";'
    if (before.split(anchor).length !== 2 || after.split(anchor).length !== 2)
      throw Error('Adapter patch context conflict')
    const patch = 'const { open, save } = globalThis.__MAM_NATIVE_DIALOG_ADAPTER__;'
    const adapted = after.replace(anchor, patch)
    if (!adapted.includes('Reference audio (optional)') || !adapted.includes('import_reference'))
      throw Error('Real upstream reference audio UI change lost')
    const transpiled = ts.transpileModule(adapted, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true
    })
    if (transpiled.diagnostics?.length) throw Error('Adapted source syntax failed')
    writeFileSync(join(output, 'MusicWorkbench.candidate.tsx'), adapted)
    const rollback = before.replace(anchor, patch)
    if (rollback.includes('async function importReference()'))
      throw Error('Rollback did not retain old source identity')
    entry.adapterPatchPreserved = true
    entry.candidateHash = sha(adapted)
    entry.rollbackHash = sha(rollback)
    entry.review = 'syntax-and-upstream-feature-inventory-only; native-render-not-run'
  }
  inventory.push(entry)
}
const nativeDiff = git('diff', older, newer, '--', 'src-tauri/src/music_workbench.rs')
if (!nativeDiff.includes('import_reference') || !nativeDiff.includes('120'))
  throw Error('Native protocol change not present')
const report = {
  older,
  newer,
  output,
  inventory,
  nativeProtocol: {
    operation: 'import_reference',
    timeoutSeconds: 120,
    semanticReview: 'manual-review-required'
  },
  nativeExecuted: false,
  liveInference: 'not_run',
  g4: 'partial'
}
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
