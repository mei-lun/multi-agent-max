import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticsRecorder } from './diagnostics-recorder'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('DiagnosticsRecorder', () => {
  it('redacts nested secrets while retaining Executor correlation', () => {
    const recorder = new DiagnosticsRecorder()
    recorder.record({
      at: '2026-07-27T10:00:00Z',
      workflowRunId: 'run.1',
      nodeId: 'node.1',
      roleInstanceId: 'role-instance.1',
      executorInvocationId: 'executor-invocation.1',
      kind: 'executor',
      payload: {
        authorization: 'Bearer secret-token',
        nested: { apiKey: 'secret-key' },
        message: 'token=secret-token',
        output: 'received mam-canary-secret-provider and sk-testvalue123'
      }
    })
    expect(recorder.list()[0]).toMatchObject({
      executorInvocationId: 'executor-invocation.1',
      payload: {
        authorization: '[REDACTED]',
        nested: { apiKey: '[REDACTED]' },
        message: 'token=[REDACTED]',
        output: 'received [REDACTED] and [REDACTED]'
      }
    })
  })

  it('retains only the most recent local diagnostic events', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mam-diagnostics-retention-'))
    directories.push(directory)
    const path = join(directory, 'events.json')
    const events = Array.from({ length: 3_010 }, (_, index) => diagnosticEvent(index))
    await writeFile(path, JSON.stringify(events), 'utf8')

    const recorder = new DiagnosticsRecorder(path)
    expect(recorder.list()).toHaveLength(3_000)
    expect(recorder.list()[0]?.at).toBe('2026-08-06T00:00:10.000Z')
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(3_000)

    recorder.record(diagnosticEvent(3_010))
    const persisted = JSON.parse(await readFile(path, 'utf8')) as unknown[]
    expect(persisted).toHaveLength(3_000)
  })
})

function diagnosticEvent(index: number) {
  return {
    at: new Date(Date.UTC(2026, 7, 6) + index * 1_000).toISOString(),
    workflowRunId: 'run.retention',
    nodeId: 'node.retention',
    roleInstanceId: 'role-instance.retention',
    executorInvocationId: 'executor-invocation.retention',
    kind: 'executor' as const,
    payload: { index }
  }
}
