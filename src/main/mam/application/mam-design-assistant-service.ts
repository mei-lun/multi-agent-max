import { randomUUID } from 'node:crypto'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import {
  MamDesignApplyProposalInputSchema,
  MamDesignCancelInputSchema,
  MamDesignCreateTemplateInputSchema,
  MamDesignResetInputSchema,
  MamDesignRetryInputSchema,
  MamDesignSelectModelInputSchema,
  MamDesignSendMessageInputSchema,
  MamDesignUpdateProposalInputSchema,
  type MamDesignDraft,
  type MamDesignMessage,
  type MamDesignWorkflowRevision
} from '../../../shared/mam/design-assistant'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamUiQueryService } from './mam-ui-query-service'
import type { MamDesignDraftStore } from './mam-design-draft-store'
import { failMamDesignAssistant } from './mam-design-assistant-error'
export { MamDesignAssistantServiceError } from './mam-design-assistant-error'
import {
  requireMamDesignModel,
  requireMamDesignTemplateModel,
  type MamDesignSecretResolver
} from './mam-design-assistant-model-requirements'
export type { MamDesignSecretResolver } from './mam-design-assistant-model-requirements'
import {
  createMamDesignIssueRecovery,
  createMamDesignRecovery,
  hasBlockingDesignIssues,
  MamDesignGenerationFailure
} from './mam-design-generation-recovery'
import {
  MamDesignModelGateway,
  MamDesignModelGatewayError,
  type MamDesignModelGatewayInput
} from './mam-design-model-gateway'
import {
  buildMamDesignProposal,
  buildMamDesignStandardTemplate
} from './mam-design-assistant-proposal-builder'
import { MamDesignProposalGenerator } from './mam-design-proposal-generator'
import { refreshMamDesignProposal } from './mam-design-proposal-refresh'
import { createMamDesignProposal } from './mam-design-proposal-validation'
import { buildMamDesignSystemPrompt } from './mam-design-system-prompt'
import { writeMamDesignProposal } from './mam-design-proposal-writer'

const MAX_GATEWAY_MESSAGES = 80

export class MamDesignAssistantService {
  private readonly activeRequests = new Map<string, AbortController>()

