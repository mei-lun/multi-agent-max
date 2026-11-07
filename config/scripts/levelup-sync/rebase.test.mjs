import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { snapshot, replay, verify } from './sync.mjs'
import { rebase } from './rebase.mjs'
test('three-way inherits fix preserves adapter regenerates replay and blocks conflicts/dependencies', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-test-')),
    id = 'rebase-' + Date.now(),
    names = [id, id + '-next', id + '-merged', id + '-replay', id + '-conflict', id + '-blocked']
  const git = (...args) => execFileSync('git', ['-C', repo, ...args]),
    vendor = path.resolve('vendor/levelup')
  try {
    git('init')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    git('config', 'core.autocrlf', 'false')
    const baseline =
      'export const normalize = value => value;\n' +
      Array.from({ length: 20 }, (_, i) => `// context ${i}\n`).join('') +
      'export const host = "upstream";\n'
    fs.writeFileSync(path.join(repo, 'a.mjs'), baseline)
    git('add', '.')
    git('commit', '-m', 'old')
    const old = snapshot(repo, 'HEAD', { rules: [{ prefix: 'a.mjs', component: 'music' }] }, id)
    const patches = [
      {
        path: 'a.mjs',
        expectedSha256: old.files[0].sha256,
        before: Buffer.from('"upstream"').toString('base64'),
        after: Buffer.from('"MAM"').toString('base64')
      }
    ]
    fs.writeFileSync(
      path.join(repo, 'a.mjs'),
      baseline.replace('value => value', 'value => value.trim()')
    )
    git('add', '.')
    git('commit', '-m', 'normalize fix')
    snapshot(repo, 'HEAD', { rules: [{ prefix: 'a.mjs', component: 'music' }] }, names[1])
    const result = rebase(id, names[1], patches, names[2])
    replay(names[1], result.patches, names[3])
    assert.deepEqual(
      fs.readFileSync(path.join(vendor, names[2], 'a.mjs')),
      fs.readFileSync(path.join(vendor, names[3], 'a.mjs'))
    )
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import {normalize,host} from ${JSON.stringify(new URL('file:///' + path.join(vendor, names[2], 'a.mjs').replaceAll('\\', '/')).href)};console.log(JSON.stringify([normalize(' fixed '),host]))`
    ])
      .toString()
      .trim()
    assert.equal(output, '["fixed","MAM"]')
    const conflict = [
      {
        ...patches[0],
        before: Buffer.from('value => value').toString('base64'),
        after: Buffer.from('value => String(value)').toString('base64')
      }
    ]
    assert.throws(
      () => rebase(id, names[1], conflict, names[4]),
      (error) => error.report.conflicts.some((item) => item.hunks.length)
    )
    assert.ok(!fs.existsSync(path.join(vendor, names[4])))
    fs.appendFileSync(path.join(repo, 'a.mjs'), 'import "./new-dependency.mjs";\n')
    git('add', '.')
    git('commit', '-m', 'new dependency')
    const dependency = id + '-dependency'
    names.push(dependency)
    snapshot(repo, 'HEAD', { rules: [{ prefix: 'a.mjs' }] }, dependency)
    assert.throws(
      () => rebase(id, dependency, patches, names[5]),
      (error) => error.report.conflicts.some((item) => item.import === './new-dependency.mjs')
    )
    assert.equal(verify(path.join(vendor, id)).commit, old.commit)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
    for (const name of names) {
      fs.rmSync(path.join(vendor, name), { recursive: true, force: true })
      fs.rmSync(path.join(vendor, name + '-conflicts.json'), { force: true })
    }
  }
})
