import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileCatalog } from '../profiles/profile-catalog'
import { MamDesignAssistantService } from './mam-design-assistant-service'
import { MamDesignDraftStore } from './mam-design-draft-store'
import { MamDesignModelGateway } from './mam-design-model-gateway'
import { MamUiQueryService } from './mam-ui-query-service'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MAM Design Assistant recovery', () => {
  it('repairs a missing proposal and accepts a fenced minimal replacement', async () => {
    let requests = 0
    const service = createService(() => {
      requests += 1
      if (requests === 1) return { message: 'I need more details.' }
      return `\`\`\`json\n${JSON.stringify(minimalProposal())}\n\`\`\``
    })

    const draft = await service.sendMessage({
      requestId: 'design-request.repair',
      modelProfileId: 'model.designer',
      message: 'Create a writing workflow.'
    })

    expect(requests).toBe(2)
    expect(draft.recovery).toBeUndefined()
    expect(draft.proposal?.issues).toEqual([])
    expect(draft.proposal?.roles[0]).toMatchObject({
      execution: {
        executorProfileId: 'executor.pi',
        modelProfileId: 'model.designer'
      },
      permissions: { readPaths: ['.'], writePaths: ['.'] }
    })
  })

  it('persists compiler errors and clears recovery after an explicit retry', async () => {
    let requests = 0
    const service = createService(() => {
      requests += 1
      return requests <= 3 ? invalidForwardBoundedEdgeProposal() : minimalProposal()
    })

    await expect(
      service.sendMessage({
        requestId: 'design-request.invalid-graph',
        modelProfileId: 'model.designer',
        message: 'Create a workflow with revision handling.'
      })
    ).rejects.toMatchObject({ code: 'design_proposal_invalid' })

    const failed = service.getDraft()
    expect(requests).toBe(3)
    expect(failed.recovery).toMatchObject({
      code: 'design_proposal_invalid',
      attempts: 3
    })
    expect(failed.recovery?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'orphan_node' })])
    )
    expect(failed.proposal?.source).toBeDefined()

    const recovered = await service.retry({ requestId: 'design-retry.invalid-graph' })

    expect(requests).toBe(4)
    expect(recovered.recovery).toBeUndefined()
    expect(recovered.proposal?.issues).toEqual([])
  })

  it('does not turn an intentional cancellation into a recovery failure', async () => {
    const service = createService(
      () => minimalProposal(),
      async (_url, init): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          })
        })
    )
    const pending = service.sendMessage({
      requestId: 'design-request.cancelled',
      modelProfileId: 'model.designer',
      message: 'Create a writing workflow.'
    })

    service.cancel({ requestId: 'design-request.cancelled' })

    await expect(pending).rejects.toMatchObject({ code: 'design_request_cancelled' })
    expect(service.getDraft().recovery).toBeUndefined()
  })
})

function createService(
  response: () => unknown,
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
): MamDesignAssistantService {
  const root = mkdtempSync(join(tmpdir(), 'mam-design-recovery-'))
  temporaryDirectories.push(root)
  const profiles = new ProfileCatalog(join(root, 'catalog'))
  seedProfiles(profiles)
  const gateway = new MamDesignModelGateway(
    fetcher ??
      (async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: responseText(response()) } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ))
  )
  return new MamDesignAssistantService(
    new MamUiQueryService(profiles, undefined, now),
    profiles,
    new MamDesignDraftStore(join(root, 'design-draft.json'), now),
    { resolve: () => undefined },
    gateway,
    now
  )
}

function responseText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function minimalProposal() {
  return {
    message: 'A complete proposal is ready.',
    roles: [{ key: 'writer', displayName: 'Writer', instructions: 'Write a clear deliverable.' }],
    workflow: {
      key: 'article',
      name: 'Write article',
      nodes: [
        {
          key: 'write',
          type: 'role_task',
          allowedRoleKeys: ['writer'],
          instruction: 'Write the article.',
          workspaceMode: 'none',
          outputs: [{ key: 'article' }]
        },
        { key: 'finish', type: 'finish', inputArtifactKeys: ['article'] }
      ],
      edges: [{ from: 'write', to: 'finish' }]
    }
  }
}

function invalidForwardBoundedEdgeProposal() {
  const base = minimalProposal()
  return {
    ...base,
    workflow: {
      ...base.workflow,
      nodes: [
        base.workflow.nodes[0],
        {
          key: 'revise',
          type: 'role_task',
          allowedRoleKeys: ['writer'],
          instruction: 'Revise the article.',
          workspaceMode: 'none',
          outputs: [{ key: 'revision' }]
        },
        base.workflow.nodes[1]
      ],
      edges: [
        { from: 'write', to: 'revise', maxTraversals: 1 },
        { from: 'revise', to: 'finish' }
      ]
    }
  }
}

function seedProfiles(profiles: ProfileCatalog): void {
  profiles.executors.save({
    id: 'executor.pi',
    version: 1,
    kind: 'pi-rpc',
    executableRef: 'pi',
    adapterOptions: {}
  })
  profiles.providers.save({
    id: 'provider.designer',
    version: 1,
    protocol: 'openai-completions',
    baseUrl: 'https://api.example.test/v1'
  })
  profiles.models.save({
    id: 'model.designer',
    version: 1,
    displayName: 'Designer',
    providerProfileId: 'provider.designer',
    remoteModelId: 'designer-model',
    capabilities: {
      modalities: ['text'],
      supportsTools: false,
      supportsStructuredOutput: true,
      maxContextTokens: 32_000
    }
  })
}

function now(): string {
  return '2026-07-30T00:00:00Z'
}
