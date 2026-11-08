import { expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ComponentRegistry } from './registry'
const fake = vi.hoisted(() => ({
  partitions: [] as string[],
  handlers: [] as ((request: Request) => Promise<Response>)[],
  closed: undefined as undefined | (() => void),
  unhandle: vi.fn()
}))
vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => {
      fake.partitions.push(partition)
      return {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {} },
        protocol: {
          handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
            fake.handlers.push(handler)
          },
          unhandle: fake.unhandle
        }
      }
    }
  },
  BrowserWindow: class {
    webContents = { setWindowOpenHandler() {}, on() {} }
    once(_event: string, handler: () => void) {
      fake.closed = handler
    }
    async loadURL() {}
    show() {}
    destroy() {
      fake.closed?.()
    }
  }
}))
import { componentPartition, openComponentWindow } from './component-window'

test('persistent partition survives reopen and leases serve current package version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'window-package-'))
  const release = vi.fn()
  let version = 'first'
  const registry = {
    acquire: async () => ({
      packageDirectory: directory,
      manifest: {
        uiEntrypoint: 'index.html',
        files: { 'index.html': createHash('sha256').update(version).digest('hex') }
      },
      release
    })
  } as unknown as ComponentRegistry
  const partitionKey = componentPartition('project', 'creative.writing')
  const host = { partitionKey, preloadPath: '', bind() {} }
  try {
    await writeFile(join(directory, 'index.html'), version)
    await openComponentWindow(registry, 'creative.writing', host)
    expect(
      await (await fake.handlers[0]!(new Request('mam-component://package/index.html'))).text()
    ).toBe('first')
    fake.closed?.()
    version = 'second'
    await writeFile(join(directory, 'index.html'), version)
    await openComponentWindow(registry, 'creative.writing', host)
    expect(
      await (await fake.handlers[1]!(new Request('mam-component://package/index.html'))).text()
    ).toBe('second')
    fake.closed?.()
    expect(fake.partitions).toEqual([partitionKey, partitionKey])
    expect(partitionKey.startsWith('persist:')).toBe(true)
    expect(componentPartition('other', 'creative.writing')).not.toBe(partitionKey)
    expect(componentPartition('project', 'creative.image')).not.toBe(partitionKey)
    expect(release).toHaveBeenCalledTimes(2)
    expect(fake.unhandle).toHaveBeenCalledTimes(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
