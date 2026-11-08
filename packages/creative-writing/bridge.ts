const request = (action: string, params = {}) =>
  window.componentHost?.request({ action, ...params })
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('mam.creative.writing', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' })
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
export async function flushWrites() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await store('readwrite', (s) => s.count())
}
async function store(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest) {
  const db = await database
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction('projects', mode),
      r = fn(tx.objectStore('projects'))
    tx.oncomplete = () => resolve(r.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
export const listWritingProjects = () => store('readonly', (s) => s.getAll())
export const deleteWritingProject = (id: string) => store('readwrite', (s) => s.delete(id))
export async function saveWritingProject(record: any) {
  if (new TextEncoder().encode(JSON.stringify(record)).length > 16 * 1024 * 1024)
    throw new Error('写作项目超过 16 MiB')
  await store('readwrite', (s) => s.put(structuredClone(record)))
  return record
}
export async function exportWritingFile(filename: string, content: string) {
  if (new TextEncoder().encode(content).length > 16 * 1024 * 1024)
    throw new Error('导出超过 16 MiB')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export async function getModelCatalog() {
  const models = (await request('listModels')) || []
  return {
    errors: [],
    models: models
      .filter((m: any) => m.kind === 'text')
      .map((m: any) => ({
        ...m,
        id: m.modelId || m.id,
        profileId: m.id,
        name: m.label,
        provider: 'MAM',
        protocol: 'openai'
      }))
  }
}
const runs = new Map<string, string>()
const cancelled = new Set<string>()
export async function cancelAgentTurn(id: string) {
  cancelled.add(id)
  const jobId = runs.get(id)
  if (jobId) await request('cancel', { jobId })
}
export async function agentTurnStream(
  profile: any,
  messages: any[],
  _mode: any,
  _workspace: any,
  operationId: string,
  onDelta: (text: string) => void,
  ...optional: any[]
) {
  if (!window.componentHost) throw new Error('Configure a text model in MAM settings.')
  const jobId = await request('submit', {
    operation: 'text.generate',
    idempotencyKey: operationId,
    params: {
      modelProfileId: profile.id,
      ...(optional[7] ? { reasoningEffort: optional[7] } : {}),
      prompt: messages.map((message) => `${message.role}: ${message.content}`).join('\n\n')
    },
    inputAssets: []
  })
  runs.set(operationId, jobId)
  if (cancelled.has(operationId)) await request('cancel', { jobId })
  let sequence = 0,
    content = ''
  try {
    for (;;) {
      const events = await request('events', { jobId, afterSequence: sequence })
      for (const event of events) {
        sequence = Math.max(sequence, event.sequence)
        if (event.type === 'log' && event.data?.type === 'text_delta') {
          const delta = typeof event.data === 'string' ? event.data : event.data?.text || ''
          content += delta
          onDelta(delta)
        }
        if (event.type === 'succeeded') {
          const final = event.data?.text || content
          if (!content && final) onDelta(final)
          return { content: final }
        }
        if (['failed', 'cancelled', 'reconciliation-required'].includes(event.type))
          throw new Error(event.data?.message || 'Text generation stopped')
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  } finally {
    runs.delete(operationId)
    cancelled.delete(operationId)
  }
}
