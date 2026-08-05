import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MamDesignDraft } from '../../../shared/mam/design-assistant'
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

describe('MAM Design Assistant service', () => {
  it('uses an existing Model Profile and creates definitions without starting a Run', async () => {
    const { service } = createServiceFixture()

    const draft = await completeBrainstorm(service, 'test')

    expect(draft.messages).toHaveLength(10)
    expect(draft.proposal?.issues).toEqual([])
    expect(draft.proposal?.roles).toMatchObject([
      {
        id: 'role.writer',
        execution: {
          executorProfileId: 'executor.pi',
          modelProfileId: 'model.designer'
        }
      }
    ])

    const snapshot = service.applyProposal({ proposalHash: draft.proposal!.hash })

    expect(snapshot.roles).toMatchObject([{ id: 'role.writer', displayName: 'Writer' }])
    expect(snapshot.workflows).toMatchObject([{ id: 'workflow.article', name: 'Write article' }])
    expect(snapshot.runs).toEqual([])
    expect(service.getDraft().status).toBe('applied')
  })

  it('keeps a provisional proposal editable while clarification and findings are open', async () => {
    const provisional = {
      ...modelResponse(),
      message: 'I need one business decision before this Workflow is ready.',
      brainstorm: {
        question: {
          id: 'publication-approval',
          prompt: 'Should publication require a final human decision?',
          whyItMatters: 'This determines the final approval gate.',
          options: []
        },
        approaches: [],
        sections: []
      },
      review: {
        readiness: 'ready',
        questions: [],
        findings: [
          {
            severity: 'warning',
            status: 'unresolved',
            title: 'Publication authority is unclear',
            detail: 'The current draft does not identify who can approve publication.',
            recommendation: 'Confirm whether a human approval gate is required.'
          }
        ],
        assumptions: ['Drafting may continue before publication authority is confirmed.']
      }
    }
    const ready = {
      ...modelResponse(),
      message: 'The human publication decision is now explicit.',
      review: {
        readiness: 'ready',
        questions: [],
        findings: [
          {
            severity: 'warning',
            status: 'addressed',
            title: 'Publication authority is explicit',
            detail: 'The user confirmed the intended publication policy.',
            recommendation: 'Keep the confirmed policy in the Workflow instructions.'
          }
        ],
        assumptions: []
      }
    }
    const { service } = createServiceFixture([provisional, ready])

    const first = await service.sendMessage({
      requestId: 'design-request.clarify',
      modelProfileId: 'model.designer',
      message: 'Create a publication workflow.'
    })

    expect(first.proposal?.issues).toEqual([])
    expect(first.review).toMatchObject({
      readiness: 'needs_revision',
      questions: []
    })
    expect(first.brainstorm?.phase).toBe('clarifying')
    expect(() => service.applyProposal({ proposalHash: first.proposal!.hash })).toThrow(
      'Continue the Design conversation'
    )

    const second = await service.sendMessage({
      requestId: 'design-request.answer',
      modelProfileId: 'model.designer',
      message: 'Yes, require a final human decision.'
    })

    expect(second.messages).toHaveLength(4)
    expect(second.review).toMatchObject({
      readiness: 'ready',
      questions: [],
      findings: [{ status: 'addressed' }]
    })
    expect(second.brainstorm?.phase).toBe('comparing_approaches')
    expect(() => service.applyProposal({ proposalHash: second.proposal!.hash })).toThrow(
      'Complete the approach selection'
    )
  })

  it('requires approach selection and unchanged section approvals before confirmation', async () => {
    const approaches = [
      {
        id: 'balanced',
        title: 'Balanced review',
        summary: 'Separate writing and review ownership.',
        benefits: ['Independent review'],
        tradeoffs: ['One additional stage'],
        recommended: true
      },
      {
        id: 'fast',
        title: 'Fast path',
        summary: 'Use final human approval without independent review.',
        benefits: ['Lower latency'],
        tradeoffs: ['Less independent validation'],
        recommended: false
      }
    ]
    const sections = [
      {
        id: 'ownership',
        title: 'Roles and ownership',
        summary: 'Writer and reviewer are separate.'
      },
      { id: 'flow', title: 'Workflow and handoffs', summary: 'Review happens before completion.' },
      {
        id: 'quality',
        title: 'Quality and recovery',
        summary: 'Rejected work returns for revision.'
      }
    ]
    const comparison = { ...modelResponse(), brainstorm: { approaches, sections: [] } }
    const design = { ...modelResponse(), brainstorm: { approaches, sections } }
    const { service } = createServiceFixture([comparison, design, design, design, design])

    const compared = await service.sendMessage({
      requestId: 'design-request.compare',
      modelProfileId: 'model.designer',
      message: 'Create a writing workflow.'
    })

    expect(compared.brainstorm?.phase).toBe('comparing_approaches')
    expect(() => service.applyProposal({ proposalHash: compared.proposal!.hash })).toThrow(
      'Complete the approach selection'
    )

    const selected = await service.sendMessage({
      requestId: 'design-request.select',
      modelProfileId: 'model.designer',
      message: 'I choose Balanced review.',
      decision: { type: 'select_approach', approachId: 'balanced' }
    })
    expect(selected.brainstorm).toMatchObject({
      phase: 'reviewing_design',
      selectedApproachId: 'balanced'
    })

    const firstApproval = await service.sendMessage({
      requestId: 'design-request.approve-ownership',
      modelProfileId: 'model.designer',
      message: 'I approve Roles and ownership.',
      decision: { type: 'approve_section', sectionId: 'ownership' }
    })
    expect(firstApproval.brainstorm).toMatchObject({
      phase: 'reviewing_design',
      approvedSectionIds: ['ownership']
    })

    const secondApproval = await service.sendMessage({
      requestId: 'design-request.approve-flow',
      modelProfileId: 'model.designer',
      message: 'I approve Workflow and handoffs.',
      decision: { type: 'approve_section', sectionId: 'flow' }
    })
    expect(secondApproval.brainstorm).toMatchObject({
      phase: 'reviewing_design',
      approvedSectionIds: ['ownership', 'flow']
    })

    const ready = await service.sendMessage({
      requestId: 'design-request.approve-quality',
      modelProfileId: 'model.designer',
      message: 'I approve Quality and recovery.',
      decision: { type: 'approve_section', sectionId: 'quality' }
    })
    expect(ready.brainstorm).toMatchObject({
      phase: 'ready',
      approvedSectionIds: ['ownership', 'flow', 'quality']
    })
    expect(service.applyProposal({ proposalHash: ready.proposal!.hash }).workflows).toHaveLength(1)
  })

  it('optimizes an existing Workflow as a new version without changing its history', async () => {
    const { profiles, service } = createServiceFixture()
    const initial = await completeBrainstorm(service, 'initial')
    service.applyProposal({ proposalHash: initial.proposal!.hash })

    const revision = service.reset({
      modelProfileId: 'model.designer',
      workflowId: 'workflow.article'
    })

    expect(revision.workflowRevision).toEqual({
      workflowId: 'workflow.article',
      baseVersion: 1,
      nextVersion: 2
    })
    expect(revision.proposal).toMatchObject({
      roles: [],
      workflow: { id: 'workflow.article', version: 2, name: 'Write article' },
      issues: []
    })

    const updated = service.updateProposal({
      expectedProposalHash: revision.proposal!.hash,
      roles: [],
      workflow: { ...revision.proposal!.workflow, name: 'Write and review article' }
    })
    const snapshot = service.applyProposal({ proposalHash: updated.proposal!.hash })

    expect(profiles.workflows.listVersions('workflow.article')).toMatchObject([
      { version: 1, name: 'Write article' },
      { version: 2, name: 'Write and review article' }
    ])
    expect(snapshot.workflows).toMatchObject([
      { id: 'workflow.article', version: 2, name: 'Write and review article' }
    ])
    expect(snapshot.roles).toHaveLength(1)
    expect(snapshot.runs).toEqual([])
  })

  it('blocks a Workflow revision when another version is saved first', async () => {
    const { profiles, service } = createServiceFixture()
    const initial = await completeBrainstorm(service, 'stale-initial')
    service.applyProposal({ proposalHash: initial.proposal!.hash })
    const revision = service.reset({ workflowId: 'workflow.article' })
    const current = profiles.workflows.getActive('workflow.article')!
    profiles.workflows.save({ ...current, version: 2, name: 'Edited elsewhere' })

    const refreshed = service.getDraft()

    expect(refreshed.proposal?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['workflow_revision_stale', 'workflow_revision_version_exists'])
    )
    expect(() => service.applyProposal({ proposalHash: revision.proposal!.hash })).toThrow(
      'Resolve proposal errors before creating definitions'
    )
    expect(profiles.workflows.getActive('workflow.article')).toMatchObject({
      version: 2,
      name: 'Edited elsewhere'
    })
  })

  it('keeps the proposal recoverable when confirmation fails after a catalog change', async () => {
    const { profiles, service } = createServiceFixture()
    const draft = await completeBrainstorm(service, 'recovery')

    profiles.roles.save(draft.proposal!.roles[0]!)

    expect(() => service.applyProposal({ proposalHash: draft.proposal!.hash })).toThrow()

    const recovered = service.getDraft()
    expect(recovered.status).toBe('draft')
    expect(recovered.proposal?.roles).toEqual(draft.proposal?.roles)
    expect(recovered.proposal?.issues.map((issue) => issue.code)).toContain('role_id_exists')
    expect(recovered.recovery).toMatchObject({ code: 'design_proposal_invalid', attempts: 1 })
    expect(profiles.workflows.getActive('workflow.article')).toBeUndefined()
  })

  it('preserves apply recovery when a valid proposal is refreshed after rollback', () => {
    const { drafts, profiles, service } = createServiceFixture()
    const draft = service.createTemplate({ modelProfileId: 'model.designer' })
    expect(draft.proposal?.issues).toEqual([])
    const failure = new Error('simulated workflow write failure')
    const saveWorkflow = vi.spyOn(profiles.workflows, 'save').mockImplementationOnce(() => {
      throw failure
    })

    expect(() => service.applyProposal({ proposalHash: draft.proposal!.hash })).toThrow(
      failure.message
    )
    saveWorkflow.mockRestore()

    const persisted = drafts.get()
    expect(persisted).toMatchObject({ status: 'draft', recovery: { attempts: 1 } })
    expect(persisted.proposal?.hash).toBe(draft.proposal!.hash)
    expect(persisted.recovery?.message).toBe(failure.message)
    expect(profiles.roles.listVersions(draft.proposal!.roles[0]!.id)).toEqual([])

    const refreshed = service.getDraft()
    expect(refreshed.proposal?.issues).toEqual([])
    expect(refreshed.recovery).toEqual(persisted.recovery)
  })
})

