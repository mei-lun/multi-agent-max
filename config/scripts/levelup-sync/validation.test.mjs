import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safe, verify, snapshot } from './sync.mjs'
test('reject control characters, reserved manifest and portable path escapes', () => {
  for (const p of [
    'a\tother',
    'provenance.json',
    'PROVENANCE.JSON',
    '../x',
    'x\\y',
    'x:stream',
    'x.',
    'NUL.txt',
    'dir/COM1',
    'LPT9.log',
    'x?y',
    'x*y'
  ])
    assert.throws(() => safe(p))
})

test('reject snapshot directory aliases before reading provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-alias-'))
  try {
    const target = path.join(root, 'target'),
      alias = path.join(root, 'alias')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'provenance.json'), '{}')
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => verify(alias), /Symlink snapshot directory/)
    assert.equal(fs.readFileSync(path.join(target, 'provenance.json'), 'utf8'), '{}')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('reject incomplete provenance independently of file contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'))
  try {
    fs.writeFileSync(
      path.join(dir, 'provenance.json'),
      JSON.stringify({
        schema: 1,
        commit: 'a'.repeat(40),
        selection: { rules: [{ prefix: 'a' }] },
        files: []
      })
    )
    assert.throws(() => verify(dir), /Invalid provenance/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
test('source ancestor rejection precedes destination writes', () => {
  assert.throws(
    () =>
      snapshot(process.cwd(), 'HEAD', { rules: [{ prefix: 'package.json' }] }, 'overlap-rejected'),
    /overlaps/
  )
  assert.ok(!fs.existsSync('vendor/levelup/overlap-rejected'))
})
