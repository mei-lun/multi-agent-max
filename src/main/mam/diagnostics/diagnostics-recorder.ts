import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const MAX_RETAINED_EVENTS = 3_000

export type DiagnosticEvent = Readonly<{
  at: string
  workflowRunId: string
  nodeId: string
  taskId?: string
  attemptId?: string
  roleInstanceId: string
  executorInvocationId: string
  kind: 'scheduler' | 'executor' | 'policy' | 'tool' | 'cost' | 'resource'
  payload: Readonly<Record<string, unknown>>
}>

export type CostObservation = Readonly<{
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  status: 'reported' | 'unknown' | 'partial'
}>

export class DiagnosticsRecorder {
  private readonly events: DiagnosticEvent[]

  constructor(private readonly storagePath?: string) {
    const loaded = storagePath ? loadEvents(storagePath) : []
    this.events = loaded.slice(-MAX_RETAINED_EVENTS)
    if (loaded.length > this.events.length) this.persist()
  }

  record(event: DiagnosticEvent): void {
    this.events.push(structuredClone(redactEvent(event)))
    if (this.events.length > MAX_RETAINED_EVENTS) {
      this.events.splice(0, this.events.length - MAX_RETAINED_EVENTS)
    }
    this.persist()
  }

  recordCost(input: Omit<DiagnosticEvent, 'kind' | 'payload'> & { usage: CostObservation }): void {
    this.record({ ...input, kind: 'cost', payload: { usage: input.usage } })
  }

  list(): readonly DiagnosticEvent[] {
    return structuredClone(this.events)
  }

  listInterruptionEvents(): readonly DiagnosticEvent[] {
    return structuredClone(
      this.events.filter(
        (event) => event.kind === 'executor' && event.payload.status === 'execution_interrupted'
      )
    )
  }

  exportBundle(pathInput: string, events: readonly DiagnosticEvent[] = this.events): string {
    const path = resolve(pathInput)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ schemaVersion: '1.0.0', events }, null, 2)}\n`, {
      mode: 0o600
    })
    return path
  }

  private persist(): void {
    if (!this.storagePath) {
      return
    }
    const path = resolve(this.storagePath)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(this.events, null, 2)}\n`, { mode: 0o600 })
  }
}

function redactEvent(event: DiagnosticEvent): DiagnosticEvent {
  return {
    ...event,
    payload: redactSecrets(event.payload) as Readonly<Record<string, unknown>>
  }
}

function redactSecrets(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (key && isSensitiveKey(key)) {
      return '[REDACTED]'
    }
    return value
      .replace(/(api[_-]?key|token|authorization|secret)(\s*[:=]\s*)[^\s,]+/gi, '$1$2[REDACTED]')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk|xai|api)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/mam-canary-secret-[A-Za-z0-9_-]+/g, '[REDACTED]')
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, key))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [entryKey, redactSecrets(entry, entryKey)])
    )
  }
  return value
}

function isSensitiveKey(key: string): boolean {
  return /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|secret|password|credential(?:s|path)?|secretEnvironmentKeys)$/i.test(
    key
  )
}

function loadEvents(pathInput: string): DiagnosticEvent[] {
  const path = resolve(pathInput)
  if (!existsSync(path)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed as DiagnosticEvent[]
  } catch {
    return []
  }
}