async function completeBrainstorm(
  service: MamDesignAssistantService,
  requestPrefix: string
): Promise<MamDesignDraft> {
  await service.sendMessage({
    requestId: `design-request.${requestPrefix}`,
    modelProfileId: 'model.designer',
    message: 'Create a writing workflow.'
  })
  await service.sendMessage({
    requestId: `design-request.${requestPrefix}.select`,
    modelProfileId: 'model.designer',
    message: 'I choose Balanced review.',
    decision: { type: 'select_approach', approachId: 'balanced' }
  })
  for (const sectionId of ['ownership', 'flow', 'quality']) {
    const draft = await service.sendMessage({
      requestId: `design-request.${requestPrefix}.${sectionId}`,
      modelProfileId: 'model.designer',
      message: `I approve ${sectionId}.`,
      decision: { type: 'approve_section', sectionId }
    })
    if (sectionId === 'quality') return draft
  }
  throw new Error('Brainstorming did not reach its final section')
}

function completeBrainstormResponses(): unknown[] {
  const design = {
    ...modelResponse(),
    brainstorm: { approaches: brainstormApproaches(), sections: brainstormSections() }
  }
  return [modelResponse(), design, design, design, design]
}

function brainstormApproaches() {
  return [
    {
      id: 'balanced',
      title: 'Balanced review',
      summary: 'Separate writing and review ownership.',
      benefits: ['Independent review'],
      tradeoffs: ['One additional stage'],
      recommended: true
    },
    {
      id: 'fast',
      title: 'Fast path',
      summary: 'Use final human approval without independent review.',
      benefits: ['Lower latency'],
      tradeoffs: ['Less independent validation'],
      recommended: false
    }
  ]
}

