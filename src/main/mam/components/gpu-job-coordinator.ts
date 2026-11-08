import type { OperationHandler } from '../creative-runtime/jobs'
import { nativeRootCoordinator } from './native-root-coordinator'

const queues = new WeakMap<object, Map<string, Queue>>()
const wrapped = new WeakSet<OperationHandler>()
const operations = new Set([
  'music.generate',
  'music.native.generate',
  'music.list',
  'music.reference',
  'music.trim',
  'music.archive',
  'music.favorite',
  'music.export',
  'model3d.start',
  'spine.rife.frame',
  'music.resources.install',
  'music.resources.offline',
  'music.resources.remove',
  'model3d.resources.install',
  'model3d.resources.offline',
  'model3d.resources.remove'
])
type Ticket = { start(): void; reject(error: Error): void; signal: AbortSignal; abort(): void }
type Queue = { running: boolean; waiting: Ticket[] }

function queueFor(root: string, device: string): Queue {
  const identity = nativeRootCoordinator(root)
  let devices = queues.get(identity)
  if (!devices) {
    devices = new Map()
    queues.set(identity, devices)
  }
  let queue = devices.get(device)
  if (!queue) {
    queue = { running: false, waiting: [] }
    devices.set(device, queue)
  }
  return queue
}
export function gpuQueueStatus(root: string, device = 'default') {
  const queue = queueFor(root, device)
  return { device, running: queue.running, waiting: queue.waiting.length, maxWaiting: 16 }
}
function admit(queue: Queue, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  if (queue.running && queue.waiting.length >= 16)
    return Promise.reject(new Error('Local GPU queue is full'))
  return new Promise((resolve, reject) => {
    const ticket: Ticket = {
      signal,
      reject,
      abort: () => {
        const index = queue.waiting.indexOf(ticket)
        if (index >= 0) queue.waiting.splice(index, 1)
        reject(new Error('GPU operation cancelled while queued'))
      },
      start: () => {
        signal.removeEventListener('abort', ticket.abort)
        queue.running = true
        let released = false
        resolve(() => {
          if (released) return
          released = true
          queue.running = false
          while (queue.waiting.length) {
            const next = queue.waiting.shift()!
            next.signal.removeEventListener('abort', next.abort)
            if (next.signal.aborted) {
              next.reject(new Error('GPU operation cancelled while queued'))
              continue
            }
            next.start()
            break
          }
        })
      }
    }
    if (!queue.running) ticket.start()
    else {
      queue.waiting.push(ticket)
      signal.addEventListener('abort', ticket.abort, { once: true })
    }
  })
}

/** Only local processes whose handler promise includes teardown belong in this queue. */
export function coordinateGpuHandler(
  root: string,
  operation: string,
  handler: OperationHandler | undefined
): OperationHandler | undefined {
  if (!handler || !operations.has(operation) || wrapped.has(handler)) return handler
  const coordinated: OperationHandler = {
    validate: (request) => handler.validate(request),
    async run(request, context) {
      const queue = queueFor(root, 'default')
      await context.emit('log', {
        type: 'gpu_queue',
        phase: queue.running ? 'queued' : 'admitting',
        ...gpuQueueStatus(root)
      })
      const release = await admit(queue, context.signal)
      try {
        context.signal.throwIfAborted()
        await context.emit('log', { type: 'gpu_queue', phase: 'running', device: 'default' })
        return await handler.run(request, context)
      } finally {
        release()
      }
    }
  }
  wrapped.add(coordinated)
  return coordinated
}
