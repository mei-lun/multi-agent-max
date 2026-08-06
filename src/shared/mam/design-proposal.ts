import { z } from 'zod'
import { ArtifactFormatSchema } from './domain/artifact'
import { MamEntityIdSchema } from './domain/primitives'
import { MamDesignBrainstormPresentationSchema } from './design-brainstorm'

const DesignArtifactSpecSchema = z
  .object({
    key: MamEntityIdSchema,
    format: ArtifactFormatSchema.default('markdown'),
    required: z.boolean().default(true),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024)
      .default(100_000),
    jsonSchema: z.record(z.string(), z.unknown()).optional(),
    requiredSections: z.array(MamEntityIdSchema).min(1).optional(),
    allowedGlobs: z.array(z.string().min(1)).min(1).optional()
  })
  .strict()

const DesignRoleSelectionSchema = z
  .object({
    recommendedRoleKeys: z.array(MamEntityIdSchema).max(1).default([]),
    allowedRoleKeys: z.array(MamEntityIdSchema).length(1)
  })
  .strict()

const DesignRoleTaskNodeSchema = DesignRoleSelectionSchema.extend({
  key: MamEntityIdSchema,
  type: z.literal('role_task'),
  instruction: z.string().trim().min(1).max(20_000),
  workspaceMode: z.enum(['none', 'read', 'write']),
  inputArtifactKeys: z.array(MamEntityIdSchema).default([]),
  outputs: z.array(DesignArtifactSpecSchema).min(1)
}).strict()

const DesignDynamicTasksNodeSchema = DesignRoleSelectionSchema.extend({
  key: MamEntityIdSchema,
  type: z.literal('dynamic_tasks'),
  planContract: DesignArtifactSpecSchema,
  maxTasks: z.number().int().positive().max(200)
}).strict()

const DesignReviewGateNodeSchema = DesignRoleSelectionSchema.extend({
  key: MamEntityIdSchema,
  type: z.literal('review_gate'),
  inputArtifactKeys: z.array(MamEntityIdSchema).min(1),
  reportContract: DesignArtifactSpecSchema,
  minimumDecisions: z.number().int().positive(),
  maxRevisionAttempts: z.number().int().positive().max(20)
}).strict()

const DesignApprovalGateNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('approval_gate'),
    prompt: z.string().trim().min(1).max(4000),
    options: z.array(z.string().trim().min(1).max(1000)).min(1)
  })
  .strict()

const DesignHumanReviewGateNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('human_review_gate'),
    inputArtifactKeys: z.array(MamEntityIdSchema).min(1),
    instructions: z.string().trim().min(1).max(20_000),
    revisionTargetNodeKey: MamEntityIdSchema,
    maxRevisionAttempts: z.number().int().positive().max(20)
  })
  .strict()

const DesignConditionNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('condition'),
    expression: z.string().trim().min(1).max(4000),
    branches: z.record(z.string().min(1), MamEntityIdSchema)
  })
  .strict()

const DesignParallelNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('parallel'),
    branches: z.array(MamEntityIdSchema).min(2)
  })
  .strict()

const DesignJoinNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('join'),
    waitFor: z.array(MamEntityIdSchema).min(2)
  })
  .strict()

const DesignArtifactTransformNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('artifact_transform'),
    inputArtifactKeys: z.array(MamEntityIdSchema).min(1),
    outputs: z.array(DesignArtifactSpecSchema).min(1),
    transform: z.string().trim().min(1).max(20_000)
  })
  .strict()

const DesignCommandNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('command'),
    executable: z.string().trim().min(1).max(1000),
    arguments: z.array(z.string().max(4000)),
    workingDirectory: z.string().trim().min(1).max(4000),
    outputs: z.array(DesignArtifactSpecSchema)
  })
  .strict()

const DesignGitMergeNodeSchema = DesignRoleSelectionSchema.extend({
  key: MamEntityIdSchema,
  type: z.literal('git_merge'),
  targetBranch: z.string().trim().min(1).max(1000),
  strategy: z.enum(['no_ff', 'ff_only']),
  validations: z.array(z.string().trim().min(1).max(4000))
}).strict()

const DesignFinishNodeSchema = z
  .object({
    key: MamEntityIdSchema,
    type: z.literal('finish'),
    inputArtifactKeys: z.array(MamEntityIdSchema).default([])
  })
  .strict()

export const MamDesignWorkflowNodeSpecSchema = z.discriminatedUnion('type', [
  DesignRoleTaskNodeSchema,
  DesignDynamicTasksNodeSchema,
  DesignReviewGateNodeSchema,
  DesignApprovalGateNodeSchema,
  DesignHumanReviewGateNodeSchema,
  DesignConditionNodeSchema,
  DesignParallelNodeSchema,
  DesignJoinNodeSchema,
  DesignArtifactTransformNodeSchema,
  DesignCommandNodeSchema,
  DesignGitMergeNodeSchema,
  DesignFinishNodeSchema
])

