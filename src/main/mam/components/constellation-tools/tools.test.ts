import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore } from '../../creative-runtime/assets'
import { createConstellationTools } from './index'
import { approvedCommand } from './command'
test('workspace tools immutable single-use foreign-window and escape boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'constellation-')),
    workspace = join(root, 'workspace'),
    managed = join(root, 'managed')
  try {
    await mkdir(workspace)
    await mkdir(managed)
    await writeFile(join(workspace, 'file.txt'), 'hello needle')
    await writeFile(join(root, 'outside'), 'secret')
    await symlink(root, join(workspace, 'escape'), 'junction')
    const tools = createConstellationTools({
      root: managed,
      assets: await BinaryAssetStore.open(join(managed, 'assets')),
      chooseWorkspace: async () => workspace,
      requestApproval: async () => false
    })
    const context = { componentId: 'creative.constellation', projectId: 'p', windowId: 1 }
    const input = { name: 'read_file', args: { path: 'file.txt' } },
      grant = await tools.check(input, context)
    input.args.path = '../outside'
    expect((await tools.execute(grant.token!, { ...context, windowId: 2 })).isError).toBe(true)
    expect(await tools.execute(grant.token!, context)).toEqual({
      output: 'hello needle',
      isError: false
    })
    expect((await tools.execute(grant.token!, context)).isError).toBe(true)
    await expect(
      tools.check({ name: 'read_file', args: { path: 'escape/outside' } }, context)
    ).resolves.toEqual({ decision: 'deny' })
    const search = await tools.check({ name: 'search_files', args: { query: 'needle' } }, context)
    expect((await tools.execute(search.token!, context)).output).toContain(
      'file.txt:1:hello needle'
    )
    const list = await tools.check({ name: 'list_files', args: {} }, context)
    expect((await tools.execute(list.token!, context)).output).toContain('file.txt')
    expect(
      await tools.check({ name: 'run_command', args: { command: 'echo unauthorized' } }, context)
    ).toEqual({ decision: 'deny' })
    expect(
      await tools.check(
        { name: 'read_file', args: { path: 'file.txt' } },
        { ...context, componentId: 'other' }
      )
    ).toEqual({ decision: 'deny' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('approved command executes exact snapshot and timeout/output are bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'constellation-command-'))
  try {
    const managed = join(root, 'managed'),
      workspace = join(root, 'workspace')
    await mkdir(managed)
    await mkdir(workspace)
    const command = `"${process.execPath}" -e "process.stdout.write('approved')"`
    const tools = createConstellationTools({
      root: managed,
      assets: await BinaryAssetStore.open(join(managed, 'assets')),
      chooseWorkspace: async () => workspace,
      requestApproval: async (details) =>
        details.call.name === 'run_command' && details.call.args.command === command
    })
    const context = { componentId: 'creative.constellation', projectId: 'p', windowId: 1 },
      call = { name: 'run_command', args: { command } }
    const grant = await tools.check(call, context)
    call.args.command = 'echo replaced'
    expect(await tools.execute(grant.token!, context)).toEqual({
      output: 'exit code: 0\nstdout:\napproved\nstderr:\n',
      isError: false
    })
    expect(
      (await approvedCommand(`"${process.execPath}" -e "setInterval(()=>{},1000)"`, workspace, 50))
        .isError
    ).toBe(true)
    const excessive = await approvedCommand(
      `"${process.execPath}" -e "process.stdout.write('a'.repeat(130000))"`,
      workspace
    )
    expect(excessive.isError).toBe(true)
    expect(excessive.output.length).toBeLessThan(120100)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
