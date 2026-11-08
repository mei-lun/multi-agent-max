const request = (action: string, params = {}) =>
  (
    window as unknown as {
      componentHost: { request: (input: Record<string, unknown>) => Promise<any> }
    }
  ).componentHost.request(JSON.parse(JSON.stringify({ action, ...params })))
type Handle = {
  jobId: string
  operation: string
  checkpoint?: any
  terminal?: boolean
  result?: any
  acknowledged?: boolean
}
const keyFor = (key: string) => `mam.creative.background.${key}`
const read = (key: string): Handle | null => {
  try {
    return JSON.parse(localStorage.getItem(keyFor(key)) || 'null')
  } catch {
    return null
  }
}
const save = (key: string, handle: Handle) =>
  localStorage.setItem(keyFor(key), JSON.stringify(handle))
const active = new Map<string, Promise<any>>()
export async function recoverBackground(key: string, onCheckpoint?: (value: any) => void) {
  const handle = read(key)
  if (!handle) return null
  if (handle.terminal) {
    if (handle.acknowledged) return null
    if (handle.checkpoint) onCheckpoint?.(handle.checkpoint)
    return handle.result || handle.checkpoint || null
  }
  let sequence = 0
  for (;;) {
    const events = await request('events', { jobId: handle.jobId, afterSequence: sequence })
    for (const event of events) {
      sequence = Math.max(sequence, event.sequence)
      if (
        event.type === 'log' &&
        ['writing_goal_checkpoint', 'constellation_graph_checkpoint'].includes(event.data?.type)
      ) {
        handle.checkpoint = event.data
        save(key, handle)
        onCheckpoint?.(event.data)
      }
      if (event.type === 'succeeded') {
        handle.terminal = true
        handle.result = event.data
        save(key, handle)
        return event.data
      }
      if (['failed', 'cancelled', 'reconciliation-required'].includes(event.type)) {
        handle.terminal = true
        save(key, handle)
        throw Error(
          event.data?.message || 'Background job stopped; checkpoint preserved for explicit resume'
        )
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}
export function runBackground(
  key: string,
  operation: string,
  params: any,
  onCheckpoint?: (value: any) => void
) {
  const existing = active.get(key)
  if (existing) return existing
  const work = runActual(key, operation, params, onCheckpoint).finally(() => active.delete(key))
  active.set(key, work)
  return work
}
async function runActual(
  key: string,
  operation: string,
  params: any,
  onCheckpoint?: (value: any) => void
) {
  const previous = read(key)
  if (previous && !previous.terminal) return recoverBackground(key, onCheckpoint)
  // A new button invocation is the explicit retry boundary; never auto-resubmit a paid step.
  const intentKey = keyFor(key) + '.intent'
  const stored = localStorage.getItem(intentKey)
  const encoded = JSON.stringify({ operation, params })
  let intent
  try {
    intent = stored ? JSON.parse(stored) : null
  } catch {}
  if (!intent || intent.encoded !== encoded) {
    intent = { encoded, idempotencyKey: crypto.randomUUID() }
    localStorage.setItem(intentKey, JSON.stringify(intent))
  }
  const jobId = await request('submit', {
    operation,
    idempotencyKey: intent.idempotencyKey,
    params,
    inputAssets: backgroundInputAssets(params)
  })
  save(key, { jobId, operation })
  localStorage.removeItem(intentKey)
  return recoverBackground(key, onCheckpoint)
}
export async function cancelBackground(key: string) {
  const handle = read(key)
  if (handle && !handle.terminal) await request('cancel', { jobId: handle.jobId })
}
export function acknowledgeBackground(key: string) {
  const handle = read(key)
  if (handle?.terminal) {
    handle.acknowledged = true
    save(key, handle)
  }
}
/** Canonical refs only; the host authorizes each against current project ownership. */
export function backgroundInputAssets(value: unknown) {
  const refs = new Map<string, any>()
  let total = 0
  const visit = (item: any, depth: number) => {
    if (depth > 40) throw Error('Background input nesting limit exceeded')
    if (!item || typeof item !== 'object') return
    if (
      typeof item.id === 'string' &&
      typeof item.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(item.sha256) &&
      Number.isSafeInteger(item.bytes) &&
      item.bytes >= 0 &&
      typeof item.mime === 'string' &&
      typeof item.filename === 'string'
    ) {
      const ref = {
        id: item.id,
        sha256: item.sha256,
        bytes: item.bytes,
        mime: item.mime,
        filename: item.filename
      }
      const previous = refs.get(ref.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(ref))
        throw Error('Conflicting background asset reference')
      if (!previous) {
        refs.set(ref.id, ref)
        total += ref.bytes
      }
      return
    }
    for (const child of Object.values(item)) visit(child, depth + 1)
  }
  visit(value, 0)
  if (refs.size > 128 || total > 128 * 1024 * 1024)
    throw Error('Background input asset budget exceeded')
  return [...refs.values()]
}
