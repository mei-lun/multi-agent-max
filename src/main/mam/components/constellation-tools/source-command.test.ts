import { test, expect } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvedCommand } from './command'
test('actual original Constellation command parser reads success and nonzero envelopes', async () => {
  const source = await readFile('vendor/levelup/baseline-6542241/src/lib/constellation.ts', 'utf8'),
    body = source.match(
      /export function parseConstellationCommandOutput\(output: string\) \{([\s\S]*?)\n\}/
    )![1]!
  const parse = new Function('output', body),
    root = await mkdtemp(join(tmpdir(), 'command-source-'))
  try {
    for (const code of [0, 3]) {
      const result = await approvedCommand(
        `"${process.execPath}" -e "process.stdout.write('value');process.stderr.write('diagnostic');process.exit(${code})"`,
        root
      )
      expect(result.isError).toBe(false)
      expect(parse(result.output)).toEqual({
        exitCode: code,
        stdout: 'value',
        stderr: 'diagnostic'
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
