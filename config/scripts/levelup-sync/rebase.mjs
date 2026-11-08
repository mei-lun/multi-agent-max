import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { destination, verify, promote, dependencies, safe, diff } from './sync.mjs'
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
function apply(bytes, patch) {
  if (hash(bytes) !== patch.expectedSha256) throw Error('Patch baseline conflict')
  const before = Buffer.from(patch.before, 'base64'),
    after = Buffer.from(patch.after, 'base64'),
    at = bytes.indexOf(before)
  if (!before.length || at < 0 || bytes.indexOf(before, at + 1) >= 0)
    throw Error('Patch context missing or ambiguous')
  return Buffer.concat([bytes.subarray(0, at), after, bytes.subarray(at + before.length)])
}
function region(before, after) {
  let start = 0,
    end = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++
  if (start === before.length && start === after.length) return
  // Include enough unchanged context to make insertions and repeated text replayable.
  start = Math.max(0, start - 80)
  end = Math.max(0, end - 80)
  for (;;) {
    const context = before.subarray(start, before.length - end),
      at = before.indexOf(context)
    if (context.length && at === start && before.indexOf(context, at + 1) < 0)
      return {
        before: context.toString('base64'),
        after: after.subarray(start, after.length - end).toString('base64')
      }
    if (!start && !end) throw Error('Cannot create bounded replay region')
    start = Math.max(0, start - 80)
    end = Math.max(0, end - 80)
  }
}
export function rebase(oldName, newName, input, name) {
  const old = verify(destination(oldName)),
    next = verify(destination(newName)),
    patches = Array.isArray(input) ? input : input.patches,
    mappings = Array.isArray(input) ? [] : (input.adapters ?? [])
  if (!Array.isArray(patches)) throw Error('Expected patch inventory')
  const changes = diff(oldName, newName),
    conflicts = []
  let result
  try {
    result = promote(name, (stage) => {
      const manifest = structuredClone(next),
        regenerated = []
      for (const file of manifest.files) {
        const output = path.join(stage, safe(file.path))
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.copyFileSync(path.join(destination(newName), file.path), output)
      }
      for (const target of new Set(patches.map((patch) => safe(patch.path)))) {
        const oldFile = old.files.find((file) => file.path === target),
          newFile = next.files.find((file) => file.path === target)
        if (!oldFile || !newFile) {
          conflicts.push({
            path: target,
            reason: 'Deleted or renamed patched file; explicit migration required',
            renames: changes.renames.filter((rename) => rename.from === target)
          })
          continue
        }
        const base = fs.readFileSync(path.join(destination(oldName), target)),
          incoming = fs.readFileSync(path.join(destination(newName), target))
        let adapted = base
        for (const patch of patches.filter((patch) => patch.path === target))
          adapted = apply(adapted, patch)
        const temporary = fs.mkdtempSync(path.join(stage, '.merge-'))
        try {
          for (const [file, bytes] of [
            ['adapted', adapted],
            ['base', base],
            ['incoming', incoming]
          ])
            fs.writeFileSync(path.join(temporary, file), bytes)
          const merge = spawnSync(
            'git',
            [
              'merge-file',
              '-p',
              '--diff3',
              path.join(temporary, 'adapted'),
              path.join(temporary, 'base'),
              path.join(temporary, 'incoming')
            ],
            { maxBuffer: 64 * 1024 * 1024 }
          )
          if (merge.status !== 0) {
            conflicts.push({
              path: target,
              reason: 'Three-way conflict',
              hunks:
                (merge.stdout ?? Buffer.alloc(0))
                  .toString()
                  .match(/<<<<<<<[\s\S]*?>>>>>>>[^\n]*/g) ?? [],
              error: merge.error?.message
            })
            continue
          }
          const merged = merge.stdout
          if (/^(<<<<<<<|=======|>>>>>>>)/m.test(merged.toString()))
            throw Error('Conflict markers cannot be promoted')
          const patch = region(incoming, merged)
          if (patch) {
            const generated = {
              path: target,
              expectedSha256: hash(incoming),
              ...patch,
              sourceSha256: hash(base),
              transformedSha256: hash(merged)
            }
            if (!apply(incoming, generated).equals(merged))
              throw Error('Regenerated replay mismatch')
            regenerated.push(generated)
          }
          fs.writeFileSync(path.join(stage, target), merged)
          manifest.files.find((file) => file.path === target).sha256 = hash(merged)
        } finally {
          fs.rmSync(temporary, { recursive: true, force: true })
        }
      }
      const graph = dependencies(stage, manifest.files),
        oldEdges = new Set(
          (old.dependencyEdges ?? []).map((edge) =>
            JSON.stringify([edge.source, edge.import, edge.resolved])
          )
        )
      const newEdges = graph.dependencyEdges.filter(
        (edge) => !oldEdges.has(JSON.stringify([edge.source, edge.import, edge.resolved]))
      )
      for (const edge of newEdges)
        if (
          !mappings.some(
            (mapping) =>
              mapping.source === edge.source &&
              mapping.import === edge.import &&
              typeof mapping.reason === 'string' &&
              mapping.reason.trim()
          )
        )
          conflicts.push({
            ...edge,
            reason: 'New dependency requires explicit adapter mapping/review reason'
          })
      if (conflicts.length) {
        const error = new Error('Rebase blocked; candidate was not promoted')
        error.report = { old: oldName, new: newName, conflicts }
        throw error
      }
      manifest.adaptedFrom = newName
      manifest.rebasedFrom = oldName
      manifest.patches = regenerated
      manifest.adapters = mappings
      manifest.sourceMap = manifest.files.map((file) => ({
        path: file.path,
        owner: next.selection.rules
          .filter((rule) => file.path.startsWith(rule.prefix))
          .map((rule) => rule.component ?? rule.prefix),
        mapping: regenerated.some((patch) => patch.path === file.path)
          ? 'patched'
          : /\.(rs|py)$/.test(file.path)
            ? 'manual-review'
            : 'direct',
        sourceSha256: next.files.find((source) => source.path === file.path).sha256,
        transformedSha256: file.sha256
      }))
      manifest.dependencyAnalysis =
        'Bounded relative JS/TS import inventory; Rust/Python semantic dependencies require manual review'
      return manifest
    })
  } catch (error) {
    if (error.report) {
      const report = path.join(path.dirname(destination(name)), name + '-conflicts.json')
      if (fs.existsSync(report))
        throw Error('Conflict report already exists; choose new candidate name')
      fs.writeFileSync(report, JSON.stringify(error.report, null, 2) + '\n', { flag: 'wx' })
      error.message += '; report: ' + report
    }
    throw error
  }
  return {
    candidate: name,
    commit: result.commit,
    patches: result.patches,
    changes,
    sourceMap: result.sourceMap
  }
}
