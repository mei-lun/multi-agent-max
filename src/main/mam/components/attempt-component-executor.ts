import { assertComponentBudget } from './attempt-component-budget'
import { attemptComponentUsage } from './attempt-usage-budget'
import { attemptRuntimeContext } from './attempt-runtime-context'
import { publishComponentOutputs } from './attempt-component-outputs'
import { CreativeDraftStore } from './creative-drafts'
import { creativeProjectScope } from './creative-project-scope'
import { frozenCatalog } from './attempt-component-catalog'
import { acquireAttemptComponent } from './attempt-component-identity'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { ComponentExecutionPort } from '../application/component-execution-port'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { CreativeJobManager } from '../creative-runtime'
import { type AssetRef } from '../../../shared/mam/creative-runtime'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { assertComponentOperation } from '../application/component-operation-policy'

export function createComponentExecutionPort(options: {
  root: string
  services(): Promise<DesktopCreativeServices>
  requestApproval?(input: {
    request: unknown
    requestHash: string
    categories: string[]
  }): Promise<boolean>
  audit?(receipt: Record<string, unknown>): void | Promise<void>
}): ComponentExecutionPort {
  return {
    execute: async (input) => {
      const { component, snapshot, authority } = input
      assertComponentOperation(snapshot, component.id, component.operation)
      assertComponentBudget(snapshot, component.operation, !!component.draft)
      if (
        authority.workflowRunId !== snapshot.workflowRunId ||
        authority.taskId !== snapshot.taskId ||
        authority.attemptId !== snapshot.attemptId ||
        authority.effectiveConfigHash !== snapshot.contentHash
      )
        throw new Error('Component authority does not match frozen config')
      if (!snapshot.tools.includes(`component:${component.id}`))
        throw new Error('Component authorization missing')
      if (/\.resources\.|\.status$|\.hardware$/.test(component.operation))
        throw new Error('Component maintenance is a manual workbench operation')
      input.signal.throwIfAborted()
      const services = await options.services()
      const lease = await acquireAttemptComponent(
        services.registry,
        join(
          options.root,
          'component-identities',
          createHash('sha256').update(authority.attemptId).digest('hex')
        ),
        component.id,
        component.version
      )
      let jobs: CreativeJobManager | undefined
      const executions = new Set<Promise<unknown>>()
      try {
        const categories = (snapshot.permissions?.requireApprovalFor ?? []).filter((kind) =>
          ['command', 'network', 'file'].includes(kind)
        )
        if (categories.length) {
          const request = structuredClone({
            component,
            identity: lease.identity,
            inputArtifacts: input.inputArtifacts,
            authority
          })
          const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
          if (!options.requestApproval) throw new Error('component_approval_required')
          const allowed = await options.requestApproval({ request, requestHash, categories })
          await options.audit?.({
            type: 'component_approval',
            requestHash,
            categories,
            allowed,
            ...authority
          })
          input.signal.throwIfAborted()
          if (!allowed) throw new Error('component_approval_denied')
        }
        if (
          lease.manifest.hostApiVersion !== component.hostApiVersion ||
          !lease.manifest.operations.some((operation) => operation.id === component.operation)
        )
          throw new Error('Pinned component operation unavailable')
        const assets: AssetRef[] = []
        const contextInputs: string[] = []
        const formal = new LocalArtifactStore(join(options.root, 'artifacts'))
        for (const reference of input.inputArtifacts) {
          const record = await formal.readForNode(authority.workflowRunId, input.nodeId, reference)
          if (record.version.format !== 'asset-bundle') {
            contextInputs.push(
              typeof record.content === 'string' ? record.content : JSON.stringify(record.content)
            )
            continue
          }
          const bundle = AssetBundleSchema.parse(record.content)
          for (const file of bundle.files)
            assets.push(
              await services.assets.import(
                createReadStream(join(options.root, 'artifacts', 'binary', file.sha256)),
                { mime: file.mime, filename: file.logicalPath.split('/').at(-1)! }
              )
            )
        }
        if (component.draft && !input.projectDirectory)
          throw new Error('Draft requires a connected project')
        const draftHandler = component.draft
          ? await new CreativeDraftStore(
              join(options.root, 'creative-drafts'),
              services.assets
            ).handler(creativeProjectScope(input.projectDirectory!), component)
          : undefined
        const handlers = draftHandler
          ? () => draftHandler
          : services.runtimeHandlers(
              attemptRuntimeContext(
                services,
                {
                  ...frozenCatalog(input),
                  scope: createHash('sha256').update(authority.attemptId).digest('hex'),
                  lookupJob: (id) => jobs?.get(id)
                },
                { root: options.root, workspace: input.workspace, snapshot, authority }
              )
            )
        const directory = join(
          options.root,
          'component-attempts',
          createHash('sha256').update(authority.attemptId).digest('hex')
        )
        jobs = await CreativeJobManager.open({
          directory,
          handlers: (request) => {
            const handler = handlers(request)
            if (!handler) return undefined
            return {
              validate: (request) => handler.validate(request),
              run: (request, context) => {
                const running = handler.run(request, context)
                executions.add(running)
                void running.finally(() => executions.delete(running)).catch(() => {})
                return running
              }
            }
          },
          validateInputs: async (request) => {
            for (const asset of request.inputAssets) await services.assets.read(asset)
          }
        })
        const params = structuredClone(component.params)
        if (component.draft) params.__mamDraft = component.draft
        if (contextInputs.length && typeof params.prompt === 'string')
          params.prompt += `\n\nInput artifacts:\n${contextInputs.join('\n\n')}`
        if (/^(image|video|speech|text|vision)\./.test(component.operation))
          params.modelProfileId = snapshot.modelProfile.id
        input.signal.throwIfAborted()
        if (!component.draft)
          await attemptComponentUsage(
            options.root,
            snapshot,
            jobs.list().some((job) => job.request.idempotencyKey === authority.attemptId)
              ? undefined
              : component.operation
          )
        input.signal.throwIfAborted()
        const id = await jobs.submit({
          componentId: component.id,
          componentVersion: component.version,
          operation: component.operation,
          projectId: authority.workflowRunId,
          attempt: { id: authority.attemptId, serverId: authority.executorInvocationId },
          idempotencyKey: authority.attemptId,
          inputAssets: assets,
          params
        })
        const result = await settled(jobs, id, input.signal)
        const usage = await attemptComponentUsage(options.root, snapshot)
        const claims = await publishComponentOutputs(input, result, services, options.root)
        return {
          invocation: { component, jobId: id },
          events: [],
          usage,
          stderr: '',
          result: buildAttemptResult(
            {
              schemaVersion: '1.0.0',
              status: 'submitted',
              summary: `Completed ${component.operation}`,
              artifacts: claims,
              verifications: [],
              risks: ['Provider cost is unknown unless reported by the component.'],
              followUps: [],
              usage
            },
            authority
          )
        }
      } finally {
        await jobs?.dispose()
        await Promise.allSettled(executions)
        await services.releaseRuntimeScope?.(
          createHash('sha256').update(authority.attemptId).digest('hex')
        )
        lease.release()
      }
    }
  }
}

async function settled(jobs: CreativeJobManager, id: string, signal: AbortSignal) {
  const abort = () => {
    void jobs.cancel(id).catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      if (signal.aborted) {
        await jobs.cancel(id)
        throw new Error('Component task cancelled or timed out')
      }
      const job = jobs.get(id)
      if (job.state === 'succeeded') return job
      if (['failed', 'cancelled', 'reconciliation-required'].includes(job.state))
        throw new Error(`Component task ${job.state}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
