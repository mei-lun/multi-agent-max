import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const managed = path.join(root, 'vendor/levelup')
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex')
const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 })
export function safe(p) {
  if (
    typeof p !== 'string' ||
    !p ||
    /[\\:<>"|?*]/.test(p) ||
    [...p].some((character) => character.charCodeAt(0) < 32) ||
    p.split('/').some((s) => !s || s === '.' || s === '..' || /[. ]$/.test(s)) ||
    p.startsWith('/') ||
    p.toLowerCase() === 'provenance.json' ||
    p.split('/').some((s) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))
  )
    throw Error(`Unsafe path: ${p}`)
  return p
}
function destination(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('Invalid destination name')
  for (let p = managed; p !== path.dirname(p); p = path.dirname(p))
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error('Symlink destination')
  return path.join(managed, name)
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
function write(dir, p, bytes) {
  safe(p)
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
  fs.writeFileSync(path.join(dir, p), bytes)
}
function selectionCheck(s) {
  if (!s || !Array.isArray(s.rules) || !s.rules.length) throw Error('Invalid selection')
  for (const r of s.rules) safe(r.prefix)
}
function dependencies(dir, files) {
  const edges = []
  for (const f of files.filter((f) => /\.[cm]?[jt]sx?$/.test(f.path))) {
    for (const match of fs
      .readFileSync(path.join(dir, f.path), 'utf8')
      .matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), match[1]))
      const resolved = [
        '',
        '.ts',
        '.tsx',
        '.js',
        '.mjs',
        '.json',
        '.css',
        '/index.ts',
        '/index.tsx'
      ]
        .map((e) => base + e)
        .find((p) => files.some((f) => f.path === p))
      edges.push({ source: f.path, import: match[1], resolved: resolved ?? null })
    }
  }
  return {
    dependencyEdges: edges,
    dependencyGaps: edges
      .filter((e) => !e.resolved)
      .map((e) => ({
        ...e,
        action: 'Explicit adapter/exclusion required; no automatic semantic closure'
      }))
  }
}
export function verify(dir) {
  for (
    let current = path.resolve(dir);
    current !== path.dirname(current);
    current = path.dirname(current)
  )
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink snapshot directory')
  if (fs.lstatSync(path.join(dir, 'provenance.json')).isSymbolicLink())
    throw Error('Symlink provenance')
  const m = read(path.join(dir, 'provenance.json'))
  selectionCheck(m.selection)
  if (
    m.schema !== 1 ||
    !/^[a-f0-9]{40}$/.test(m.commit) ||
    !Array.isArray(m.files) ||
    !m.files.length
  )
    throw Error('Invalid provenance')
  const seen = new Set()
  for (const f of m.files) {
    safe(f.path)
    if (
      seen.has(f.path.toLowerCase()) ||
      !/^[a-f0-9]{40}$/.test(f.oid) ||
      !/^[a-f0-9]{64}$/.test(f.sha256) ||
      !['100644', '100755'].includes(f.mode) ||
      f.type !== 'blob'
    )
      throw Error('Invalid inventory')
    seen.add(f.path.toLowerCase())
    let current = dir
    for (const part of f.path.split('/')) {
      current = path.join(current, part)
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink snapshot')
    }
    if (hash(fs.readFileSync(current)) !== f.sha256) throw Error(`Hash mismatch: ${f.path}`)
  }
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? walk(path.join(d, e.name))
          : [path.relative(dir, path.join(d, e.name)).split(path.sep).join('/')]
      )
  if (walk(dir).some((p) => p !== 'provenance.json' && !m.files.some((f) => f.path === p)))
    throw Error('Undeclared inventory file')
  return m
}
function promote(name, build) {
  const dest = destination(name)
  if (fs.existsSync(dest))
    throw Error('Destination exists; use a new candidate name (adapted files are never replaced)')
  fs.mkdirSync(managed, { recursive: true })
  const stage = fs.mkdtempSync(path.join(managed, '.stage-'))
  try {
    const m = build(stage)
    Object.assign(m, dependencies(stage, m.files))
    fs.writeFileSync(path.join(stage, 'provenance.json'), JSON.stringify(m, null, 2) + '\n')
    verify(stage)
    fs.renameSync(stage, dest)
    return m
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true })
    throw e
  }
}
export function snapshot(repo, ref, selection, name) {
  selectionCheck(selection)
  destination(name)
  const source = fs.realpathSync(git(repo, 'rev-parse', '--show-toplevel').toString().trim())
  const relative = path.relative(source, managed)
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw Error('Destination overlaps read-only source')
  const commit = git(repo, 'rev-parse', '--verify', `${ref}^{commit}`).toString().trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Expected full commit SHA')
  const tree = git(repo, 'ls-tree', '-rz', commit)
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf('\t')
      const meta = line.slice(0, at),
        p = line.slice(at + 1)
      const [mode, type, oid] = meta.split(' ')
      return { mode, type, oid, path: p }
    })
  for (const r of selection.rules)
    if (!tree.some((f) => f.path.startsWith(r.prefix)))
      throw Error(`Unmatched selection rule: ${r.prefix}`)
  const selected = tree.filter((f) => selection.rules.some((r) => f.path.startsWith(r.prefix)))
  const seen = new Set()
  for (const f of selected) {
    safe(f.path)
    const key = f.path.toLowerCase()
    if (seen.has(key)) throw Error('Case collision')
    seen.add(key)
    if (f.type !== 'blob' || !['100644', '100755'].includes(f.mode))
      throw Error(`Unsupported entry: ${f.path}`)
  }
  return promote(name, (stage) => {
    const files = selected.map((f) => {
      const bytes = git(repo, 'show', `${commit}:${f.path}`)
      write(stage, f.path, bytes)
      return { ...f, sha256: hash(bytes) }
    })
    const gaps = []
    for (const f of files.filter((f) => /\.[cm]?[jt]sx?$/.test(f.path))) {
      const text = fs.readFileSync(path.join(stage, f.path), 'utf8')
      for (const match of text.matchAll(/(?:from\s*|import\s*\(|import\s*)['"](\.[^'"]+)['"]/g)) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), match[1]))
        if (
          !['', '.ts', '.tsx', '.js', '.mjs', '.json', '.css', '/index.ts', '/index.tsx'].some(
            (ext) => seen.has((base + ext).toLowerCase())
          )
        )
          gaps.push({
            source: f.path,
            import: match[1],
            action: 'Select dependency or replace with an explicit MAM adapter'
          })
      }
    }
    return {
      schema: 1,
      commit,
      selection,
      files,
      dependencyGaps: gaps,
      dependencyAnalysis: 'Relative JS/TS imports only; no semantic dependency resolution'
    }
  })
}
export function replay(source, patches, name) {
  const baseline = verify(destination(source))
  return promote(name, (stage) => {
    const m = structuredClone(baseline)
    m.adaptedFrom = source
    m.patches = patches
    for (const f of m.files)
      write(stage, f.path, fs.readFileSync(path.join(destination(source), f.path)))
    for (const p of patches) {
      safe(p.path)
      const f = m.files.find((f) => f.path === p.path)
      if (!f) throw Error('Patch file absent')
      const bytes = fs.readFileSync(path.join(stage, p.path))
      if (!p.before || !p.after || hash(bytes) !== p.expectedSha256)
        throw Error('Patch baseline conflict')
      const before = Buffer.from(p.before, 'base64'),
        after = Buffer.from(p.after, 'base64')
      const at = bytes.indexOf(before)
      if (!before.length || at < 0 || bytes.indexOf(before, at + 1) >= 0)
        throw Error('Patch context missing or ambiguous')
      const next = Buffer.concat([bytes.subarray(0, at), after, bytes.subarray(at + before.length)])
      write(stage, p.path, next)
      f.sha256 = hash(next)
    }
    return m
  })
}
export function diff(a, b) {
  const old = verify(destination(a)),
    next = verify(destination(b))
  const additions = next.files.filter((f) => !old.files.some((o) => o.path === f.path))
  const deletions = old.files.filter((f) => !next.files.some((n) => n.path === f.path))
  return {
    additions,
    deletions,
    modifications: next.files.filter((f) =>
      old.files.some((o) => o.path === f.path && o.sha256 !== f.sha256)
    ),
    renames: additions.flatMap((n) =>
      deletions.filter((o) => o.sha256 === n.sha256).map((o) => ({ from: o.path, to: n.path }))
    ),
    possibleDependencyChanges: {
      before: old.dependencyEdges ?? old.dependencyGaps,
      after: next.dependencyEdges ?? next.dependencyGaps
    },
    reviewRequired: true
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2)
  const result =
    cmd === 'snapshot'
      ? snapshot(args[0], args[1], read(args[2]), args[3])
      : cmd === 'verify'
        ? verify(destination(args[0]))
        : cmd === 'diff'
          ? diff(...args)
          : cmd === 'replay'
            ? replay(args[0], read(args[1]), args[2])
            : (() => {
                throw Error('Use snapshot, verify, diff, replay')
              })()
  console.log(JSON.stringify(result, null, 2))
}
