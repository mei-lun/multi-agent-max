import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { PI_ISOLATED_LAUNCHER_SOURCE } from './pi-isolated-launcher-source'

const executeFile = promisify(execFile)
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('isolated Pi runtime selection', () => {
  it('loads the installed Pi CLI through the selected runtime', async () => {
    const fixture = await createFixture()
    const { stdout } = await executeFile('node', [fixture.launcher, '--version'], {
      env: {
        ...fixture.env,
        MAM_PI_EXECUTABLE: resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js')
      },
      timeout: 20_000,
      windowsHide: true
    })

    expect(stdout.trim()).toBe('0.81.1')
  })

  it('launches Pi with the host runtime and keeps launcher configuration out of its environment', async () => {
    const fixture = await createFixture()
    const { stdout } = await executeFile('node', [fixture.launcher, 'argument with spaces'], {
      env: fixture.env,
      timeout: 10_000,
      windowsHide: true
    })

    expect(JSON.parse(stdout)).toEqual({
      executable: process.execPath,
      nodeVersion: process.versions.node,
      args: ['argument with spaces'],
      environmentKeys: process.versions.electron ? ['ELECTRON_RUN_AS_NODE'] : []
    })
  })

  it('fails when the selected runtime is unavailable instead of running Pi with PATH node', async () => {
    const fixture = await createFixture()
    await expect(
      executeFile('node', [fixture.launcher], {
        env: { ...fixture.env, MAM_PI_NODE_EXECUTABLE: join(fixture.directory, 'missing-node') },
        timeout: 10_000,
        windowsHide: true
      })
    ).rejects.toMatchObject({ stdout: '', stderr: expect.stringContaining('ENOENT') })
  })

  it('rejects a missing runtime before spawning Pi', async () => {
    const fixture = await createFixture()
    await expect(
      executeFile('node', [fixture.launcher], {
        env: { ...fixture.env, MAM_PI_NODE_EXECUTABLE: '' },
        timeout: 10_000,
        windowsHide: true
      })
    ).rejects.toMatchObject({
      code: 64,
      stdout: '',
      stderr: expect.stringContaining('missing isolated Pi launcher configuration')
    })
  })
})

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mam-pi-runtime-'))
  directories.push(directory)
  const launcher = join(directory, 'launcher.mjs')
  const executable = join(directory, 'runtime probe.mjs')
  await Promise.all([
    writeFile(launcher, PI_ISOLATED_LAUNCHER_SOURCE),
    writeFile(
      executable,
      `console.log(JSON.stringify({
        executable: process.execPath,
        nodeVersion: process.versions.node,
        args: process.argv.slice(2),
        environmentKeys: Object.keys(process.env).filter(key => key.startsWith('MAM_') || key === 'ELECTRON_RUN_AS_NODE').sort()
      }))`
    )
  ])
  return {
    directory,
    launcher,
    env: {
      ...process.env,
      MAM_PI_EXECUTABLE: executable,
      MAM_PI_NODE_EXECUTABLE: process.execPath,
      MAM_PI_ENVIRONMENT_KEYS: JSON.stringify(
        process.versions.electron ? ['ELECTRON_RUN_AS_NODE'] : []
      ),
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    }
  }
}