export const MamDesignRoleSpecSchema = z
  .object({
    key: MamEntityIdSchema,
    displayName: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(20_000),
    executorProfileId: MamEntityIdSchema.optional(),
    modelProfileId: MamEntityIdSchema.optional(),
    skillIds: z.array(MamEntityIdSchema).default([]),
    mcpServerIds: z.array(MamEntityIdSchema).default([]),
    knowledgeBaseIds: z.array(MamEntityIdSchema).default([]),
    tools: z.array(MamEntityIdSchema).default([]),
    permissions: z
      .object({
        readPaths: z.array(z.string().min(1)).default(['.']),
        writePaths: z.array(z.string().min(1)).default(['.']),
        allowedCommands: z.array(z.string().min(1)).default([]),
        deniedCommands: z.array(z.string().min(1)).default([]),
        allowedNetworkHosts: z.array(z.string().min(1)).default([]),
        requireApprovalFor: z
          .array(z.enum(['file', 'command', 'network', 'mcp', 'knowledge']))
          .default([])
      })
      .strict()
      .default({
        readPaths: ['.'],
        writePaths: ['.'],
        allowedCommands: [],
        deniedCommands: [],
        allowedNetworkHosts: [],
        requireApprovalFor: []
      }),
    budget: z
      .object({
        maxInputTokens: z.number().int().positive().default(12_000),
        maxOutputTokens: z.number().int().positive().default(4_000),
        maxCostUsd: z.number().nonnegative().default(3),
        maxDurationSeconds: z.number().int().positive().default(1_800)
      })
      .strict()
      .default({
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxCostUsd: 3,
        maxDurationSeconds: 1_800
      }),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(20).default(2),
        initialBackoffMs: z.number().int().nonnegative().default(1_000),
        maxBackoffMs: z.number().int().nonnegative().default(10_000)
      })
      .strict()
      .default({ maxAttempts: 2, initialBackoffMs: 1_000, maxBackoffMs: 10_000 }),
    contextPolicy: z
      .object({
        maxContextTokens: z.number().int().positive().default(24_000),
        compaction: z.enum(['disabled', 'executor', 'scheduler']).default('disabled'),
        includePreviousAttempts: z.boolean().default(true)
      })
      .strict()
      .default({
        maxContextTokens: 24_000,
        compaction: 'disabled',
        includePreviousAttempts: true
      })
  })
  .strict()

export const MamDesignProposalSpecSchema = z
  .object({
    roles: z.array(MamDesignRoleSpecSchema).max(50),
    workflow: z
      .object({
        key: MamEntityIdSchema,
        name: z.string().trim().min(1).max(160),
        nodes: z.array(MamDesignWorkflowNodeSpecSchema).min(1).max(200),
        edges: z
          .array(
            z
              .object({
                from: MamEntityIdSchema,
                to: MamEntityIdSchema,
                when: z.string().trim().min(1).max(4000).optional(),
                maxTraversals: z.number().int().positive().max(100).optional()
              })
              .strict()
          )
          .max(1000),
        maxTransitions: z.number().int().positive().max(10_000).default(10),
        maxRunCostUsd: z.number().nonnegative().default(5),
        maxRunDurationSeconds: z.number().int().positive().default(1_800)
      })
      .strict()
  })
  .strict()

export const MamDesignReviewSchema = z
  .object({
    readiness: z.enum(['needs_clarification', 'needs_revision', 'ready']).default('ready'),
    questions: z.array(z.string().trim().min(1).max(4_000)).max(5).default([]),
    findings: z
      .array(
        z
          .object({
            severity: z.enum(['warning', 'suggestion']),
            status: z.enum(['unresolved', 'addressed']),
            title: z.string().trim().min(1).max(200),
            detail: z.string().trim().min(1).max(4_000),
            recommendation: z.string().trim().min(1).max(4_000)
          })
          .strict()
      )
      .max(20)
      .default([]),
    assumptions: z.array(z.string().trim().min(1).max(4_000)).max(20).default([])
  })
  .strict()
  .default({ readiness: 'ready', questions: [], findings: [], assumptions: [] })

export const MamDesignModelResponseSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .default('A complete proposal is ready to review.'),
    brainstorm: MamDesignBrainstormPresentationSchema,
    review: MamDesignReviewSchema,
    proposal: MamDesignProposalSpecSchema
  })
  .strict()

export type MamDesignProposalSpec = z.infer<typeof MamDesignProposalSpecSchema>
export type MamDesignReview = z.infer<typeof MamDesignReviewSchema>
export type MamDesignModelResponse = z.infer<typeof MamDesignModelResponseSchema>
