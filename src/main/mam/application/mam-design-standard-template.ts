import type { MamDesignProposalSpec } from '../../../shared/mam/design-proposal'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import { preferredMamDesignExecutionBinding } from './mam-design-execution-bindings'

export class MamDesignStandardTemplateError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamDesignStandardTemplateError'
  }
}

export function createMamDesignStandardTemplate(input: {
  profiles: ProfileCatalog
  modelProfileId: string
}): MamDesignProposalSpec {
  const binding = preferredMamDesignExecutionBinding(input.profiles, input.modelProfileId)
  if (!binding) {
    throw new MamDesignStandardTemplateError(
      'design_execution_binding_not_found',
      `No active Executor can use Model Profile: ${input.modelProfileId}`
    )
  }
  const model = input.profiles.models.getActive(binding.modelProfileId)
  if (!model) {
    throw new MamDesignStandardTemplateError(
      'design_model_not_found',
      `Model Profile is not active: ${input.modelProfileId}`
    )
  }
  return {
    roles: [
      {
        key: 'delivery-author',
        displayName: '交付执行者',
        instructions: '根据分配的任务制作可审核的交付物，清楚说明结果、依据、风险和待确认事项。',
        executorProfileId: binding.executorProfileId,
        modelProfileId: binding.modelProfileId,
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
          maxInputTokens: 12_000,
          maxOutputTokens: 4_000,
          maxCostUsd: 3,
          maxDurationSeconds: 1_800
        },
        retry: { maxAttempts: 2, initialBackoffMs: 1_000, maxBackoffMs: 10_000 },
        contextPolicy: {
          maxContextTokens: Math.min(model.capabilities.maxContextTokens ?? 24_000, 24_000),
          compaction: 'disabled',
          includePreviousAttempts: true
        }
      },
      {
        key: 'delivery-reviewer',
        displayName: '交付审核者',
        instructions: '独立检查交付物和代码差异，给出明确结论与可执行问题，不修改被审核实现。',
        executorProfileId: binding.executorProfileId,
        modelProfileId: binding.modelProfileId,
        skillIds: [],
        mcpServerIds: [],
        knowledgeBaseIds: [],
        tools: [],
        permissions: {
          readPaths: ['.'],
          writePaths: [],
          allowedCommands: [],
          deniedCommands: [],
          allowedNetworkHosts: [],
          requireApprovalFor: []
        },
        budget: {
          maxInputTokens: 12_000,
          maxOutputTokens: 4_000,
          maxCostUsd: 3,
          maxDurationSeconds: 1_800
        },
        retry: { maxAttempts: 2, initialBackoffMs: 1_000, maxBackoffMs: 10_000 },
        contextPolicy: {
          maxContextTokens: Math.min(model.capabilities.maxContextTokens ?? 24_000, 24_000),
          compaction: 'disabled',
          includePreviousAttempts: true
        }
      }
    ],
    workflow: {
      key: 'standard-delivery',
      name: '标准交付工作流',
      nodes: [
        {
          key: 'prepare-delivery',
          type: 'role_task',
          recommendedRoleKeys: ['delivery-author'],
          allowedRoleKeys: ['delivery-author'],
          instruction: '根据任务输入创建一份可供人工审核的交付草稿。',
          workspaceMode: 'write',
          inputArtifactKeys: [],
          outputs: [
            {
              key: 'delivery-brief',
              format: 'markdown',
              required: true,
              maxBytes: 100_000,
              requiredSections: ['summary', 'deliverable', 'risks']
            }
          ]
        },
        {
          key: 'review-delivery',
          type: 'review_gate',
          recommendedRoleKeys: ['delivery-reviewer'],
          allowedRoleKeys: ['delivery-reviewer'],
          inputArtifactKeys: ['delivery-brief'],
          reportContract: {
            key: 'review-report',
            format: 'json-schema',
            required: true,
            maxBytes: 100_000,
            jsonSchema: { type: 'object' }
          },
          minimumDecisions: 1,
          maxRevisionAttempts: 2
        },
        {
          key: 'integrate-develop',
          type: 'git_merge',
          recommendedRoleKeys: ['delivery-author'],
          allowedRoleKeys: ['delivery-author'],
          targetBranch: 'develop',
          strategy: 'no_ff',
          validations: []
        },
        {
          key: 'approve-release',
          type: 'approval_gate',
          prompt: 'The reviewed result is available on develop. Promote it to main?',
          options: ['Promote to main']
        },
        {
          key: 'promote-main',
          type: 'git_merge',
          recommendedRoleKeys: ['delivery-author'],
          allowedRoleKeys: ['delivery-author'],
          targetBranch: 'main',
          strategy: 'no_ff',
          validations: []
        },
        { key: 'finish', type: 'finish', inputArtifactKeys: ['delivery-brief'] }
      ],
      edges: [
        { from: 'prepare-delivery', to: 'review-delivery' },
        { from: 'review-delivery', to: 'integrate-develop' },
        { from: 'integrate-develop', to: 'approve-release' },
        { from: 'approve-release', to: 'promote-main' },
        { from: 'promote-main', to: 'finish' }
      ],
      maxTransitions: 20,
      maxRunCostUsd: 8,
      maxRunDurationSeconds: 3_600
    }
  }
}
