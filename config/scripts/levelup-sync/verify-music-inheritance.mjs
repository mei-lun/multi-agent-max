import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { snapshot, replay, destination } from './sync.mjs'
import { rebase } from './rebase.mjs'
export function verifyMusicInheritance(repo, prefix = 'music-semantic') {
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', '88c84da^{commit}'])
      .toString()
      .trim(),
    oldCommit = execFileSync('git', ['-C', repo, 'rev-parse', commit + '^'])
      .toString()
      .trim()
  const selection = {
      rules: [
        { prefix: 'src/lib/musicWorkbench.ts', component: 'creative.music', target: 'patched' }
      ]
    },
    oldName = prefix + '-old',
    newName = prefix + '-new',
    candidate = prefix + '-candidate',
    replayed = prefix + '-replay'
  const old = snapshot(repo, oldCommit, selection, oldName)
  snapshot(repo, commit, selection, newName)
  const before = 'import { convertFileSrc, invoke } from "@tauri-apps/api/core";',
    after =
      'const convertFileSrc = (value: string) => value; const invoke = async (..._args: unknown[]) => { throw new Error("MAM bridge required"); };'
  const patches = [
    {
      path: 'src/lib/musicWorkbench.ts',
      expectedSha256: old.files[0].sha256,
      before: Buffer.from(before).toString('base64'),
      after: Buffer.from(after).toString('base64')
    }
  ]
  const result = rebase(oldName, newName, patches, candidate)
  replay(newName, result.patches, replayed)
  const evaluate = (name) => {
    let source = fs.readFileSync(path.join(destination(name), 'src/lib/musicWorkbench.ts'), 'utf8')
    source = source.replace(before, after)
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText
    const context = { exports: {} }
    vm.runInNewContext(compiled, context, { timeout: 1000 })
    return JSON.parse(
      JSON.stringify(
        context.exports.normalizeMusicParams({
          engine: 'yue2',
          duration: 500,
          reference_id: 'a'.repeat(32),
          reference_name: 'reference',
          reference_duration: 120
        })
      )
    )
  }
  const previous = evaluate(oldName),
    updated = evaluate(candidate)
  if (
    previous.duration !== 60 ||
    updated.duration !== 500 ||
    previous.reference_id ||
    updated.reference_id !== 'a'.repeat(32)
  )
    throw Error('Real normalization inheritance failed')
  if (
    !fs
      .readFileSync(path.join(destination(candidate), 'src/lib/musicWorkbench.ts'))
      .equals(fs.readFileSync(path.join(destination(replayed), 'src/lib/musicWorkbench.ts')))
  )
    throw Error('Real regenerated replay differs')
  return {
    oldCommit,
    commit,
    previous,
    updated,
    candidate,
    replayed,
    patches: result.patches,
    meaning:
      'Real YuE2 normalization update preserves500s duration and authorized reference metadata; existing MAM bridge adaptation retained; no GPU inference claim'
  }
}
if (process.argv[2])
  console.log(JSON.stringify(verifyMusicInheritance(process.argv[2], process.argv[3]), null, 2))
