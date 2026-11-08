import type { ComponentHostRequest } from '../../../shared/mam/component-host-api'
import type { CreativeJob, CreativeRequest } from '../../../shared/mam/creative-runtime'
import type { ComponentDispatchContext, ComponentHostContext } from './component-host-context'
import { assertComponentAsset } from './host-asset-access'

type RunRequest = Extract<ComponentHostRequest, { action: 'runConversation' }>
type ConversationContext = Pick<ComponentDispatchContext, 'options' | 'grants' | 'pin'>
const running = new Set<string>()
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'reconciliation-required'])

function text(job: CreativeJob): string {
  const value = job.events.findLast((event) => event.type === 'succeeded')?.data
  return value && typeof value === 'object' && 'text' in value ? String(value.text) : ''
}
function conversationJobs(context: ConversationContext, binding: ComponentHostContext) {
  if (binding.manifest.id !== 'creative.constellation')
    throw new Error('Conversation operation unavailable')
  return context.options.jobs
    .list()
    .filter(
      (job) =>
        job.request.conversation &&
        job.request.projectId === binding.projectId &&
        job.request.componentId === binding.manifest.id
    )
}
export function getConversation(
  context: ConversationContext,
  binding: ComponentHostContext,
  id: string
) {
  const jobs = conversationJobs(context, binding)
  const root = jobs.find((job) => job.id === id && !job.request.conversation?.rootJobId)
  if (!root) throw new Error('Conversation outside component project')
  const ordered = [root]
  for (;;) {
    const next = jobs.find(
      (job) =>
        job.request.conversation?.rootJobId === id &&
        job.request.conversation.previousJobId === ordered.at(-1)!.id
    )
    if (!next) break
    if (ordered.some((job) => job.id === next.id)) throw new Error('Invalid conversation chain')
    ordered.push(next)
  }
  return {
    id,
    title: root.request.conversation!.command.slice(0, 60),
    updatedAt: ordered.at(-1)!.events.at(-1)!.at,
    jobs: ordered,
    turns: ordered.flatMap((job) => [
      { jobId: job.id, role: 'user' as const, text: job.request.conversation!.command },
      ...(job.state === 'succeeded'
        ? [{ jobId: job.id, role: 'assistant' as const, text: text(job) }]
        : [])
    ])
  }
}
export function listConversations(context: ConversationContext, binding: ComponentHostContext) {
  return conversationJobs(context, binding)
    .filter((job) => !job.request.conversation?.rootJobId)
    .map((job) => {
      const result = getConversation(context, binding, job.id)
      return { id: result.id, title: result.title, updatedAt: result.updatedAt }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function runConversation(
  context: ConversationContext,
  binding: ComponentHostContext,
  input: RunRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const lock = JSON.stringify([binding.projectId, input.conversationId ?? input.invocationId])
  if (running.has(lock)) throw new Error('Conversation already has an active turn')
  running.add(lock)
  let release: (() => void) | undefined
  try {
    const jobs = conversationJobs(context, binding)
    const existing = jobs.find(
      (job) => job.request.idempotencyKey === `conversation:${input.invocationId}`
    )
    if (
      existing &&
      (existing.request.conversation?.command !== input.command ||
        existing.request.conversation.rootJobId !== input.conversationId ||
        existing.request.params.modelProfileId !== input.modelProfileId ||
        JSON.stringify(existing.request.inputAssets) !== JSON.stringify(input.inputAssets))
    )
      throw new Error('Conversation invocation was reused with different input')
    let id = existing?.id
    if (!id) {
      const previous = input.conversationId
        ? getConversation(context, binding, input.conversationId)
        : undefined
      if (previous?.jobs.some((job) => !terminal.has(job.state)))
        throw new Error('Previous turn is still running')
      if (previous?.jobs.at(-1)?.state === 'reconciliation-required')
        throw new Error('Previous turn requires reconciliation')
      for (const ref of input.inputAssets) await assertComponentAsset(context, binding, ref)
      const prompt = [
        input.context,
        ...(previous?.turns.map((turn) => `${turn.role}: ${turn.text}`) ?? []),
        `user: ${input.command}`
      ]
        .filter(Boolean)
        .join('\n\n')
      if (prompt.length > 1000000)
        throw new Error('Conversation context is too large; start a new conversation')
      const request: CreativeRequest = {
        componentId: binding.manifest.id,
        componentVersion: binding.manifest.version,
        projectId: binding.projectId,
        operation: input.inputAssets.length ? 'vision.generate' : 'text.generate',
        idempotencyKey: `conversation:${input.invocationId}`,
        inputAssets: input.inputAssets,
        params: { modelProfileId: input.modelProfileId, prompt },
        conversation: {
          command: input.command,
          ...(previous ? { rootJobId: previous.id, previousJobId: previous.jobs.at(-1)!.id } : {})
        }
      }
      if (!binding.manifest.operations.some((item) => item.id === request.operation))
        throw new Error('Conversation model operation unavailable')
      const lease = await context.options.registry.acquireVersion(
        binding.manifest.id,
        binding.manifest.version
      )
      release = lease.release
      id = await context.options.jobs.submit(request)
      await context.pin(id)
    }
    const manager = context.options.jobs
    const cancel = () => {
      void manager.cancel(id!).catch(() => {})
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    try {
      await new Promise<void>((resolve) => {
        if (terminal.has(manager.get(id!).state)) return resolve()
        let unsubscribe = () => {}
        unsubscribe = manager.subscribe(id!, 0, () => {
          if (terminal.has(manager.get(id!).state)) {
            unsubscribe()
            resolve()
          }
        })
        if (terminal.has(manager.get(id!).state)) {
          unsubscribe()
          resolve()
        }
      })
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    signal?.throwIfAborted()
    const job = manager.get(id)
    if (job.state !== 'succeeded')
      throw new Error(`Conversation turn ${job.state}; inspect job history`)
    const root = job.request.conversation!.rootJobId ?? id
    return {
      conversationId: root,
      jobId: id,
      title: getConversation(context, binding, root).title,
      text: text(job)
    }
  } finally {
    release?.()
    running.delete(lock)
  }
}
