import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'

export const MamDesignBrainstormQuestionSchema = z
  .object({
    id: MamEntityIdSchema,
    prompt: z.string().trim().min(1).max(4_000),
    whyItMatters: z.string().trim().min(1).max(2_000),
    options: z
      .array(
        z
          .object({
            id: MamEntityIdSchema,
            label: z.string().trim().min(1).max(200),
            description: z.string().trim().min(1).max(1_000)
          })
          .strict()
      )
      .max(4)
      .default([])
  })
  .strict()

export const MamDesignBrainstormApproachSchema = z
  .object({
    id: MamEntityIdSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(4_000),
    benefits: z.array(z.string().trim().min(1).max(1_000)).max(6).default([]),
    tradeoffs: z.array(z.string().trim().min(1).max(1_000)).max(6).default([]),
    recommended: z.boolean()
  })
  .strict()

export const MamDesignBrainstormSectionSchema = z
  .object({
    id: MamEntityIdSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(6_000)
  })
  .strict()

export const MamDesignBrainstormPresentationSchema = z
  .object({
    question: MamDesignBrainstormQuestionSchema.optional(),
    approaches: z.array(MamDesignBrainstormApproachSchema).max(3).default([]),
    sections: z.array(MamDesignBrainstormSectionSchema).max(8).default([])
  })
  .strict()

export const MamDesignBrainstormStateSchema = MamDesignBrainstormPresentationSchema.extend({
  phase: z.enum(['clarifying', 'comparing_approaches', 'reviewing_design', 'ready']),
  selectedApproachId: MamEntityIdSchema.optional(),
  approvedSectionIds: z.array(MamEntityIdSchema).max(8).default([])
}).strict()

export const MamDesignBrainstormDecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select_approach'), approachId: MamEntityIdSchema }).strict(),
  z.object({ type: z.literal('approve_section'), sectionId: MamEntityIdSchema }).strict()
])

export type MamDesignBrainstormPresentation = z.infer<typeof MamDesignBrainstormPresentationSchema>
export type MamDesignBrainstormState = z.infer<typeof MamDesignBrainstormStateSchema>
export type MamDesignBrainstormDecision = z.infer<typeof MamDesignBrainstormDecisionSchema>