  constructor(
    private readonly query: MamUiQueryService,
    private readonly profiles: ProfileCatalog,
    private readonly drafts: MamDesignDraftStore,
    private readonly secrets: MamDesignSecretResolver,
    private readonly gateway = new MamDesignModelGateway(),
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  getDraft(): MamDesignDraft {
    return refreshMamDesignProposal({
      draft: this.drafts.get(),
      profiles: this.profiles,
      drafts: this.drafts,
      now: this.now
    })
  }

  selectModel(input: unknown): MamDesignDraft {
    const parsed = MamDesignSelectModelInputSchema.parse(input)
    if (this.activeRequests.size > 0) fail('design_request_active', 'A design request is active')
    requireMamDesignTemplateModel(this.profiles, parsed.modelProfileId)
    const draft = this.requireEditableDraft()
    return this.drafts.save({
      ...draft,
      selectedModelProfileId: parsed.modelProfileId,
      updatedAt: this.now()
    })
  }

  reset(input: unknown): MamDesignDraft {
    const parsed = MamDesignResetInputSchema.parse(input)
    if (parsed.modelProfileId) requireMamDesignTemplateModel(this.profiles, parsed.modelProfileId)
    if (!parsed.workflowId) return this.drafts.reset(parsed.modelProfileId)
    const workflow = this.profiles.workflows.getActive(parsed.workflowId)
    if (!workflow) fail('design_workflow_not_found', `Workflow is not active: ${parsed.workflowId}`)
    const revision = this.workflowRevision(workflow.id, workflow.version)
    const proposal = createMamDesignProposal({
      roles: [],
      workflow: { ...workflow, version: revision.nextVersion },
      profiles: this.profiles,
      now: this.now,
      workflowRevision: revision
    })
    return this.drafts.reset({
      ...(parsed.modelProfileId ? { modelProfileId: parsed.modelProfileId } : {}),
      workflowRevision: revision,
      proposal
    })
  }

  createTemplate(input: unknown): MamDesignDraft {
    const parsed = MamDesignCreateTemplateInputSchema.parse(input)
    if (this.activeRequests.size > 0) fail('design_request_active', 'A design request is active')
    requireMamDesignTemplateModel(this.profiles, parsed.modelProfileId)
    const draft = this.requireEditableDraft()
    const source = buildMamDesignStandardTemplate({
      profiles: this.profiles,
      modelProfileId: parsed.modelProfileId
    })
    const proposal = buildMamDesignProposal({
      source,
      template: source,
      profiles: this.profiles,
      now: this.now,
      ...(draft.workflowRevision ? { workflowRevision: draft.workflowRevision } : {})
    })
    const { recovery: _recovery, ...rest } = draft
    return this.drafts.save({
      ...rest,
      selectedModelProfileId: parsed.modelProfileId,
      proposal,
      updatedAt: this.now()
    })
  }

  async sendMessage(input: unknown): Promise<MamDesignDraft> {
    const parsed = MamDesignSendMessageInputSchema.parse(input)
    if (this.activeRequests.size > 0) fail('design_request_active', 'A design request is active')
    requireMamDesignModel(this.profiles, this.secrets, parsed.modelProfileId)
    buildMamDesignStandardTemplate({
      profiles: this.profiles,
      modelProfileId: parsed.modelProfileId
    })
    const draft = this.requireEditableDraft()
    const pendingDraft = this.drafts.save({
      ...draft,
      selectedModelProfileId: parsed.modelProfileId,
      messages: appendMessages(draft.messages, this.message('user', parsed.message)),
      updatedAt: this.now()
    })
    return this.generateForDraft(pendingDraft, parsed.requestId, parsed.modelProfileId)
  }

  async retry(input: unknown): Promise<MamDesignDraft> {
    const parsed = MamDesignRetryInputSchema.parse(input)
    if (this.activeRequests.size > 0) fail('design_request_active', 'A design request is active')
    const draft = this.requireEditableDraft()
    const modelProfileId = draft.selectedModelProfileId
    if (!modelProfileId) fail('design_model_not_selected', 'Select a Model Profile before retrying')
    requireMamDesignModel(this.profiles, this.secrets, modelProfileId)
    buildMamDesignStandardTemplate({ profiles: this.profiles, modelProfileId })
    return this.generateForDraft(draft, parsed.requestId, modelProfileId)
  }

  cancel(input: unknown): void {
    const parsed = MamDesignCancelInputSchema.parse(input)
    this.activeRequests.get(parsed.requestId)?.abort('cancelled_by_user')
  }

  updateProposal(input: unknown): MamDesignDraft {
    const parsed = MamDesignUpdateProposalInputSchema.parse(input)
    if (this.activeRequests.size > 0) fail('design_request_active', 'A design request is active')
    const draft = this.requireEditableDraft()
    if (draft.proposal?.hash !== parsed.expectedProposalHash) {
      fail('design_proposal_stale', 'The Design proposal changed before this edit was saved')
    }
    const proposal = createMamDesignProposal({
      roles: parsed.roles,
      workflow: parsed.workflow,
      profiles: this.profiles,
      now: this.now,
      ...(draft.workflowRevision ? { workflowRevision: draft.workflowRevision } : {})
    })
    const { recovery: _recovery, ...rest } = draft
    const recovery = hasBlockingDesignIssues(proposal.issues)
      ? createMamDesignIssueRecovery(proposal.issues, this.now())
      : undefined
    return this.drafts.save({
      ...rest,
      proposal,
      ...(recovery ? { recovery } : {}),
      updatedAt: this.now()
    })
  }

  applyProposal(input: unknown): MamUiSnapshot {
    const parsed = MamDesignApplyProposalInputSchema.parse(input)
    const draft = this.requireEditableDraft()
    if (!draft.proposal || draft.proposal.hash !== parsed.proposalHash) {
      fail('design_proposal_stale', 'Confirm the current Design proposal revision')
    }
    if (hasBlockingDesignIssues(draft.proposal.issues)) {
      fail('design_proposal_invalid', 'Resolve proposal errors before creating definitions')
    }
    try {
      writeMamDesignProposal(draft.proposal, this.profiles, draft.workflowRevision)
    } catch (cause) {
      this.drafts.save({
        ...draft,
        recovery: createMamDesignRecovery(cause, this.now()),
        updatedAt: this.now()
      })
      throw cause
    }
    this.drafts.save({ ...draft, status: 'applied', appliedAt: this.now(), updatedAt: this.now() })
    return this.query.getSnapshot()
  }

  private async generateForDraft(
    draft: MamDesignDraft,
    requestId: string,
    modelProfileId: string
  ): Promise<MamDesignDraft> {
    const { model, provider, credential } = requireMamDesignModel(
      this.profiles,
      this.secrets,
      modelProfileId
    )
    const template = buildMamDesignStandardTemplate({ profiles: this.profiles, modelProfileId })
    const controller = new AbortController()
    this.activeRequests.set(requestId, controller)
    try {
      const input = {
        model,
        provider,
        ...(credential ? { credential } : {}),
        systemPrompt: buildMamDesignSystemPrompt({
          profiles: this.profiles,
          selectedModelProfileId: modelProfileId,
          standardTemplate: template,
          ...(draft.proposal ? { currentProposal: draft.proposal } : {}),
          ...(draft.recovery ? { recovery: draft.recovery } : {}),
          ...(draft.workflowRevision ? { workflowRevision: draft.workflowRevision } : {})
        }),
        messages: draft.messages.slice(-MAX_GATEWAY_MESSAGES),
        signal: controller.signal
      } satisfies MamDesignModelGatewayInput
      const { response, proposal } = await new MamDesignProposalGenerator(
        this.gateway,
        this.now
      ).generate(input, (source) =>
        buildMamDesignProposal({
          source,
          template,
          profiles: this.profiles,
          now: this.now,
          ...(draft.workflowRevision ? { workflowRevision: draft.workflowRevision } : {})
        })
      )
      const { recovery: _recovery, ...rest } = draft
      return this.drafts.save({
        ...rest,
        messages: appendMessages(draft.messages, this.message('assistant', response.message)),
        proposal,
        updatedAt: this.now()
      })
    } catch (cause) {
      if (
        cause instanceof MamDesignModelGatewayError &&
        cause.code === 'design_request_cancelled'
      ) {
        throw cause
      }
      const recovery = createMamDesignRecovery(cause, this.now())
      const failedProposal =
        cause instanceof MamDesignGenerationFailure ? cause.proposal : undefined
      this.drafts.save({
        ...draft,
        ...(failedProposal ? { proposal: failedProposal } : {}),
        recovery,
        updatedAt: this.now()
      })
      if (cause instanceof MamDesignGenerationFailure) {
        fail(cause.code, cause.message)
      }
      throw cause
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  private requireEditableDraft(): MamDesignDraft {
    const draft = this.drafts.get()
    if (draft.status !== 'draft')
      fail('design_draft_applied', 'Start a new Design before continuing')
    return draft
  }

  private workflowRevision(workflowId: string, baseVersion: number): MamDesignWorkflowRevision {
    const latestVersion = this.profiles.workflows
      .listVersions(workflowId)
      .reduce((latest, workflow) => Math.max(latest, workflow.version), baseVersion)
    return { workflowId, baseVersion, nextVersion: latestVersion + 1 }
  }

  private message(role: MamDesignMessage['role'], content: string): MamDesignMessage {
    return {
      id: `design-message.${randomUUID().replaceAll('-', '')}`,
      role,
      content,
      createdAt: this.now()
    }
  }
}

function appendMessages(
  messages: readonly MamDesignMessage[],
  ...next: readonly MamDesignMessage[]
): MamDesignMessage[] {
  return [...messages, ...next].slice(-200)
}

function fail(code: string, message: string): never {
  return failMamDesignAssistant(code, message)
}
