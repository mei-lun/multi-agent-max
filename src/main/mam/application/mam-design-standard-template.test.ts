import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileCatalog } from '../profiles/profile-catalog'
import { materializeMamDesignProposal } from './mam-design-proposal-materializer'
import { createMamDesignProposal } from './mam-design-proposal-validation'
import { createMamDesignStandardTemplate } from './mam-design-standard-template'
import { buildMamDesignSystemPrompt } from './mam-design-system-prompt'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MAM Design standard template', () => {
  it('uses the selected existing Model Profile and compiles without a loop', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-design-template-'))
    temporaryDirectories.push(root)
    const profiles = new ProfileCatalog(join(root, 'catalog'))
    seedProfiles(profiles)

    const template = createMamDesignStandardTemplate({
      profiles,
      modelProfileId: 'model.designer'
    })
    const materialized = materializeMamDesignProposal(template, (_kind, id) => id)
    const proposal = createMamDesignProposal({
      ...materialized,
      profiles,
      now: () => '2026-07-30T00:00:00Z',
      source: template
    })

    expect(template.roles[0]).toMatchObject({
      executorProfileId: 'executor.pi',
      modelProfileId: 'model.designer'
    })
    expect(template.roles.map((role) => role.key)).toEqual([
      'delivery-author',
      'delivery-reviewer'
    ])
    expect(template.workflow.edges).toEqual([
      { from: 'prepare-delivery', to: 'review-delivery' },
      { from: 'review-delivery', to: 'integrate-develop' },
      { from: 'integrate-develop', to: 'approve-release' },
      { from: 'approve-release', to: 'promote-main' },
      { from: 'promote-main', to: 'finish' }
    ])
    expect(proposal.issues).toEqual([])
  })

  it('gives the model a canonical replacement and explicit loop-edge rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-design-prompt-'))
    temporaryDirectories.push(root)
    const profiles = new ProfileCatalog(join(root, 'catalog'))
    seedProfiles(profiles)
    const template = createMamDesignStandardTemplate({
      profiles,
      modelProfileId: 'model.designer'
    })

    const prompt = buildMamDesignSystemPrompt({
      profiles,
      selectedModelProfileId: 'model.designer',
      standardTemplate: template
    })

    expect(prompt).toContain('Every response must include a complete replacement proposal.')
    expect(prompt).toContain('Never use maxTraversals on a normal forward or conditional branch.')
    expect(prompt).toContain('git_merge to develop')
    expect(prompt).toContain('git_merge from the integrated revision to main')
    expect(prompt).toContain('"preferredExecutionBinding"')
    expect(prompt).toContain(JSON.stringify(template))
  })

  it('materializes generated Review reports with the internal structured contract', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-design-review-contract-'))
    temporaryDirectories.push(root)
    const profiles = new ProfileCatalog(join(root, 'catalog'))
    seedProfiles(profiles)
    const template = createMamDesignStandardTemplate({
      profiles,
      modelProfileId: 'model.designer'
    })
    const prepare = template.workflow.nodes[0]!
    const source = {
      ...template,
      workflow: {
        ...template.workflow,
        nodes: [
          prepare,
          {
            key: 'review-delivery',
            type: 'review_gate' as const,
            recommendedRoleKeys: ['delivery-author'],
            allowedRoleKeys: ['delivery-author'],
            inputArtifactKeys: ['delivery-brief'],
            reportContract: {
              key: 'review-report',
              format: 'markdown' as const,
              required: true,
              maxBytes: 100_000,
              requiredSections: ['summary']
            },
            minimumDecisions: 1,
            maxRevisionAttempts: 2
          },
          { key: 'finish', type: 'finish' as const, inputArtifactKeys: ['review-report'] }
        ],
        edges: [
          { from: 'prepare-delivery', to: 'review-delivery' },
          { from: 'review-delivery', to: 'finish' }
        ]
      }
    }

    const materialized = materializeMamDesignProposal(source, (_kind, id) => id)
    const review = materialized.workflow.nodes.find((node) => node.type === 'review_gate')
    expect(review).toMatchObject({ reportContract: { format: 'json-schema' } })
  })

  it('blocks resources the selected Executor cannot run', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-design-resource-validation-'))
    temporaryDirectories.push(root)
    const profiles = new ProfileCatalog(join(root, 'catalog'))
    seedProfiles(profiles)
    profiles.mcpServers.save({
      id: 'mcp.files',
      version: 1,
      displayName: 'Files',
      transport: 'stdio',
      connectionRef: 'local.files'
    })
    profiles.knowledgeBases.save({
      id: 'knowledge.local',
      version: 1,
      displayName: 'Local knowledge',
      kind: 'local-directory',
      sourceRef: 'local.knowledge'
    })
    const template = createMamDesignStandardTemplate({
      profiles,
      modelProfileId: 'model.designer'
    })
    const source = {
      ...template,
      roles: template.roles.map((role, index) =>
        index === 0
          ? {
              ...role,
              mcpServerIds: ['mcp.files'],
              knowledgeBaseIds: ['knowledge.local']
            }
          : role
      )
    }
    const materialized = materializeMamDesignProposal(source, (_kind, id) => id)
    const proposal = createMamDesignProposal({
      ...materialized,
      profiles,
      now: () => '2026-07-30T00:00:00Z',
      source
    })

    expect(proposal.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['mcp_transport_unsupported', 'knowledge_gateway_unsupported'])
    )
  })
})

function seedProfiles(profiles: ProfileCatalog): void {
  profiles.executors.save({
    id: 'executor.codex',
    version: 1,
    kind: 'codex-cli',
    executableRef: 'codex',
    adapterOptions: {}
  })
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
    protocol: 'openai-responses',
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