function brainstormSections() {
  return [
    { id: 'ownership', title: 'Roles and ownership', summary: 'Writer and reviewer are separate.' },
    { id: 'flow', title: 'Workflow and handoffs', summary: 'Review happens before completion.' },
    { id: 'quality', title: 'Quality and recovery', summary: 'Rejected work returns for revision.' }
  ]
}

function createServiceFixture(responses: unknown[] = completeBrainstormResponses()): {
  drafts: MamDesignDraftStore
  profiles: ProfileCatalog
  service: MamDesignAssistantService
} {
  const root = mkdtempSync(join(tmpdir(), 'mam-design-service-'))
  temporaryDirectories.push(root)
  const profiles = new ProfileCatalog(join(root, 'catalog'))
  seedExecutionProfiles(profiles)
  let responseIndex = 0
  const gateway = new MamDesignModelGateway(async () => {
    const response = responses[Math.min(responseIndex, responses.length - 1)]
    responseIndex += 1
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  })
  const drafts = new MamDesignDraftStore(join(root, 'design-draft.json'), now)
  const service = new MamDesignAssistantService(
    new MamUiQueryService(profiles, undefined, now),
    profiles,
    drafts,
    { resolve: (secretRef) => (secretRef === 'secret.designer' ? 'test-secret' : undefined) },
    gateway,
    now
  )
  return { drafts, profiles, service }
}

