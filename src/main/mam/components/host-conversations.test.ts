import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CreativeJobManager, BinaryAssetStore } from '../creative-runtime'
import { AssetGrants } from './host-asset-grants'
import { getConversation, listConversations, runConversation } from './host-conversations'
import { readAssetText } from './host-asset-access'
import type { ComponentHostContext, ComponentHostOptions } from './component-host-context'
import type { ComponentRegistry } from './registry'

const roots: string[] = []
const managers: CreativeJobManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((jobs) => jobs.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mam-conversation-'))
  roots.push(root)
  const prompts: string[] = []
  const handlers: ComponentHostOptions['handlers'] = () => ({
    validate() {},
    async run(request) {
      prompts.push(String(request.params.prompt))
      return { text: `reply ${prompts.length}` }
    }
  })
  const jobs = await CreativeJobManager.open({ directory: join(root, 'jobs'), handlers })
  managers.push(jobs)
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const grants = new AssetGrants(join(root, 'grants'))
  const registry = {
    acquireVersion: vi.fn(async () => ({ release: vi.fn() }))
  } as unknown as ComponentRegistry
  const binding: ComponentHostContext = {
    projectId: 'project:one',
    manifest: {
      id: 'creative.constellation',
      version: '0.2.0',
      operations: [{ id: 'text.generate' }]
    } as ComponentHostContext['manifest']
  }
  const options: ComponentHostOptions = {
    jobs,
    assets,
    handlers,
    registry,
    projectId: binding.projectId,
    preloadPath: '',
    authorizationDirectory: join(root, 'grants')
  }
  return { root, prompts, binding, context: { options, grants, pin: async () => {} } }
}
const request = (command: string) => ({
  action: 'runConversation' as const,
  command,
  modelProfileId: 'text',
  invocationId: randomUUID(),
  inputAssets: []
})

test('conversation stores real Job IDs, restores history, and supplies previous turns', async () => {
  const { context, binding, root, prompts } = await setup()
  const first = await runConversation(context, binding, request('Remember cobalt'))
  expect(first.conversationId).toBe(first.jobId)
  await context.options.jobs.dispose()
  context.options.jobs = await CreativeJobManager.open({
    directory: join(root, 'jobs'),
    handlers: context.options.handlers
  })
  managers.push(context.options.jobs)
  const second = await runConversation(context, binding, {
    ...request('What color?'),
    conversationId: first.conversationId
  })
  expect(prompts[1]).toContain('user: Remember cobalt')
  expect(prompts[1]).toContain('assistant: reply 1')
  expect(second.jobId).not.toBe(first.jobId)
  expect(getConversation(context, binding, first.conversationId).turns).toHaveLength(4)
  expect(listConversations(context, binding)).toHaveLength(1)
  expect(() =>
    getConversation(context, { ...binding, projectId: 'project:other' }, first.conversationId)
  ).toThrow('outside')
})

test('conversation repeated invocation does not repeat generation; mismatched retry is rejected', async () => {
  const { context, binding, prompts } = await setup()
  const input = request('once')
  const first = await runConversation(context, binding, input)
  expect(await runConversation(context, binding, input)).toEqual(first)
  expect(prompts).toHaveLength(1)
  await expect(
    runConversation(context, binding, { ...input, command: 'different' })
  ).rejects.toThrow('different input')
})

test('text resources supply actual UTF-8 content only with a grant and size limit', async () => {
  const { context, binding } = await setup()
  const ref = await context.options.assets.import(
    (async function* () {
      yield Buffer.from('独特的句子 cobalt')
    })(),
    { mime: 'text/plain', filename: 'notes.txt' }
  )
  await expect(readAssetText(context, binding, ref, 1048576)).rejects.toThrow('outside')
  await context.grants.grant(binding.projectId, binding.manifest.id, ref)
  expect(await readAssetText(context, binding, ref, 1048576)).toEqual({ text: '独特的句子 cobalt' })
  await expect(readAssetText(context, binding, ref, 3)).rejects.toThrow('limit')
  const binary = await context.options.assets.import(
    (async function* () {
      yield Buffer.from([0xff, 0xfe])
    })(),
    { mime: 'text/plain', filename: 'broken.txt' }
  )
  await context.grants.grant(binding.projectId, binding.manifest.id, binary)
  await expect(readAssetText(context, binding, binary, 1048576)).rejects.toThrow('UTF-8')
})
