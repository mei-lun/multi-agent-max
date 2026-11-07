import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { snapshot, verify, replay, safe, diff } from './sync.mjs'
test('committed bytes, dependency changes, candidate conflicts and tampering', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'levelup-test-'))
  const id = `test-${Date.now()}`,
    names = [id, `${id}-next`, `${id}-patch`]
  const vendor = path.resolve('vendor/levelup')
  const git = (...a) => execFileSync('git', ['-C', repo, ...a])
  try {
    git('init')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    git('config', 'core.autocrlf', 'false')
    const bytes = Buffer.from('import x from "./missing";\r\nconst a=1;\r\n')
    fs.writeFileSync(path.join(repo, 'a.ts'), bytes)
    git('add', '.')
    git('commit', '-m', 'baseline')
    fs.writeFileSync(path.join(repo, 'a.ts'), 'dirty')
    const m = snapshot(repo, 'HEAD', { rules: [{ prefix: 'a.ts' }] }, id)
    assert.deepEqual(fs.readFileSync(path.join(vendor, id, 'a.ts')), bytes)
    assert.equal(m.dependencyGaps.length, 1)
    assert.throws(() => safe('../escape'))
    assert.throws(() => safe('C:/escape'))
    assert.throws(() => snapshot(repo, 'HEAD', { rules: [{ prefix: 'a' }] }, id))
    assert.throws(() =>
      replay(
        id,
        [
          {
            path: 'a.ts',
            expectedSha256: m.files[0].sha256,
            before: Buffer.from('absent').toString('base64'),
            after: 'eA=='
          }
        ],
        names[2]
      )
    )
    assert.equal(verify(path.join(vendor, id)).commit, m.commit)
    assert.ok(!fs.existsSync(path.join(vendor, names[2])))
    replay(
      id,
      [
        {
          path: 'a.ts',
          expectedSha256: m.files[0].sha256,
          before: Buffer.from('a=1').toString('base64'),
          after: Buffer.from('a=2').toString('base64')
        }
      ],
      names[2]
    )
    fs.writeFileSync(path.join(repo, 'a.ts'), 'import y from "./new";')
    git('add', '.')
    git('commit', '-m', 'dependency')
    snapshot(repo, 'HEAD', { rules: [{ prefix: 'a' }] }, names[1])
    assert.equal(diff(id, names[1]).modifications.length, 1)
    fs.writeFileSync(path.join(vendor, id, 'a.ts'), 'tampered')
    assert.throws(() => verify(path.join(vendor, id)), /Hash mismatch/)
    git(
      'update-index',
      '--add',
      '--cacheinfo',
      `120000,${git('hash-object', '-w', 'a.ts').toString().trim()},link`
    )
    git('commit', '-m', 'symlink')
    assert.throws(
      () => snapshot(repo, 'HEAD', { rules: [{ prefix: 'link' }] }, `${id}-bad`),
      /Unsupported/
    )
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
    for (const n of names) fs.rmSync(path.join(vendor, n), { recursive: true, force: true })
  }
})