function seedExecutionProfiles(profiles: ProfileCatalog): void {
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
    baseUrl: 'https://api.example.test/v1',
    secretRef: 'secret.designer'
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

function modelResponse() {
  return {
    message: 'The proposal is ready for confirmation.',
    brainstorm: { approaches: brainstormApproaches(), sections: [] },
    proposal: {
      roles: [
        {
          key: 'writer',
          displayName: 'Writer',
          instructions: 'Write a clear article from the task input.',
          executorProfileId: 'executor.pi',
          modelProfileId: 'model.designer',
          skillIds: [],
          mcpServerIds: [],
          knowledgeBaseIds: [],
          tools: [],
          permissions: {
            readPaths: ['.'],
            writePaths: ['.'],
            allowedCommands: [],
            deniedCommands: [],
            allowedNetworkHosts: [],
            requireApprovalFor: []
          },
          budget: {
            maxInputTokens: 8_000,
            maxOutputTokens: 2_000,
            maxCostUsd: 1,
            maxDurationSeconds: 600
          },
          retry: { maxAttempts: 2, initialBackoffMs: 100, maxBackoffMs: 1_000 },
          contextPolicy: {
            maxContextTokens: 16_000,
            compaction: 'disabled',
            includePreviousAttempts: true
          }
        }
      ],
      workflow: {
        key: 'article',
        name: 'Write article',
        nodes: [
          {
            key: 'write',
            type: 'role_task',
            recommendedRoleKeys: ['writer'],
            allowedRoleKeys: ['writer'],
            instruction: 'Write the article.',
            workspaceMode: 'none',
            inputArtifactKeys: [],
            outputs: [
              {
                key: 'article',
                format: 'markdown',
                required: true,
                maxBytes: 100_000,
                requiredSections: ['summary']
              }
            ]
          },
          { key: 'finish', type: 'finish', inputArtifactKeys: ['article'] }
        ],
        edges: [{ from: 'write', to: 'finish' }],
        maxTransitions: 10,
        maxRunCostUsd: 5,
        maxRunDurationSeconds: 1_800
      }
    }
  }
}

function now(): string {
  return '2026-07-29T12:00:00Z'
}
