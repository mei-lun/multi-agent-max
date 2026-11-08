import { test, expect, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireServiceRootLock } from './service-root-lock'
const stalePid = 2147483647
test('concurrent stale recovery acquires once and retains the winning owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-race-')),
    lock = join(root, '.creative-owner')
  const realKill = process.kill.bind(process)
  const probe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === stalePid) throw Object.assign(new Error('exited'), { code: 'ESRCH' })
    return realKill(pid, signal)
  })
  try {
    await writeFile(lock, JSON.stringify({ pid: stalePid, token: 'old' }))
    const results = await Promise.allSettled([
      acquireServiceRootLock(root),
      acquireServiceRootLock(root)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(JSON.parse(await readFile(lock, 'utf8')).pid).toBe(process.pid)
    const winner = results.find(
      (result) => result.status === 'fulfilled'
    )! as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireServiceRootLock>>>
    await winner.value.release()
  } finally {
    probe.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
test('live owners, symlink locks, and abandoned recovery guards are never removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-boundary-')),
    lock = join(root, '.creative-owner')
  try {
    const owner = JSON.stringify({ pid: process.pid, token: 'live' })
    await writeFile(lock, owner)
    await expect(acquireServiceRootLock(root)).rejects.toThrow('already owned')
    expect(await readFile(lock, 'utf8')).toBe(owner)
    await rm(lock)
    const external = join(root, 'external')
    await mkdir(external)
    await writeFile(join(external, 'owner'), owner)
    await symlink(external, lock, 'junction')
    await expect(acquireServiceRootLock(root)).rejects.toThrow()
    expect(await readFile(join(external, 'owner'), 'utf8')).toBe(owner)
    await rm(lock)
    await writeFile(lock, JSON.stringify({ pid: stalePid, token: 'old' }))
    await writeFile(lock + '.recovery', 'abandoned')
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('exited'), { code: 'ESRCH' })
    })
    try {
      await expect(acquireServiceRootLock(root)).rejects.toThrow('recovery')
      expect(await readFile(lock + '.recovery', 'utf8')).toBe('abandoned')
    } finally {
      probe.mockRestore()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
